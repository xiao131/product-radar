import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { generateText } from "ai";
import { z } from "zod";
import {
  createResearchAiModel,
  createResearchAiProviderOptions,
} from "./ai.js";
import { isAiConfigured, type AppConfig } from "./config.js";
import {
  analyzeProductCsv,
  analyzeSignalCsv,
  productImportKey,
  signalImportFingerprint,
  type ImportedProduct,
  type ImportedSignal,
  type ParsedCsv,
} from "./csv.js";
import type { RadarDatabase } from "./db.js";
import { logEvent, requestLogger } from "./logger.js";
import {
  mapEvidence,
  mapOpportunity,
  mapProduct,
  mapReport,
  mapSignal,
} from "./mappers.js";
import {
  canBackfillBilingualContentWithoutCollection,
  isOpportunityResearchDue,
  ResearchInProgressError,
  researchOpportunity,
  reusableFailedResearchEvidence,
} from "./research.js";
import { latestSchemaVersion } from "./migrations.js";
import { estimateResearchCost } from "./providers.js";
import { createSecurity, fixedWindowRateLimiter } from "./security.js";
import { schedulerRuntimeStatus } from "./scheduler.js";
import { linkSignalEvidence } from "./signal-evidence.js";
import { readableAiError } from "./errors.js";
import {
  previewRuntimeSettings,
  runtimeSettingsResponse,
  runtimeSettingsUpdateSchema,
  saveRuntimeSettings,
} from "./runtime-settings.js";
import {
  JobAlreadyRunningError,
  runResearchJob,
  startBackupJob,
  startDiscoveryPipeline,
  startResearchJob,
} from "./jobs.js";
import {
  UsageBudgetConfirmationRequiredError,
  UsageBudgetExceededError,
  UsageLedger,
} from "./usage.js";
import {
  createProductSchema,
  createSignalSchema,
  linkSignalSchema,
  opportunityUpdateSchema,
  opportunityWorkflowUpdateSchema,
  updateProductSchema,
} from "../shared/schemas.js";
import type {
  DashboardData,
  CsvImportPreview,
  CsvImportPreviewRow,
  EvidenceItem,
  JobRun,
  Opportunity,
  OpportunityDetail,
  OpportunityOption,
  OperationsStatus,
  Paginated,
  Product,
  Signal,
  SignalPage,
} from "../shared/types.js";
import {
  detectContentLanguage,
  languageFromMarket,
  marketCode,
} from "../shared/localization.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z
    .enum(["score", "scoreDelta", "updatedAt", "name", "confidence"])
    .default("score"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  query: z.string().trim().max(120).optional(),
  platform: z.enum(["WEB", "IOS", "WEB_AND_IOS"]).optional(),
  market: z.string().trim().regex(/^[A-Za-z0-9_-]{2,16}$/).optional(),
  language: z.enum(["zh-CN", "en", "mixed", "und"]).optional(),
  verdict: z.enum(["BUILD_NOW", "VALIDATE_FIRST", "WATCH", "SKIP"]).optional(),
  researchStatus: z.enum(["UNRESEARCHED", "READY", "RUNNING", "FAILED"]).optional(),
});

const researchRequestSchema = z.object({
  force: z.boolean().default(false),
  confirmTaskBudgetOverride: z.boolean().default(false),
});

const batchResearchRequestSchema = z.object({
  delivery: z.literal("standard").default("standard"),
});

const opportunityOptionsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const signalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const opportunityDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const csvImportRequestSchema = z.object({
  csv: z.string().min(1).max(1_500_000),
});

const signalCsvTemplate =
  "\uFEFFtitle,content,source_type,source_url,tags,market,original_language,source_name,collected_at,external_id\r\n";
const productCsvTemplate =
  "\uFEFFname,platform,status,url,description,current_focus\r\n";

const sortColumns = {
  score: "score",
  scoreDelta: "score_delta",
  updatedAt: "updated_at",
  name: "name",
  confidence: "confidence",
} as const;

function rows<T>(
  db: RadarDatabase,
  sql: string,
  mapper: (row: Record<string, unknown>) => T,
  ...params: unknown[]
) {
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(mapper);
}

function now() {
  return new Date().toISOString();
}

function markPortfolioDependentResearchDue(
  db: RadarDatabase,
  changedAt: string,
) {
  db.prepare(
    `UPDATE opportunities
     SET research_status = CASE WHEN research_status = 'RUNNING' THEN 'RUNNING' ELSE 'UNRESEARCHED' END,
         stale_since = ?,
         change_summary = '产品组合发生变化，等待重新评估资产复用与个人匹配。',
         updated_at = ?`,
  ).run(changedAt, changedAt);
}

function sendCsvTemplate(
  response: Response,
  filename: string,
  template: string,
) {
  response
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    })
    .send(template);
}

function csvPreview<T>(
  kind: CsvImportPreview["kind"],
  parsed: ParsedCsv<T>,
  existingKeys: Set<string>,
  keysForValue: (value: T) => string | string[],
) {
  const importable: T[] = [];
  let duplicateRows = 0;
  let errorRows = 0;
  const seen = new Set(existingKeys);
  const rows = parsed.rows.map((row): CsvImportPreviewRow => {
    if (!row.value || row.messages.length) {
      errorRows += 1;
      return {
        line: row.line,
        status: "error",
        values: row.values,
        messages: row.messages.length ? row.messages : ["这一行无法导入"],
      };
    }
    const keys = [keysForValue(row.value)].flat();
    if (keys.some((key) => seen.has(key))) {
      duplicateRows += 1;
      return {
        line: row.line,
        status: "duplicate",
        values: row.values,
        messages: ["已存在相同数据，本行将跳过"],
      };
    }
    keys.forEach((key) => seen.add(key));
    importable.push(row.value);
    return {
      line: row.line,
      status: "valid",
      values: row.values,
      messages: [],
    };
  });
  const preview: CsvImportPreview = {
    kind,
    columns: parsed.columns,
    totalRows: parsed.rows.length,
    validRows: importable.length,
    duplicateRows,
    errorRows,
    canImport:
      parsed.issues.length === 0 && errorRows === 0 && importable.length > 0,
    issues: [
      ...parsed.issues,
      ...rows.flatMap((row) =>
        row.status === "error"
          ? row.messages.map((message) => ({ line: row.line, message }))
          : [],
      ),
    ],
    rows: rows.slice(0, 20),
    truncated: rows.length > 20,
  };
  return { preview, importable };
}

function csvImportError(preview: CsvImportPreview, resource: string) {
  const issue = preview.issues[0];
  const row = preview.rows.find((item) => item.status === "error");
  const detail = issue?.message ?? row?.messages[0] ?? "CSV 包含需要修复的内容";
  const line = issue?.line ?? row?.line ?? null;
  return `${line ? `CSV 第 ${line} 行：` : "CSV "}${detail.replace(/^CSV\s*/, "")}；尚未导入任何${resource}`;
}

function previewSignalImport(db: RadarDatabase, csv: string) {
  const parsed = analyzeSignalCsv(csv);
  const existingRows = db
    .prepare(
      `SELECT source_type, title, content, source_url, fingerprint
       FROM signals`,
    )
    .all() as Array<{
      source_type: string;
      title: string;
      content: string;
      source_url: string | null;
      fingerprint: string | null;
    }>;
  const existingKeys = new Set<string>();
  for (const row of existingRows) {
    if (row.fingerprint) existingKeys.add(row.fingerprint);
    existingKeys.add(signalImportFingerprint({
      sourceType: row.source_type,
      title: row.title,
      content: row.content,
      sourceUrl: row.source_url,
    }));
  }
  return csvPreview(
    "signals",
    parsed,
    existingKeys,
    (signal: ImportedSignal) => [
      signal.fingerprint,
      signal.contentFingerprint,
    ],
  );
}

function previewProductImport(db: RadarDatabase, csv: string) {
  const parsed = analyzeProductCsv(csv);
  const existingRows = db
    .prepare("SELECT name, platform, url FROM products")
    .all() as Array<{ name: string; platform: string; url: string | null }>;
  const existingKeys = new Set(
    existingRows.map((product) => productImportKey(product)),
  );
  return csvPreview(
    "products",
    parsed,
    existingKeys,
    (product: ImportedProduct) => productImportKey(product),
  );
}

function toSqlUpdates(
  input: Record<string, unknown>,
  mapping: Record<string, string>,
  emptyToNullFields: ReadonlySet<string> = new Set(),
) {
  return Object.entries(input)
    .filter(([key]) => mapping[key])
    .map(([key, value]) => ({
      column: mapping[key],
      value: value === "" && emptyToNullFields.has(key) ? null : value,
    }));
}

function jobRunFromRow(row: Record<string, unknown>): JobRun {
  let result: Record<string, unknown> | undefined;
  try {
    result = JSON.parse(String(row.result_json ?? "{}")) as Record<string, unknown>;
  } catch {
    result = undefined;
  }
  return {
    id: String(row.id),
    type: String(row.job_type),
    trigger: String(row.trigger_type),
    status: row.status as JobRun["status"],
    error: row.error ? String(row.error) : null,
    result,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

function reportEvidenceFromSnapshot(
  opportunityId: string,
  report: OpportunityDetail["reports"][number] | undefined,
  fallback: EvidenceItem[],
) {
  if (!report) return [];
  const fallbackById = new Map(fallback.map((item) => [item.id, item]));
  const snapshotById = new Map(
    (report.evidenceSnapshot ?? [])
      .filter((item) => typeof item.id === "string")
      .map((item) => [String(item.id), item]),
  );
  return report.evidenceIds.flatMap((id): EvidenceItem[] => {
    const current = fallbackById.get(id);
    const snapshot = snapshotById.get(id);
    if (!current && !snapshot) return [];
    const value = snapshot?.value;
    return [{
      id,
      opportunityId,
      category: (snapshot?.category ?? current?.category ?? "BUILD") as EvidenceItem["category"],
      sourceName: String(snapshot?.sourceName ?? current?.sourceName ?? "未知来源"),
      sourceUrl:
        typeof snapshot?.sourceUrl === "string"
          ? snapshot.sourceUrl
          : current?.sourceUrl ?? null,
      metric: String(snapshot?.metric ?? current?.metric ?? "unknown"),
      value:
        typeof value === "number"
          ? value
          : value === null
            ? null
            : current?.value ?? null,
      unit:
        typeof snapshot?.unit === "string"
          ? snapshot.unit
          : current?.unit ?? null,
      direction: (snapshot?.direction ?? current?.direction ?? "UNKNOWN") as EvidenceItem["direction"],
      strength: Number(snapshot?.strength ?? current?.strength ?? 0),
      summary: String(snapshot?.summary ?? current?.summary ?? snapshot?.metric ?? "历史证据"),
      rawExcerpt:
        typeof snapshot?.rawExcerpt === "string"
          ? snapshot.rawExcerpt
          : current?.rawExcerpt ?? null,
      originalLanguage: (snapshot?.originalLanguage ??
        current?.originalLanguage ??
        "und") as EvidenceItem["originalLanguage"],
      translations: (() => {
        const snapshotTranslations =
          snapshot?.translations &&
          typeof snapshot.translations === "object" &&
          !Array.isArray(snapshot.translations)
            ? (snapshot.translations as EvidenceItem["translations"])
            : undefined;
        return snapshotTranslations && Object.keys(snapshotTranslations).length
          ? snapshotTranslations
          : current?.translations ?? {};
      })(),
      collectedAt: String(snapshot?.collectedAt ?? current?.collectedAt ?? report.createdAt),
      freshnessDays: Number(snapshot?.freshnessDays ?? current?.freshnessDays ?? 0),
      fingerprint:
        typeof snapshot?.fingerprint === "string"
          ? snapshot.fingerprint
          : current?.fingerprint ?? null,
      market:
        typeof snapshot?.market === "string"
          ? snapshot.market
          : current?.market ?? null,
    }];
  });
}

function handleError(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "输入内容不符合要求", details: error.flatten() });
    return;
  }
  const message = error instanceof Error ? error.message : "服务器发生未知错误";
  let status = 500;
  if (error instanceof UsageBudgetConfirmationRequiredError) {
    response.status(409).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  } else if (
    error instanceof ResearchInProgressError ||
    error instanceof JobAlreadyRunningError
  ) {
    status = 409;
  } else if (error instanceof UsageBudgetExceededError) {
    status = 429;
  } else if (/找不到/.test(message)) {
    status = 404;
  } else if (/^CSV /.test(message)) {
    status = 400;
  }
  if (status === 500) {
    logEvent("error", "request_failed", {
      requestId: response.locals.requestId,
      method: request.method,
      path: request.path,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message,
    });
  }
  response
    .status(status)
    .json({ error: status === 500 ? "服务器暂时无法完成请求" : message });
}

export function configForManualOpportunityResearch(
  db: RadarDatabase,
  config: AppConfig,
  opportunityId: string,
  force: boolean,
  confirmTaskBudgetOverride: boolean,
) {
  const opportunityRow = db
    .prepare("SELECT * FROM opportunities WHERE id = ?")
    .get(opportunityId) as Record<string, unknown> | undefined;
  if (!opportunityRow) throw new Error("找不到这个候选产品");
  const opportunity = mapOpportunity(opportunityRow);
  const hasReport = Boolean(
    db
      .prepare(
        `SELECT 1 FROM research_reports
         WHERE opportunity_id = ? LIMIT 1`,
      )
      .get(opportunityId),
  );
  if (
    !force &&
    hasReport &&
    !isOpportunityResearchDue(opportunity, config.researchFreshnessDays)
  ) {
    return config;
  }
  if (
    !force &&
    canBackfillBilingualContentWithoutCollection(
      db,
      opportunity,
      config.researchFreshnessDays,
    )
  ) {
    return config;
  }
  if (
    !force &&
    reusableFailedResearchEvidence(
      db,
      opportunity,
      config.researchFreshnessDays,
    )
  ) {
    return config;
  }

  const estimate = estimateResearchCost(
    [opportunity],
    config,
    "standard",
    db,
    force,
  );
  if (!estimate.taskUnits) return config;
  const usage = new UsageLedger(db, config).today().dataForSeo;
  const projectedCostUsd = Number(
    (usage.reportedCostUsd + estimate.estimatedCostUsd).toFixed(6),
  );
  if (projectedCostUsd > usage.dailyCostLimitUsd) {
    throw new UsageBudgetExceededError(
      "DATAFORSEO",
      usage.dailyCostLimitUsd,
      "daily_cost",
    );
  }
  if (
    usage.monthlyCostUsd + estimate.estimatedCostUsd >
    usage.monthlyCostLimitUsd
  ) {
    throw new UsageBudgetExceededError(
      "DATAFORSEO",
      usage.monthlyCostLimitUsd,
      "monthly_cost",
    );
  }

  const projectedTasks = usage.used + estimate.taskUnits;
  if (projectedTasks <= usage.limit) return config;
  const details = {
    usedTasks: usage.used,
    taskLimit: usage.limit,
    estimatedAdditionalTasks: estimate.taskUnits,
    projectedTasks,
    currentCostUsd: usage.reportedCostUsd,
    estimatedAdditionalCostUsd: estimate.estimatedCostUsd,
    projectedCostUsd,
    dailyCostLimitUsd: usage.dailyCostLimitUsd,
  };
  if (!confirmTaskBudgetOverride) {
    throw new UsageBudgetConfirmationRequiredError(details);
  }
  logEvent("warn", "manual_dataforseo_task_budget_override", {
    opportunityId,
    ...details,
  });
  return {
    ...config,
    maxDataForSeoTasksPerDay: Math.ceil(projectedTasks),
  };
}

export function createApp(db: RadarDatabase, config: AppConfig) {
  const app = express();
  if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests:
            config.appEnv === "production" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(requestLogger);
  app.use(express.json({ limit: "2mb" }));

  const security = createSecurity(config, db);
  const researchRateLimiter = fixedWindowRateLimiter(
    config.researchRateLimitPerHour,
    60 * 60 * 1_000,
    "research",
  );

  app.get(["/api/health", "/api/health/live"], (_request, response) => {
    response.json({
      ok: true,
      service: "product-radar",
      time: now(),
    });
  });

  app.get("/api/health/ready", (_request, response) => {
    try {
      const databaseCheck = db.prepare("SELECT 1 AS ok").get() as { ok: number };
      const schemaVersion = (
        db
          .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
          .get() as { version: number }
      ).version;
      const ready =
        databaseCheck.ok === 1 && schemaVersion === latestSchemaVersion();
      response.status(ready ? 200 : 503).json({
        ok: ready,
        database: databaseCheck.ok === 1,
        schemaCurrent: schemaVersion === latestSchemaVersion(),
        time: now(),
      });
    } catch {
      response.status(503).json({ ok: false, database: false, time: now() });
    }
  });

  app.get(
    "/api/auth/session",
    security.requestRateLimiter,
    security.sessionResponse,
  );
  app.post(
    "/api/auth/login",
    security.loginRateLimiter,
    async (request, response, next) => {
      try {
        await security.login(request, response);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use("/api", security.requestRateLimiter);
  app.use("/api", security.requireAuthentication);
  app.use("/api", security.requireCsrf);
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post("/api/auth/logout", security.logout);
  app.get("/api/auth/account", security.accountResponse);
  app.patch("/api/auth/account", async (request, response, next) => {
    try {
      await security.updateAccount(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", (_request, response) => {
    response.json({
      ...runtimeSettingsResponse(config),
      researchMode: config.researchProvider === "real" ? "REAL" : "DEMO",
      aiConfigured: isAiConfigured(config),
      aiReasoningEffort: config.aiReasoningEffort,
      aiResponseStorageDisabled: config.aiDisableResponseStorage,
      searchConfigured: Boolean(config.dataForSeoLogin && config.dataForSeoPassword),
      researchFreshnessDays: config.researchFreshnessDays,
      researchRateLimitPerHour: config.researchRateLimitPerHour,
      automaticDiscovery: {
        enabled: config.autoDiscoveryEnabled,
        maxCandidatesPerRun: config.discoveryMaxCandidatesPerRun,
        signalLimit: config.discoveryAiSignalLimit,
        dailyCostLimitUsd:
          config.maxDataForSeoDiscoveryCostPerDayUsd,
        monthlyCostLimitUsd: config.maxDataForSeoCostPerMonthUsd,
      },
      market: {
        locationCode: config.marketLocationCode,
        languageCode: config.marketLanguageCode,
        countryCode: config.marketCountryCode,
      },
      sources: {
        webCompetitors: config.collectWebCompetitors,
        appleMarket: config.collectAppleMarket,
      },
    });
  });

  app.patch("/api/settings", (request, response, next) => {
    try {
      const input = runtimeSettingsUpdateSchema.parse(request.body);
      saveRuntimeSettings(db, config, input);
      response.json({
        ...runtimeSettingsResponse(config),
        researchMode: config.researchProvider === "real" ? "REAL" : "DEMO",
        aiConfigured: isAiConfigured(config),
        searchConfigured: Boolean(
          config.dataForSeoLogin && config.dataForSeoPassword,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/settings/test-ai",
    researchRateLimiter,
    async (request, response, next) => {
      try {
        const input = runtimeSettingsUpdateSchema.parse(request.body);
        const { preview } = previewRuntimeSettings(config, input);
        if (!isAiConfigured(preview)) {
          response.status(400).json({ error: "请先填写当前 AI 提供商的 API Key" });
          return;
        }
        const startedAt = Date.now();
        try {
          const result = await generateText({
            model: createResearchAiModel(preview),
            providerOptions: createResearchAiProviderOptions(preview),
            prompt: "只回复：连接正常",
            maxOutputTokens: preview.aiProvider === "deepseek" ? 1_024 : 32,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(preview.aiRequestTimeoutMs),
          });
          response.json({
            ok: true,
            provider: preview.aiProvider,
            model: preview.aiModel,
            elapsedMs: Date.now() - startedAt,
            message: result.text.trim() || "连接正常",
          });
        } catch (error) {
          response.status(502).json({ error: readableAiError(error) });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/dashboard", (_request, response) => {
    const scalar = (sql: string) =>
      Number((db.prepare(sql).get() as { count: number }).count);
    const data: DashboardData = {
      mode: config.researchProvider === "real" ? "REAL" : "DEMO",
      topOpportunities: rows(
        db,
        "SELECT * FROM opportunities WHERE research_status = 'READY' AND stale_since IS NULL AND verdict IN ('BUILD_NOW', 'VALIDATE_FIRST') ORDER BY score DESC LIMIT 5",
        mapOpportunity,
      ),
      risingOpportunities: rows(
        db,
        "SELECT * FROM opportunities WHERE research_status = 'READY' AND stale_since IS NULL AND score_delta > 0 ORDER BY score_delta DESC, score DESC LIMIT 5",
        mapOpportunity,
      ),
      watchlist: rows(
        db,
        "SELECT * FROM opportunities WHERE research_status = 'READY' AND stale_since IS NULL AND verdict = 'WATCH' ORDER BY score DESC LIMIT 4",
        mapOpportunity,
      ),
      products: rows(
        db,
        "SELECT * FROM products WHERE status != 'ARCHIVED' ORDER BY updated_at DESC LIMIT 5",
        mapProduct,
      ),
      stats: {
        opportunities: scalar("SELECT COUNT(*) AS count FROM opportunities"),
        buildNow: scalar(
          "SELECT COUNT(*) AS count FROM opportunities WHERE research_status = 'READY' AND stale_since IS NULL AND verdict = 'BUILD_NOW'",
        ),
        unresearched: scalar(
          "SELECT COUNT(*) AS count FROM opportunities WHERE research_status = 'UNRESEARCHED'",
        ),
        liveProducts: scalar(
          "SELECT COUNT(*) AS count FROM products WHERE status = 'LIVE'",
        ),
      },
    };
    response.json(data);
  });

  app.get("/api/opportunities", (request, response) => {
    const query = listQuerySchema.parse(request.query);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.query) {
      conditions.push("(name LIKE ? OR one_liner LIKE ? OR target_user LIKE ? OR localized_content_json LIKE ?)");
      const search = `%${query.query}%`;
      values.push(search, search, search, search);
    }
    if (query.platform) {
      conditions.push("recommended_platform = ?");
      values.push(query.platform);
    }
    if (query.market) {
      conditions.push(
        "EXISTS (SELECT 1 FROM json_each(opportunities.target_markets_json) WHERE UPPER(value) = UPPER(?))",
      );
      values.push(query.market);
    }
    if (query.language) {
      conditions.push("original_language = ?");
      values.push(query.language);
    }
    if (query.verdict) {
      conditions.push("verdict = ?");
      values.push(query.verdict);
      conditions.push("research_status = 'READY'");
      conditions.push("stale_since IS NULL");
    }
    if (query.researchStatus) {
      conditions.push("research_status = ?");
      values.push(query.researchStatus);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = (
      db.prepare(`SELECT COUNT(*) AS count FROM opportunities ${where}`).get(...values) as {
        count: number;
      }
    ).count;
    const offset = (query.page - 1) * query.pageSize;
    const currentDecisionOrder = ["score", "scoreDelta", "confidence"].includes(
      query.sortBy,
    )
      ? "CASE WHEN research_status = 'READY' AND stale_since IS NULL THEN 0 ELSE 1 END ASC,"
      : "";
    const marketSortColumns = {
      score: "CAST(json_extract(market_assessment.value, '$.score') AS REAL)",
      scoreDelta: "opportunities.score_delta",
      updatedAt: "opportunities.updated_at",
      name: "opportunities.name",
      confidence: "CAST(json_extract(market_assessment.value, '$.confidence') AS REAL)",
    } as const;
    const items = query.market
      ? (
          db
            .prepare(
              `SELECT opportunities.*,
                      market_assessment.value AS selected_market_assessment_json,
                      ? AS selected_market_code
               FROM opportunities
               LEFT JOIN json_each(opportunities.market_assessments_json) AS market_assessment
                 ON UPPER(json_extract(market_assessment.value, '$.marketCode')) = UPPER(?)
               ${where}
               GROUP BY opportunities.id
               ORDER BY CASE WHEN market_assessment.value IS NULL THEN 1 ELSE 0 END ASC,
                        ${currentDecisionOrder}
                        ${marketSortColumns[query.sortBy]} ${query.sortDirection.toUpperCase()},
                        opportunities.name ASC
               LIMIT ? OFFSET ?`,
            )
            .all(
              query.market,
              query.market,
              ...values,
              query.pageSize,
              offset,
            ) as Record<string, unknown>[]
        ).map(mapOpportunity)
      : rows(
          db,
          `SELECT * FROM opportunities ${where}
           ORDER BY ${currentDecisionOrder} ${sortColumns[query.sortBy]} ${query.sortDirection.toUpperCase()}, name ASC
           LIMIT ? OFFSET ?`,
          mapOpportunity,
          ...values,
          query.pageSize,
          offset,
        );
    const result: Paginated<Opportunity> = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / query.pageSize)),
    };
    response.json(result);
  });

  app.get("/api/opportunities/options", (request, response) => {
    const query = opportunityOptionsQuerySchema.parse(request.query);
    const values: unknown[] = [];
    const where = query.query
      ? "WHERE name LIKE ? OR one_liner LIKE ? OR localized_content_json LIKE ?"
      : "";
    if (query.query) {
      const search = `%${query.query}%`;
      values.push(search, search, search);
    }
    const options = (
      db
        .prepare(
          `SELECT id, name, recommended_platform, localized_content_json
           FROM opportunities
           ${where}
           ORDER BY CASE WHEN research_status = 'READY' AND stale_since IS NULL THEN 0 ELSE 1 END,
                    score DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(...values, query.limit) as Array<{
        id: string;
        name: string;
        recommended_platform: OpportunityOption["recommendedPlatform"];
        localized_content_json: string;
      }>
    ).map(
      (row): OpportunityOption => ({
        id: row.id,
        name: row.name,
        recommendedPlatform: row.recommended_platform,
        localizedContent: (() => {
          try {
            return JSON.parse(row.localized_content_json) as OpportunityOption["localizedContent"];
          } catch {
            return {};
          }
        })(),
      }),
    );
    response.json(options);
  });

  app.get("/api/opportunities/:id", (request, response) => {
    const { limit } = opportunityDetailQuerySchema.parse(request.query);
    const opportunityRow = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!opportunityRow) {
      response.status(404).json({ error: "找不到这个候选产品" });
      return;
    }
    const evidence = rows(
        db,
        "SELECT * FROM evidence_items WHERE opportunity_id = ? ORDER BY collected_at DESC LIMIT ?",
        mapEvidence,
        request.params.id,
        limit,
      );
    const reports = rows(
        db,
        "SELECT * FROM research_reports WHERE opportunity_id = ? ORDER BY version DESC LIMIT ?",
        mapReport,
        request.params.id,
        limit,
      );
    const reportIds = reports[0]?.evidenceIds ?? [];
    const reportFallback = reportIds.length
      ? rows(
          db,
          `SELECT * FROM evidence_items WHERE opportunity_id = ? AND id IN (${reportIds.map(() => "?").join(",")})`,
          mapEvidence,
          request.params.id,
          ...reportIds,
        )
      : [];
    const count = (table: "evidence_items" | "research_reports" | "signals") =>
      Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE opportunity_id = ?`)
            .get(request.params.id) as { count: number }
        ).count,
      );
    const detail: OpportunityDetail = {
      opportunity: mapOpportunity(opportunityRow),
      linkedProduct: (() => {
        const row = db
          .prepare("SELECT * FROM products WHERE source_opportunity_id = ?")
          .get(request.params.id) as Record<string, unknown> | undefined;
        return row ? mapProduct(row) : null;
      })(),
      reportEvidence: reportEvidenceFromSnapshot(
        request.params.id,
        reports[0],
        reportFallback,
      ),
      evidence,
      reports,
      signals: rows(
        db,
        "SELECT * FROM signals WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT ?",
        mapSignal,
        request.params.id,
        limit,
      ),
      totals: {
        evidence: count("evidence_items"),
        reports: count("research_reports"),
        signals: count("signals"),
      },
      limit,
    };
    response.json(detail);
  });

  app.patch("/api/opportunities/:id", (request, response) => {
    const input = opportunityUpdateSchema.parse(request.body);
    const updates = toSqlUpdates({
      ...input,
      ...(input.targetMarkets
        ? { targetMarkets: JSON.stringify(input.targetMarkets) }
        : {}),
      ...(input.localizedContent
        ? { localizedContent: JSON.stringify(input.localizedContent) }
        : {}),
    }, {
      name: "name",
      oneLiner: "one_liner",
      targetUser: "target_user",
      recommendedPlatform: "recommended_platform",
      originalLanguage: "original_language",
      targetMarkets: "target_markets_json",
      localizedContent: "localized_content_json",
    });
    if (updates.length) {
      const changedAt = now();
      db.prepare(
        `UPDATE opportunities
         SET ${updates.map((entry) => `${entry.column} = ?`).join(", ")},
             research_status = CASE WHEN research_status = 'RUNNING' THEN 'RUNNING' ELSE 'UNRESEARCHED' END,
             stale_since = ?,
             change_summary = '候选定义发生变化，等待重新调研。',
             updated_at = ?
         WHERE id = ?`,
      ).run(
        ...updates.map((entry) => entry.value),
        changedAt,
        changedAt,
        request.params.id,
      );
    }
    const row = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      response.status(404).json({ error: "找不到这个候选产品" });
      return;
    }
    response.json(mapOpportunity(row));
  });

  app.patch("/api/opportunities/:id/workflow", (request, response) => {
    const input = opportunityWorkflowUpdateSchema.parse(request.body);
    const opportunityRow = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!opportunityRow) {
      response.status(404).json({ error: "找不到这个候选产品" });
      return;
    }
    const report = db
      .prepare("SELECT 1 FROM research_reports WHERE opportunity_id = ? LIMIT 1")
      .get(request.params.id);
    if (!report) {
      response.status(409).json({ error: "候选完成首次调研后才能更新人工决策" });
      return;
    }
    const changedAt = now();
    db.prepare(
      `UPDATE opportunities
       SET workflow_status = ?, workflow_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.workflowStatus, changedAt, changedAt, request.params.id);
    const row = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown>;
    response.json(mapOpportunity(row));
  });

  app.post("/api/opportunities/:id/promote", (request, response) => {
    const opportunityRow = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!opportunityRow) {
      response.status(404).json({ error: "找不到这个候选产品" });
      return;
    }
    const latestReport = db
      .prepare(
        `SELECT recommended_action
         FROM research_reports
         WHERE opportunity_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(request.params.id) as { recommended_action: string } | undefined;
    if (!latestReport) {
      response.status(409).json({ error: "候选完成首次调研后才能转成产品" });
      return;
    }
    const existingRow = db
      .prepare("SELECT * FROM products WHERE source_opportunity_id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (existingRow) {
      const changedAt = now();
      db.prepare(
        `UPDATE opportunities
         SET workflow_status = 'APPROVED', workflow_updated_at = ?, updated_at = ?
         WHERE id = ? AND workflow_status != 'APPROVED'`,
      ).run(changedAt, changedAt, request.params.id);
      response.json({ product: mapProduct(existingRow), created: false });
      return;
    }

    const opportunity = mapOpportunity(opportunityRow);
    const createdAt = now();
    const product: Product = {
      id: randomUUID(),
      name: opportunity.name,
      platform: opportunity.recommendedPlatform,
      status: "BUILDING",
      url: null,
      description: opportunity.oneLiner,
      currentFocus: latestReport.recommended_action,
      sourceOpportunityId: opportunity.id,
      createdAt,
      updatedAt: createdAt,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO products (
          id, name, platform, status, url, description, current_focus,
          source_opportunity_id, created_at, updated_at
        ) VALUES (
          @id, @name, @platform, @status, @url, @description, @currentFocus,
          @sourceOpportunityId, @createdAt, @updatedAt
        )
      `).run(product);
      markPortfolioDependentResearchDue(db, createdAt);
      db.prepare(
        `UPDATE opportunities
         SET workflow_status = 'APPROVED', workflow_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(createdAt, createdAt, opportunity.id);
    })();
    response.status(201).json({ product, created: true });
  });

  app.post(
    "/api/opportunities/:id/research",
    researchRateLimiter,
    async (request, response, next) => {
      try {
        const input = researchRequestSchema.parse(request.body ?? {});
        const executionConfig = configForManualOpportunityResearch(
          db,
          config,
          String(request.params.id),
          input.force,
          input.confirmTaskBudgetOverride,
        );
        const opportunityRow = db
          .prepare("SELECT * FROM opportunities WHERE id = ?")
          .get(String(request.params.id)) as Record<string, unknown>;
        const opportunity = mapOpportunity(opportunityRow);
        if (
          executionConfig.researchProvider === "real" &&
          (input.force ||
            isOpportunityResearchDue(
              opportunity,
              executionConfig.researchFreshnessDays,
            ))
        ) {
          const job = startResearchJob(
            db,
            executionConfig,
            "manual",
            "standard",
            {
              targetOpportunityIds: [opportunity.id],
              forceRefreshIds: input.force ? [opportunity.id] : [],
            },
          );
          response.status(202).json({
            queued: true,
            jobId: job.jobId,
            status: job.status,
          });
          return;
        }
        const execution = await researchOpportunity(
          db,
          String(request.params.id),
          executionConfig,
          input,
        );
        response.status(execution.cached ? 200 : 201).json({
          ...execution.report,
          cached: execution.cached,
          freshnessDays: execution.freshnessDays,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/research/batch",
    researchRateLimiter,
    async (request, response, next) => {
      try {
        const input = batchResearchRequestSchema.parse(request.body ?? {});
        if (config.researchProvider === "real") {
          const job = startResearchJob(
            db,
            config,
            "manual",
            "standard",
          );
          response.status(202).json({
            queued: true,
            jobId: job.jobId,
            status: job.status,
          });
          return;
        }
        const job = await runResearchJob(
          db,
          config,
          "manual",
          input.delivery,
        );
        response.json(job.result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/operations/status", (_request, response) => {
    const freshness = db
      .prepare(
        `SELECT
           SUM(CASE WHEN research_status = 'RUNNING' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN research_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
           MAX(last_researched_at) AS latest_research_at
         FROM opportunities`,
      )
      .get() as {
      running: number | null;
      failed: number | null;
      latest_research_at: string | null;
    };
    const due = (
      db.prepare("SELECT * FROM opportunities").all() as Record<string, unknown>[]
    )
      .map(mapOpportunity)
      .filter((opportunity) =>
        isOpportunityResearchDue(opportunity, config.researchFreshnessDays),
      ).length;
    const jobs = db
      .prepare(
        `SELECT id, job_type, trigger_type, status, result_json, error, started_at, finished_at
         FROM job_runs
         ORDER BY started_at DESC
         LIMIT 12`,
      )
      .all() as Record<string, unknown>[];
    const backup = db
      .prepare(
        `SELECT status, path, size_bytes, integrity_result, finished_at
         FROM backup_runs
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          status: string;
          path: string | null;
          size_bytes: number | null;
          integrity_result: string | null;
          finished_at: string | null;
        }
      | undefined;
    const latestDiscovery = db
      .prepare(
        `SELECT status, result_json, started_at, finished_at
         FROM job_runs
         WHERE job_type = 'DISCOVERY'
           AND status != 'SKIPPED'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          status: string;
          result_json: string;
          started_at: string;
          finished_at: string | null;
        }
      | undefined;
    let discoveryResult: Record<string, unknown> = {};
    if (latestDiscovery?.result_json) {
      try {
        discoveryResult = JSON.parse(latestDiscovery.result_json) as Record<
          string,
          unknown
        >;
      } catch {
        discoveryResult = {};
      }
    }
    const status: OperationsStatus = {
      mode: config.researchProvider === "real" ? "REAL" : "DEMO",
      markets: config.researchMarkets.map((market) => ({
        locationCode: market.locationCode,
        languageCode: market.searchLanguageCode,
        countryCode: market.countryCode,
      })),
      market: {
        locationCode: config.marketLocationCode,
        languageCode: config.marketLanguageCode,
        countryCode: config.marketCountryCode,
      },
      sources: {
        ai: isAiConfigured(config),
        search: Boolean(config.dataForSeoLogin && config.dataForSeoPassword),
        webCompetitors: Boolean(
          config.dataForSeoLogin &&
            config.dataForSeoPassword &&
            config.collectWebCompetitors,
        ),
        appleMarket: Boolean(
          config.dataForSeoLogin &&
            config.dataForSeoPassword &&
            config.collectAppleMarket,
        ),
      },
      freshness: {
        due,
        running: Number(freshness.running ?? 0),
        failed: Number(freshness.failed ?? 0),
        latestResearchAt: freshness.latest_research_at,
      },
      usage: new UsageLedger(db, config).today(),
      scheduler: {
        enabled: config.schedulerEnabled,
        discoveryEnabled: config.autoDiscoveryEnabled,
        discoveryHour: config.schedulerDiscoveryHour,
        researchHour: config.schedulerResearchHour,
        backupHour: config.schedulerBackupHour,
        ...schedulerRuntimeStatus(db, config),
      },
      discovery: {
        latestAt:
          latestDiscovery?.finished_at ?? latestDiscovery?.started_at ?? null,
        latestStatus: latestDiscovery?.status ?? null,
        collectedSignals: Number(discoveryResult.collectedSignals ?? 0),
        createdCandidates: Number(discoveryResult.createdCandidates ?? 0),
        refreshedCandidates: Number(
          discoveryResult.refreshedCandidates ?? 0,
        ),
        collectionReused: Boolean(discoveryResult.collectionReused),
      },
      jobs: jobs.map(jobRunFromRow),
      latestBackup: backup
        ? {
            status: backup.status,
            fileName: backup.path
              ? backup.path.split(/[\\/]/).at(-1) ?? null
              : null,
            sizeBytes: backup.size_bytes,
            integrity: backup.integrity_result,
            finishedAt: backup.finished_at,
          }
        : null,
    };
    response.json(status);
  });

  app.get("/api/jobs/:id", (request, response) => {
    const row = db
      .prepare(
        `SELECT id, job_type, trigger_type, status, result_json, error, started_at, finished_at
         FROM job_runs
         WHERE id = ?`,
      )
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      response.status(404).json({ error: "找不到这个任务" });
      return;
    }
    response.json(jobRunFromRow(row));
  });

  app.post(
    "/api/operations/discovery",
    researchRateLimiter,
    async (_request, response, next) => {
      try {
        const job = startDiscoveryPipeline(db, config, "manual");
        void job.pipelineCompletion.catch(() => undefined);
        response.status(202).json({
          jobId: job.jobId,
          status: job.status,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/operations/research",
    researchRateLimiter,
    async (_request, response, next) => {
      try {
        const job = startResearchJob(db, config, "manual", "standard");
        void job.completion.catch(() => undefined);
        response.status(202).json({
          jobId: job.jobId,
          status: job.status,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/operations/backup", async (_request, response, next) => {
    try {
      const job = startBackupJob(db, config, "manual");
      void job.completion.catch(() => undefined);
      response.status(202).json({
        jobId: job.jobId,
        status: job.status,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products", (_request, response) => {
    response.json(
      rows(db, "SELECT * FROM products ORDER BY updated_at DESC", mapProduct),
    );
  });

  app.get("/api/products/import/template", (_request, response) => {
    sendCsvTemplate(
      response,
      "product-radar-products-template.csv",
      productCsvTemplate,
    );
  });

  app.post("/api/products/import/preview", (request, response) => {
    const { csv } = csvImportRequestSchema.parse(request.body);
    response.json(previewProductImport(db, csv).preview);
  });

  app.post("/api/products/import", (request, response) => {
    const { csv } = csvImportRequestSchema.parse(request.body);
    const result = db.transaction(() => {
      const analyzed = previewProductImport(db, csv);
      if (analyzed.preview.issues.length || analyzed.preview.errorRows) {
        return { analyzed, imported: 0 };
      }
      const changedAt = now();
      const statement = db.prepare(`
        INSERT INTO products (
          id, name, platform, status, url, description, current_focus,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const product of analyzed.importable) {
        statement.run(
          randomUUID(),
          product.name,
          product.platform,
          product.status,
          product.url,
          product.description,
          product.currentFocus,
          changedAt,
          changedAt,
        );
      }
      if (analyzed.importable.length) {
        markPortfolioDependentResearchDue(db, changedAt);
      }
      return { analyzed, imported: analyzed.importable.length };
    })();
    if (result.analyzed.preview.issues.length || result.analyzed.preview.errorRows) {
      response.status(400).json({
        error: csvImportError(result.analyzed.preview, "产品"),
        details: result.analyzed.preview,
      });
      return;
    }
    response.status(201).json({
      imported: result.imported,
      skippedDuplicates: result.analyzed.preview.duplicateRows,
      totalRows: result.analyzed.preview.totalRows,
    });
  });

  app.post("/api/products", (request, response) => {
    const input = createProductSchema.parse(request.body);
    const product: Product = {
      id: randomUUID(),
      name: input.name,
      platform: input.platform,
      status: input.status,
      url: input.url || null,
      description: input.description,
      currentFocus: input.currentFocus,
      sourceOpportunityId: null,
      createdAt: now(),
      updatedAt: now(),
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO products (
          id, name, platform, status, url, description, current_focus, created_at, updated_at
        ) VALUES (
          @id, @name, @platform, @status, @url, @description, @currentFocus, @createdAt, @updatedAt
        )
      `).run(product);
      markPortfolioDependentResearchDue(db, product.updatedAt);
    })();
    response.status(201).json(product);
  });

  app.patch("/api/products/:id", (request, response) => {
    const input = updateProductSchema.parse(request.body);
    const updates = toSqlUpdates(input, {
      name: "name",
      platform: "platform",
      status: "status",
      url: "url",
      description: "description",
      currentFocus: "current_focus",
    }, new Set(["url"]));
    if (updates.length) {
      const changedAt = now();
      db.transaction(() => {
        const result = db.prepare(
          `UPDATE products SET ${updates.map((entry) => `${entry.column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
        ).run(
          ...updates.map((entry) => entry.value),
          changedAt,
          request.params.id,
        );
        if (result.changes > 0) {
          markPortfolioDependentResearchDue(db, changedAt);
        }
      })();
    }
    const row = db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      response.status(404).json({ error: "找不到这个产品" });
      return;
    }
    response.json(mapProduct(row));
  });

  app.get("/api/signals", (request, response) => {
    if (request.query.page === undefined) {
      response.json(
        rows(db, "SELECT * FROM signals ORDER BY created_at DESC", mapSignal),
      );
      return;
    }
    const query = signalListQuerySchema.parse(request.query);
    const total = Number(
      (
        db.prepare("SELECT COUNT(*) AS count FROM signals").get() as {
          count: number;
        }
      ).count,
    );
    const activityRow = db
      .prepare(
        `SELECT
           MAX(updated_at) AS latest_updated_at,
           SUM(CASE
             WHEN auto_collected = 1
              AND opportunity_id IS NULL
              AND ai_reviewed_at IS NULL
             THEN 1 ELSE 0
           END) AS waiting_ai
         FROM signals`,
      )
      .get() as {
        latest_updated_at: string | null;
        waiting_ai: number | null;
      };
    const latestDiscovery = db
      .prepare(
        `SELECT status, result_json, started_at, finished_at
         FROM job_runs
         WHERE job_type = 'DISCOVERY'
           AND status != 'SKIPPED'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          status: string;
          result_json: string;
          started_at: string;
          finished_at: string | null;
        }
      | undefined;
    let latestDiscoveryResult: Record<string, unknown> = {};
    if (latestDiscovery?.result_json) {
      try {
        latestDiscoveryResult = JSON.parse(
          latestDiscovery.result_json,
        ) as Record<string, unknown>;
      } catch {
        latestDiscoveryResult = {};
      }
    }
    const result: SignalPage = {
      items: rows(
        db,
        "SELECT * FROM signals ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        mapSignal,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      activity: {
        latestUpdatedAt: activityRow.latest_updated_at,
        waitingAi: Number(activityRow.waiting_ai ?? 0),
        latestDiscoveryAt:
          latestDiscovery?.finished_at ?? latestDiscovery?.started_at ?? null,
        latestDiscoveryStatus: latestDiscovery?.status ?? null,
        collectedSignals: Number(
          latestDiscoveryResult.collectedSignals ?? 0,
        ),
        insertedSignals: Number(latestDiscoveryResult.insertedSignals ?? 0),
        reusedSignals: Number(latestDiscoveryResult.reusedSignals ?? 0),
      },
    };
    response.json(result);
  });

  app.post("/api/signals", (request, response) => {
    const input = createSignalSchema.parse(request.body);
    const createdAt = now();
    const signal: Signal = {
      id: randomUUID(),
      sourceType: input.sourceType,
      title: input.title,
      content: input.content,
      sourceUrl: input.sourceUrl || null,
      tags: input.tags,
      status: "NEW",
      opportunityId: null,
      market: input.market || null,
      originalLanguage:
        input.originalLanguage ??
        languageFromMarket(input.market, input.title, input.content),
      createdAt,
      updatedAt: createdAt,
    };
    db.prepare(`
      INSERT INTO signals (
        id, source_type, title, content, source_url, tags_json, status,
        opportunity_id, market, original_language, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?, ?, ?)
    `).run(
      signal.id,
      signal.sourceType,
      signal.title,
      signal.content,
      signal.sourceUrl,
      JSON.stringify(signal.tags),
      signal.market,
      signal.originalLanguage,
      createdAt,
      createdAt,
    );
    response.status(201).json(signal);
  });

  app.get("/api/signals/import/template", (_request, response) => {
    sendCsvTemplate(
      response,
      "product-radar-evidence-template.csv",
      signalCsvTemplate,
    );
  });

  app.post("/api/signals/import/preview", (request, response) => {
    const { csv } = csvImportRequestSchema.parse(request.body);
    response.json(previewSignalImport(db, csv).preview);
  });

  app.post("/api/signals/import", (request, response) => {
    const { csv } = csvImportRequestSchema.parse(request.body);
    const result = db.transaction(() => {
      const analyzed = previewSignalImport(db, csv);
      if (analyzed.preview.issues.length || analyzed.preview.errorRows) {
        return { analyzed, imported: 0 };
      }
      const importedAt = now();
      const statement = db.prepare(`
        INSERT INTO signals (
          id, source_type, title, content, source_url, tags_json, status,
          opportunity_id, fingerprint, market, original_language, source_name,
          metrics_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      for (const signal of analyzed.importable) {
        statement.run(
          randomUUID(),
          signal.sourceType,
          signal.title,
          signal.content,
          signal.sourceUrl,
          JSON.stringify(signal.tags),
          signal.fingerprint,
          signal.market,
          signal.originalLanguage,
          signal.sourceName,
          JSON.stringify({
            _importSource: "csv",
            ...(signal.externalId ? { _externalId: signal.externalId } : {}),
          }),
          signal.collectedAt ?? importedAt,
          importedAt,
        );
      }
      return { analyzed, imported: analyzed.importable.length };
    })();
    if (result.analyzed.preview.issues.length || result.analyzed.preview.errorRows) {
      response.status(400).json({
        error: csvImportError(result.analyzed.preview, "证据"),
        details: result.analyzed.preview,
      });
      return;
    }
    response.status(201).json({
      imported: result.imported,
      skippedDuplicates: result.analyzed.preview.duplicateRows,
      totalRows: result.analyzed.preview.totalRows,
    });
  });

  app.post("/api/signals/:id/link", (request, response) => {
    const input = linkSignalSchema.parse(request.body);
    const signalRow = db
      .prepare("SELECT * FROM signals WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!signalRow) {
      response.status(404).json({ error: "找不到这条信号" });
      return;
    }
    const signal = mapSignal(signalRow);
    linkSignalEvidence(db, signal, input.opportunityId);
    const opportunity = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(input.opportunityId) as Record<string, unknown>;
    response.json(mapOpportunity(opportunity));
  });

  app.post("/api/signals/:id/process", (request, response) => {
    const requestedLink = z
      .object({ opportunityId: z.string().uuid().optional() })
      .parse(request.body ?? {});
    const signalRow = db
      .prepare("SELECT * FROM signals WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!signalRow) {
      response.status(404).json({ error: "找不到这条信号" });
      return;
    }
    const signal = mapSignal(signalRow);
    if (requestedLink.opportunityId) {
      linkSignalEvidence(db, signal, requestedLink.opportunityId);
      const linked = db
        .prepare("SELECT * FROM opportunities WHERE id = ?")
        .get(requestedLink.opportunityId) as Record<string, unknown>;
      response.json(mapOpportunity(linked));
      return;
    }
    if (signal.opportunityId) {
      linkSignalEvidence(db, signal, signal.opportunityId);
      const existing = db
        .prepare("SELECT * FROM opportunities WHERE id = ?")
        .get(signal.opportunityId) as Record<string, unknown>;
      response.json(mapOpportunity(existing));
      return;
    }

    const createdAt = now();
    const opportunityId = randomUUID();
    const language = signal.originalLanguage ?? detectContentLanguage(
      signal.title,
      signal.content,
    );
    const locale = language === "en" ? "en" : "zh-CN";
    const linkedMarket = marketCode(signal.market);
    const targetMarkets = [linkedMarket || (language === "en" ? "US" : "CN")];
    const name = signal.title.slice(0, 120);
    const oneLiner = signal.content.replace(/\s+/g, " ").slice(0, 240);
    const targetUser = language === "en"
      ? `People experiencing the problem described as “${signal.title}”`
      : `遇到“${signal.title}”相关问题的目标用户`;
    const pendingResearch = language === "en"
      ? "Created from a signal and awaiting initial research."
      : "由信号生成，等待首次调研。";
    const platform =
      /iphone|ios|app store|mobile|手机|相册|照片/i.test(
        `${signal.title} ${signal.content}`,
      )
        ? "IOS"
        : "WEB";
    db.transaction(() => {
      db.prepare(`
        INSERT INTO opportunities (
          id, name, one_liner, target_user, source_type, recommended_platform,
          verdict, research_status, score, score_delta, confidence,
          change_summary, original_language, target_markets_json,
          localized_content_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'WATCH', 'UNRESEARCHED', 0, 0, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        opportunityId,
        name,
        oneLiner,
        targetUser,
        signal.sourceType,
        platform,
        pendingResearch,
        language,
        JSON.stringify(targetMarkets),
        JSON.stringify({
          [locale]: {
            name,
            oneLiner,
            targetUser,
            changeSummary: pendingResearch,
          },
        }),
        createdAt,
        createdAt,
      );
      linkSignalEvidence(db, signal, opportunityId);
    })();
    const created = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(opportunityId) as Record<string, unknown>;
    response.status(201).json(mapOpportunity(created));
  });

  app.use(handleError);
  return app;
}

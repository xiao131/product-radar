import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { parseSignalCsv } from "./csv.js";
import type { RadarDatabase } from "./db.js";
import {
  mapEvidence,
  mapOpportunity,
  mapProduct,
  mapReport,
  mapSignal,
} from "./mappers.js";
import { researchOpportunity } from "./research.js";
import {
  createProductSchema,
  createSignalSchema,
  opportunityUpdateSchema,
  updateProductSchema,
} from "../shared/schemas.js";
import type {
  DashboardData,
  Opportunity,
  OpportunityDetail,
  Paginated,
  Product,
  Signal,
} from "../shared/types.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z
    .enum(["score", "scoreDelta", "updatedAt", "name", "confidence"])
    .default("score"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  query: z.string().trim().max(120).optional(),
  platform: z.enum(["WEB", "IOS", "WEB_AND_IOS"]).optional(),
  verdict: z.enum(["BUILD_NOW", "VALIDATE_FIRST", "WATCH", "SKIP"]).optional(),
  researchStatus: z.enum(["UNRESEARCHED", "READY", "RUNNING", "FAILED"]).optional(),
});

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

function toSqlUpdates(input: Record<string, unknown>, mapping: Record<string, string>) {
  return Object.entries(input)
    .filter(([key]) => mapping[key])
    .map(([key, value]) => ({ column: mapping[key], value: value === "" ? null : value }));
}

function handleError(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "输入内容不符合要求", details: error.flatten() });
    return;
  }
  const message = error instanceof Error ? error.message : "服务器发生未知错误";
  const status = /找不到/.test(message) ? 404 : /^CSV /.test(message) ? 400 : 500;
  response.status(status).json({ error: message });
}

export function createApp(db: RadarDatabase, config: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      mode: config.researchProvider === "real" ? "REAL" : "DEMO",
      time: now(),
    });
  });

  app.get("/api/settings", (_request, response) => {
    response.json({
      researchMode: config.researchProvider === "real" ? "REAL" : "DEMO",
      aiModel: config.aiModel,
      aiConfigured: Boolean(config.aiGatewayApiKey),
      searchConfigured: Boolean(config.dataForSeoLogin && config.dataForSeoPassword),
      databasePath: config.databasePath,
    });
  });

  app.get("/api/dashboard", (_request, response) => {
    const scalar = (sql: string) =>
      Number((db.prepare(sql).get() as { count: number }).count);
    const data: DashboardData = {
      mode: config.researchProvider === "real" ? "REAL" : "DEMO",
      topOpportunities: rows(
        db,
        "SELECT * FROM opportunities WHERE verdict IN ('BUILD_NOW', 'VALIDATE_FIRST') ORDER BY score DESC LIMIT 5",
        mapOpportunity,
      ),
      risingOpportunities: rows(
        db,
        "SELECT * FROM opportunities WHERE score_delta > 0 ORDER BY score_delta DESC, score DESC LIMIT 5",
        mapOpportunity,
      ),
      watchlist: rows(
        db,
        "SELECT * FROM opportunities WHERE verdict = 'WATCH' ORDER BY score DESC LIMIT 4",
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
          "SELECT COUNT(*) AS count FROM opportunities WHERE verdict = 'BUILD_NOW'",
        ),
        unresearched: scalar(
          "SELECT COUNT(*) AS count FROM opportunities WHERE research_status = 'UNRESEARCHED'",
        ),
        signalsWaiting: scalar(
          "SELECT COUNT(*) AS count FROM signals WHERE status = 'NEW'",
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
      conditions.push("(name LIKE ? OR one_liner LIKE ? OR target_user LIKE ?)");
      const search = `%${query.query}%`;
      values.push(search, search, search);
    }
    if (query.platform) {
      conditions.push("recommended_platform = ?");
      values.push(query.platform);
    }
    if (query.verdict) {
      conditions.push("verdict = ?");
      values.push(query.verdict);
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
    const items = rows(
      db,
      `SELECT * FROM opportunities ${where}
       ORDER BY ${sortColumns[query.sortBy]} ${query.sortDirection.toUpperCase()}, name ASC
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

  app.get("/api/opportunities/:id", (request, response) => {
    const opportunityRow = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!opportunityRow) {
      response.status(404).json({ error: "找不到这个候选产品" });
      return;
    }
    const detail: OpportunityDetail = {
      opportunity: mapOpportunity(opportunityRow),
      evidence: rows(
        db,
        "SELECT * FROM evidence_items WHERE opportunity_id = ? ORDER BY collected_at DESC",
        mapEvidence,
        request.params.id,
      ),
      reports: rows(
        db,
        "SELECT * FROM research_reports WHERE opportunity_id = ? ORDER BY version DESC",
        mapReport,
        request.params.id,
      ),
      signals: rows(
        db,
        "SELECT * FROM signals WHERE opportunity_id = ? ORDER BY created_at DESC",
        mapSignal,
        request.params.id,
      ),
    };
    response.json(detail);
  });

  app.patch("/api/opportunities/:id", (request, response) => {
    const input = opportunityUpdateSchema.parse(request.body);
    const updates = toSqlUpdates(input, {
      name: "name",
      oneLiner: "one_liner",
      targetUser: "target_user",
      recommendedPlatform: "recommended_platform",
    });
    if (updates.length) {
      db.prepare(
        `UPDATE opportunities SET ${updates.map((entry) => `${entry.column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      ).run(...updates.map((entry) => entry.value), now(), request.params.id);
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

  app.post("/api/opportunities/:id/research", async (request, response, next) => {
    try {
      const report = await researchOpportunity(db, request.params.id, config);
      response.status(201).json(report);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products", (_request, response) => {
    response.json(
      rows(db, "SELECT * FROM products ORDER BY updated_at DESC", mapProduct),
    );
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
      createdAt: now(),
      updatedAt: now(),
    };
    db.prepare(`
      INSERT INTO products (
        id, name, platform, status, url, description, current_focus, created_at, updated_at
      ) VALUES (
        @id, @name, @platform, @status, @url, @description, @currentFocus, @createdAt, @updatedAt
      )
    `).run(product);
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
    });
    if (updates.length) {
      db.prepare(
        `UPDATE products SET ${updates.map((entry) => `${entry.column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      ).run(...updates.map((entry) => entry.value), now(), request.params.id);
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

  app.get("/api/signals", (_request, response) => {
    response.json(
      rows(db, "SELECT * FROM signals ORDER BY created_at DESC", mapSignal),
    );
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
      createdAt,
      updatedAt: createdAt,
    };
    db.prepare(`
      INSERT INTO signals (
        id, source_type, title, content, source_url, tags_json, status,
        opportunity_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?)
    `).run(
      signal.id,
      signal.sourceType,
      signal.title,
      signal.content,
      signal.sourceUrl,
      JSON.stringify(signal.tags),
      createdAt,
      createdAt,
    );
    response.status(201).json(signal);
  });

  app.post("/api/signals/import", (request, response) => {
    const csv = z.object({ csv: z.string().min(1).max(1_500_000) }).parse(request.body).csv;
    const imported = parseSignalCsv(csv);
    const createdAt = now();
    const statement = db.prepare(`
      INSERT INTO signals (
        id, source_type, title, content, source_url, tags_json, status,
        opportunity_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?)
    `);
    const insert = db.transaction(() =>
      imported.map((signal) => {
        const id = randomUUID();
        statement.run(
          id,
          signal.sourceType,
          signal.title,
          signal.content,
          signal.sourceUrl,
          JSON.stringify(signal.tags),
          createdAt,
          createdAt,
        );
        return { ...signal, id };
      }),
    );
    response.status(201).json({ imported: insert().length });
  });

  app.post("/api/signals/:id/process", (request, response) => {
    const signalRow = db
      .prepare("SELECT * FROM signals WHERE id = ?")
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!signalRow) {
      response.status(404).json({ error: "找不到这条信号" });
      return;
    }
    const signal = mapSignal(signalRow);
    if (signal.opportunityId) {
      const existing = db
        .prepare("SELECT * FROM opportunities WHERE id = ?")
        .get(signal.opportunityId) as Record<string, unknown>;
      response.json(mapOpportunity(existing));
      return;
    }

    const createdAt = now();
    const opportunityId = randomUUID();
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
          change_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'WATCH', 'UNRESEARCHED', 0, 0, 0, ?, ?, ?)
      `).run(
        opportunityId,
        signal.title.slice(0, 120),
        signal.content.replace(/\s+/g, " ").slice(0, 240),
        `遇到“${signal.title}”相关问题的目标用户`,
        signal.sourceType,
        platform,
        "由信号生成，等待首次调研。",
        createdAt,
        createdAt,
      );
      db.prepare(
        "UPDATE signals SET status = 'PROCESSED', opportunity_id = ?, updated_at = ? WHERE id = ?",
      ).run(opportunityId, createdAt, signal.id);
    })();
    const created = db
      .prepare("SELECT * FROM opportunities WHERE id = ?")
      .get(opportunityId) as Record<string, unknown>;
    response.status(201).json(mapOpportunity(created));
  });

  app.use(handleError);
  return app;
}

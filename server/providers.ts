import { createHash, randomUUID } from "node:crypto";
import type { AppConfig, ResearchMarket } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { mapEvidence } from "./mappers.js";
import { RetryableProviderError, withRetry } from "./retry.js";
import { UsageLedger } from "./usage.js";
import type { EvidenceItem, Opportunity } from "../shared/types.js";

export interface ResearchDataProvider {
  readonly mode: "DEMO" | "REAL";
  collect(opportunity: Opportunity, version: number): Promise<EvidenceItem[]>;
  collectBatch(
    requests: ResearchCollectionRequest[],
    delivery?: ResearchDelivery,
  ): Promise<Map<string, EvidenceItem[]>>;
}

export type ResearchDelivery = "live" | "standard";

export interface ResearchCollectionRequest {
  opportunity: Opportunity;
  version: number;
  forceRefresh?: boolean;
}

export interface ResearchCostEstimate {
  taskUnits: number;
  estimatedCostUsd: number;
}

const LABS_BASE_COST_USD = 0.012;
const LABS_ITEM_COST_USD = 0.00012;
const GOOGLE_ADS_STANDARD_COST_USD = 0.06;
const GOOGLE_ADS_LIVE_COST_USD = 0.09;
const SERP_STANDARD_COST_USD = 0.0006;
const APP_SEARCH_COST_USD = 0.0012;

function normalizedKeyword(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function keywordFor(opportunity: Opportunity) {
  return normalizedKeyword(opportunity.name);
}

function marketCode(value: string | null | undefined) {
  return value?.split("/", 1)[0]?.trim().toUpperCase() ?? "";
}

export function researchMarketsForOpportunity(
  opportunity: Opportunity,
  config: Pick<AppConfig, "researchMarkets">,
  db?: RadarDatabase,
) {
  if (!db) return config.researchMarkets;
  const rows = db
    .prepare(
      `SELECT DISTINCT market
       FROM signals
       WHERE opportunity_id = ? AND market IS NOT NULL`,
    )
    .all(opportunity.id) as Array<{ market: string | null }>;
  const hintedCodes = new Set(rows.map((row) => marketCode(row.market)).filter(Boolean));
  if (!hintedCodes.size) return config.researchMarkets;
  const selected = config.researchMarkets.filter((market) =>
    hintedCodes.has(market.countryCode),
  );
  return selected.length ? selected : config.researchMarkets;
}

export function researchKeywordsForOpportunity(
  opportunity: Opportunity,
  db?: RadarDatabase,
) {
  const candidates: string[] = [];
  if (db) {
    const rows = db
      .prepare(
        `SELECT title, source_name, metrics_json
         FROM signals
         WHERE opportunity_id = ?
           AND source_type IN ('SEARCH', 'TREND')
         ORDER BY updated_at DESC
         LIMIT 12`,
      )
      .all(opportunity.id) as Array<{
      title: string;
      source_name: string | null;
      metrics_json: string;
    }>;
    for (const row of rows) {
      let metrics: Record<string, unknown> = {};
      try {
        metrics = JSON.parse(row.metrics_json) as Record<string, unknown>;
      } catch {
        metrics = {};
      }
      if (
        row.source_name?.includes("DataForSEO Labs") ||
        typeof metrics.searchVolume === "number"
      ) {
        candidates.push(row.title);
      }
    }
  }
  candidates.push(keywordFor(opportunity));
  return [
    ...new Set(
      candidates
        .map(normalizedKeyword)
        .filter((keyword) => keyword.length >= 2 && keyword.split(" ").length <= 10)
        .map((keyword) => keyword.toLocaleLowerCase()),
    ),
  ].slice(0, 3);
}

function shouldUseLabs(market: ResearchMarket) {
  return market.countryCode !== "CN";
}

function evidenceFingerprint(...parts: string[]) {
  return createHash("sha256")
    .update(parts.map((part) => part.trim().toLocaleLowerCase()).join("|"))
    .digest("hex");
}

function cachedEvidenceRows(
  db: RadarDatabase | undefined,
  opportunity: Opportunity,
  sourceKey: string,
  market: ResearchMarket,
  keyword: string,
  metrics: string[],
  freshnessDays: number,
) {
  if (!db || !metrics.length) return [];
  const label = `${market.countryCode}/${market.searchLanguageCode}`;
  const fingerprints = metrics.map((metric) =>
    evidenceFingerprint(
      opportunity.id,
      sourceKey,
      label,
      keyword,
      metric,
    ),
  );
  const placeholders = fingerprints.map(() => "?").join(", ");
  const cutoff = new Date(
    Date.now() - freshnessDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  return (
    db
      .prepare(
        `SELECT * FROM evidence_items
         WHERE opportunity_id = ?
           AND fingerprint IN (${placeholders})
           AND collected_at >= ?`,
      )
      .all(opportunity.id, ...fingerprints, cutoff) as Record<string, unknown>[]
  ).map(mapEvidence);
}

export function estimateResearchCost(
  opportunities: Opportunity[],
  config: AppConfig,
  delivery: ResearchDelivery = "standard",
  db?: RadarDatabase,
  forceRefresh = false,
): ResearchCostEstimate {
  if (config.researchProvider !== "real" || !opportunities.length) {
    return { taskUnits: 0, estimatedCostUsd: 0 };
  }
  let taskUnits = 0;
  let estimatedCostUsd = 0;
  for (const market of config.researchMarkets) {
    const marketOpportunities = opportunities.filter((opportunity) =>
      researchMarketsForOpportunity(opportunity, config, db).some(
        (candidate) => candidate.countryCode === market.countryCode,
      ),
    );
    if (!marketOpportunities.length) continue;
    const keywords = new Set<string>();
    for (const opportunity of marketOpportunities) {
      for (const keyword of researchKeywordsForOpportunity(opportunity, db)) {
        const cached = forceRefresh
          ? []
          : cachedEvidenceRows(
              db,
              opportunity,
              "keyword",
              market,
              keyword,
              ["monthly_searches", "monthly_series_change", "cpc"],
              config.researchKeywordCacheDays,
            );
        if (cached.length !== 3) keywords.add(keyword);
      }
    }
    if (keywords.size > 0 && shouldUseLabs(market)) {
      taskUnits += Math.ceil(keywords.size / 700);
      estimatedCostUsd +=
        Math.ceil(keywords.size / 700) * LABS_BASE_COST_USD +
        keywords.size * LABS_ITEM_COST_USD;
    } else if (keywords.size > 0) {
      taskUnits += Math.ceil(keywords.size / 1000);
      estimatedCostUsd +=
        Math.ceil(keywords.size / 1000) *
        (delivery === "live"
          ? GOOGLE_ADS_LIVE_COST_USD
          : GOOGLE_ADS_STANDARD_COST_USD);
    }
    for (const opportunity of marketOpportunities) {
      if (
        config.collectWebCompetitors &&
        opportunity.recommendedPlatform !== "IOS"
      ) {
        const keyword =
          researchKeywordsForOpportunity(opportunity, db)[0] ??
          keywordFor(opportunity);
        const cached = forceRefresh
          ? []
          : cachedEvidenceRows(
              db,
              opportunity,
              "serp",
              market,
              keyword,
              ["organic_competitor_domains", "serp_results_count"],
              config.researchSerpCacheDays,
            );
        if (cached.length !== 2) {
          taskUnits += 1;
          estimatedCostUsd +=
            delivery === "live" ? 0.002 : SERP_STANDARD_COST_USD;
        }
      }
      if (
        config.collectAppleMarket &&
        opportunity.recommendedPlatform !== "WEB"
      ) {
        const keyword =
          researchKeywordsForOpportunity(opportunity, db)[0] ??
          keywordFor(opportunity);
        const cached = forceRefresh
          ? []
          : cachedEvidenceRows(
              db,
              opportunity,
              "apple",
              market,
              keyword,
              [
                "app_store_competitors",
                "competitor_average_rating",
                "competitor_review_volume",
              ],
              config.researchAppCacheDays,
            );
        if (cached.length !== 3) {
          taskUnits += 1;
          estimatedCostUsd += APP_SEARCH_COST_USD;
        }
      }
    }
  }
  return {
    taskUnits,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  };
}

function stableNumber(input: string, min: number, max: number) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

export class DemoResearchProvider implements ResearchDataProvider {
  readonly mode = "DEMO" as const;

  async collect(opportunity: Opportunity, version: number): Promise<EvidenceItem[]> {
    const now = new Date().toISOString();
    const demand = stableNumber(`${opportunity.name}:demand`, 45, 92);
    const complaints = stableNumber(`${opportunity.name}:pain`, 18, 58);
    const competition = stableNumber(`${opportunity.name}:competition`, 35, 86);
    const trendBase = stableNumber(`${opportunity.name}:trend`, -8, 22);
    const trendChange = Math.max(-15, Math.min(35, trendBase + (version % 3) * 3));

    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "SEARCH",
        sourceName: "Demo Search Dataset",
        sourceUrl: null,
        metric: "monthly_searches",
        value: demand * 43,
        unit: "queries",
        direction: trendChange > 5 ? "UP" : trendChange < -3 ? "DOWN" : "FLAT",
        strength: demand,
        summary: `与“${keywordFor(opportunity)}”相关的演示搜索需求为 ${demand * 43} 次/月。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: "DEMO",
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "TREND",
        sourceName: "Demo Trend Dataset",
        sourceUrl: null,
        metric: "ninety_day_change",
        value: trendChange,
        unit: "%",
        direction: trendChange > 5 ? "UP" : trendChange < -3 ? "DOWN" : "FLAT",
        strength: Math.min(90, 55 + Math.abs(trendChange)),
        summary: `过去 90 天相关需求变化 ${trendChange >= 0 ? "+" : ""}${trendChange}%。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: "DEMO",
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPLAINT",
        sourceName: `${opportunity.sourceType} Demo Sample`,
        sourceUrl: null,
        metric: "qualified_complaints",
        value: complaints,
        unit: "mentions",
        direction: complaints > 35 ? "UP" : "FLAT",
        strength: Math.min(95, complaints + 28),
        summary: `样本中发现 ${complaints} 条可归为同一工作流的具体抱怨。`,
        rawExcerpt: `用户反复描述：现有方案步骤太多，真正需要的是“${opportunity.oneLiner}”。`,
        collectedAt: now,
        freshnessDays: 0,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPETITOR",
        sourceName: "Demo Competitor Scan",
        sourceUrl: null,
        metric: "competition_density",
        value: competition,
        unit: "score",
        direction: "FLAT",
        strength: 72,
        summary: `同类供给密度 ${competition}/100；需结合差评空档判断能否切入。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: "DEMO",
      },
    ];
  }

  async collectBatch(requests: ResearchCollectionRequest[]) {
    const entries = await Promise.all(
      requests.map(async ({ opportunity, version }) => [
        opportunity.id,
        await this.collect(opportunity, version),
      ] as const),
    );
    return new Map(entries);
  }
}

interface DataForSeoTask<T> {
  id?: string;
  status_code: number;
  status_message: string;
  cost?: number;
  data?: { tag?: string };
  result?: T[] | null;
}

interface DataForSeoResponse<T> {
  cost?: number;
  status_code?: number;
  status_message?: string;
  tasks?: Array<DataForSeoTask<T>>;
}

interface SearchVolumeResult {
  keyword?: string;
  search_volume?: number;
  competition?: number | string;
  competition_index?: number;
  cpc?: number;
  monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
  search_intent?: string | null;
  keyword_difficulty?: number | null;
}

interface LabsKeywordItem {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    competition?: number | null;
    cpc?: number | null;
    monthly_searches?: Array<{
      year: number;
      month: number;
      search_volume: number;
    }>;
  };
  search_intent_info?: { main_intent?: string | null };
  keyword_properties?: { keyword_difficulty?: number | null };
}

interface LabsKeywordResult {
  items?: LabsKeywordItem[];
}

interface DataForSeoProviderOptions {
  standardPollIntervalMs?: number;
  standardTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  marketLocationCode?: number;
  marketLanguageCode?: string;
  marketCountryCode?: string;
  markets?: ResearchMarket[];
  collectWebCompetitors?: boolean;
  collectAppleMarket?: boolean;
  usageLedger?: UsageLedger;
  database?: RadarDatabase;
  keywordCacheDays?: number;
  serpCacheDays?: number;
  appCacheDays?: number;
}

const DATA_FOR_SEO_BASE_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume";
const DATA_FOR_SEO_LABS_KEYWORD_OVERVIEW_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
const DATA_FOR_SEO_SERP_BASE_URL = "https://api.dataforseo.com/v3/serp";
const DATA_FOR_SEO_APP_SEARCH_URL =
  "https://api.dataforseo.com/v3/app_data/apple/app_searches";

interface OrganicSerpItem {
  type?: string;
  domain?: string;
  title?: string;
  url?: string;
}

interface OrganicSerpResult {
  se_results_count?: number;
  items?: OrganicSerpItem[];
}

interface AppleAppItem {
  app_id?: string;
  title?: string;
  url?: string;
  rating?: { value?: number } | number;
  reviews_count?: number;
  price?: { current?: number } | number;
}

interface AppleAppSearchResult {
  items?: AppleAppItem[];
}

export class DataForSeoProvider implements ResearchDataProvider {
  readonly mode = "REAL" as const;
  private readonly standardPollIntervalMs: number;
  private readonly standardTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly markets: ResearchMarket[];
  private readonly collectWebCompetitors: boolean;
  private readonly collectAppleMarket: boolean;
  private readonly usageLedger?: UsageLedger;
  private readonly database?: RadarDatabase;
  private readonly keywordCacheDays: number;
  private readonly serpCacheDays: number;
  private readonly appCacheDays: number;

  constructor(
    private readonly login: string,
    private readonly password: string,
    options: DataForSeoProviderOptions = {},
  ) {
    this.standardPollIntervalMs = options.standardPollIntervalMs ?? 60_000;
    this.standardTimeoutMs = options.standardTimeoutMs ?? 4 * 60 * 60 * 1_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.markets =
      options.markets?.length
        ? options.markets
        : [
            {
              locationCode: options.marketLocationCode ?? 2840,
              keywordLanguageCode: options.marketLanguageCode ?? "en",
              searchLanguageCode: options.marketLanguageCode ?? "en",
              countryCode: options.marketCountryCode ?? "US",
            },
          ];
    this.collectWebCompetitors = options.collectWebCompetitors ?? false;
    this.collectAppleMarket = options.collectAppleMarket ?? false;
    this.usageLedger = options.usageLedger;
    this.database = options.database;
    this.keywordCacheDays = options.keywordCacheDays ?? 30;
    this.serpCacheDays = options.serpCacheDays ?? 14;
    this.appCacheDays = options.appCacheDays ?? 30;
  }

  async collect(opportunity: Opportunity): Promise<EvidenceItem[]> {
    const result = await this.collectBatch(
      [{ opportunity, version: 1 }],
      "standard",
    );
    return result.get(opportunity.id) ?? [];
  }

  async collectBatch(
    requests: ResearchCollectionRequest[],
    delivery: ResearchDelivery = "standard",
  ): Promise<Map<string, EvidenceItem[]>> {
    if (!requests.length) return new Map();
    if (requests.length > 1000) {
      throw new Error("DataForSEO 单个批次最多支持 1000 个候选产品");
    }

    const evidenceByOpportunity = new Map<string, EvidenceItem[]>();
    requests.forEach(({ opportunity }) =>
      evidenceByOpportunity.set(opportunity.id, []),
    );
    for (const market of this.markets) {
      const marketRequests = requests.filter(({ opportunity }) =>
        this.marketsFor(opportunity).some(
          (candidate) => candidate.countryCode === market.countryCode,
        ),
      );
      if (!marketRequests.length) continue;

      const sourceName = shouldUseLabs(market)
        ? "DataForSEO Labs Keyword Overview"
        : "DataForSEO Google Ads";
      const groups = new Map<string, ResearchCollectionRequest[]>();
      for (const request of marketRequests) {
        for (const keyword of this.keywordsFor(request.opportunity)) {
          const cached = request.forceRefresh
            ? []
            : this.cachedEvidence(
                request.opportunity,
                "keyword",
                market,
                keyword,
                ["monthly_searches", "monthly_series_change", "cpc"],
                this.keywordCacheDays,
              );
          if (cached.length === 3) {
            const current = evidenceByOpportunity.get(request.opportunity.id) ?? [];
            current.push(...cached);
            evidenceByOpportunity.set(request.opportunity.id, current);
            continue;
          }
          const group = groups.get(keyword) ?? [];
          group.push(request);
          groups.set(keyword, group);
        }
      }

      const keywords = [...groups.keys()];
      const results = shouldUseLabs(market)
        ? await this.collectLabsKeywordOverview(keywords, market)
        : await this.collectGoogleAdsKeywords(keywords, market, delivery);
      const resultByKeyword = new Map<string, SearchVolumeResult>();
      results.forEach((result, index) => {
        const requestedKeyword = keywords[index];
        const returnedKeyword = result.keyword
          ? normalizedKeyword(result.keyword).toLocaleLowerCase()
          : undefined;
        if (returnedKeyword) resultByKeyword.set(returnedKeyword, result);
        if (
          !shouldUseLabs(market) &&
          requestedKeyword &&
          !resultByKeyword.has(requestedKeyword)
        ) {
          resultByKeyword.set(requestedKeyword, result);
        }
      });
      const now = new Date().toISOString();
      for (const [keyword, group] of groups) {
        const result = resultByKeyword.get(keyword);
        if (!result) continue;
        for (const { opportunity } of group) {
          const current = evidenceByOpportunity.get(opportunity.id) ?? [];
          current.push(
            ...this.toEvidence(
              opportunity,
              { ...result, keyword: result.keyword ?? keyword },
              now,
              market,
              sourceName,
              keyword,
            ),
          );
          evidenceByOpportunity.set(opportunity.id, current);
        }
      }

      for (const request of marketRequests) {
        const current = evidenceByOpportunity.get(request.opportunity.id) ?? [];
        const marketLabel = this.marketLabel(market);
        if (
          !current.some(
            (item) =>
              item.metric === "monthly_searches" && item.market === marketLabel,
          )
        ) {
          current.push(
            this.sourceGap(
              request.opportunity,
              "SEARCH",
              sourceName,
              new Error("关键词库暂无可用数据，未追加购买高价查询"),
              market,
            ),
          );
          evidenceByOpportunity.set(request.opportunity.id, current);
        }
      }
      await this.collectOptionalEvidence(
        marketRequests,
        evidenceByOpportunity,
        market,
        delivery,
      );
    }
    return evidenceByOpportunity;
  }

  private marketsFor(opportunity: Opportunity) {
    return researchMarketsForOpportunity(
      opportunity,
      { researchMarkets: this.markets },
      this.database,
    );
  }

  private keywordsFor(opportunity: Opportunity) {
    return researchKeywordsForOpportunity(opportunity, this.database);
  }

  private cachedEvidence(
    opportunity: Opportunity,
    sourceKey: string,
    market: ResearchMarket,
    keyword: string,
    metrics: string[],
    freshnessDays: number,
  ) {
    return cachedEvidenceRows(
      this.database,
      opportunity,
      sourceKey,
      market,
      keyword,
      metrics,
      freshnessDays,
    );
  }

  private async collectLabsKeywordOverview(
    keywords: string[],
    market: ResearchMarket,
  ) {
    const results: SearchVolumeResult[] = [];
    for (let index = 0; index < keywords.length; index += 700) {
      const chunk = keywords.slice(index, index + 700);
      if (!chunk.length) continue;
      const payload = await this.request<LabsKeywordResult>(
        DATA_FOR_SEO_LABS_KEYWORD_OVERVIEW_URL,
        {
          method: "POST",
          body: JSON.stringify([
            {
              keywords: chunk,
              location_code: market.locationCode,
              language_code: market.keywordLanguageCode,
              include_serp_info: false,
              include_clickstream_data: false,
            },
          ]),
        },
        {
          operation: "labs_keyword_overview",
          units: 1,
          market: market.countryCode,
          estimatedCostUsd:
            LABS_BASE_COST_USD + chunk.length * LABS_ITEM_COST_USD,
        },
      );
      const task = payload.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        throw new Error(task?.status_message ?? "Labs 关键词概览任务失败");
      }
      for (const item of task.result?.[0]?.items ?? []) {
        const info = item.keyword_info;
        if (!item.keyword || !info) continue;
        results.push({
          keyword: item.keyword,
          search_volume: Number(info.search_volume ?? 0),
          competition: Number(info.competition ?? 0),
          cpc: Number(info.cpc ?? 0),
          monthly_searches: info.monthly_searches ?? [],
          search_intent: item.search_intent_info?.main_intent ?? null,
          keyword_difficulty:
            item.keyword_properties?.keyword_difficulty ?? null,
        });
      }
    }
    return results;
  }

  private async collectGoogleAdsKeywords(
    keywords: string[],
    market: ResearchMarket,
    delivery: ResearchDelivery,
  ) {
    const results: SearchVolumeResult[] = [];
    for (let index = 0; index < keywords.length; index += 1000) {
      const chunk = keywords.slice(index, index + 1000);
      if (!chunk.length) continue;
      const taskInput = [
        {
          keywords: chunk,
          location_code: market.locationCode,
          language_code: market.keywordLanguageCode,
        },
      ];
      results.push(
        ...(delivery === "live"
          ? await this.collectLive(taskInput, market)
          : await this.collectStandard(taskInput, market)),
      );
    }
    return results;
  }

  private get headers() {
    return {
      Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    url: string,
    init?: RequestInit,
    billed?: {
      operation: string;
      units: number;
      market: string;
      estimatedCostUsd: number;
    },
  ) {
    const reservationId = billed
      ? this.usageLedger?.reserve(
        "DATAFORSEO",
        billed.operation,
        billed.units,
        { market: billed.market },
        billed.estimatedCostUsd,
      )
      : undefined;
    let payload: DataForSeoResponse<T>;
    try {
      payload = await withRetry(
        async () => {
          const response = await fetch(url, {
            ...init,
            headers: this.headers,
            signal: AbortSignal.timeout(this.requestTimeoutMs),
          });
          if (!response.ok) {
            const retryAfter = Number(response.headers.get("retry-after"));
            const message = `DataForSEO 请求失败：HTTP ${response.status}`;
            if (response.status === 429 || response.status >= 500) {
              throw new RetryableProviderError(
                message,
                Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined,
              );
            }
            throw new Error(message);
          }
          const responsePayload = (await response.json()) as DataForSeoResponse<T>;
          if (
            responsePayload.status_code &&
            responsePayload.status_code !== 20000
          ) {
            const message =
              responsePayload.status_message ?? "DataForSEO 请求失败";
            if (responsePayload.status_code >= 50000) {
              throw new RetryableProviderError(message);
            }
            throw new Error(message);
          }
          return responsePayload;
        },
        {
          // A timed-out paid POST may already have created a task. Retrying it
          // can purchase the same data twice, so only free GET/poll calls retry.
          retries: billed ? 0 : this.maxRetries,
        },
      );
    } catch (error) {
      this.usageLedger?.settle(
        reservationId,
        `${billed?.operation ?? "dataforseo"}_failed`,
        0,
        0,
        billed?.estimatedCostUsd ?? 0,
        { market: billed?.market, failed: true },
      );
      throw error;
    }
    if (billed) {
      const taskCost =
        payload.tasks?.reduce((sum, task) => sum + (task.cost ?? 0), 0) ?? 0;
      const reportedCost =
        typeof payload.cost === "number" && payload.cost > 0
          ? payload.cost
          : taskCost;
      this.usageLedger?.settle(
        reservationId,
        billed.operation,
        0,
        0,
        reportedCost,
        { market: billed.market },
      );
    }
    return payload;
  }

  private async collectLive(
    taskInput: unknown[],
    market: ResearchMarket,
  ) {
    const payload = await this.request<SearchVolumeResult>(
      `${DATA_FOR_SEO_BASE_URL}/live`,
      {
        method: "POST",
        body: JSON.stringify(taskInput),
      },
      {
        operation: "google_ads_search_volume_live",
        units: 1,
        market: market.countryCode,
        estimatedCostUsd: 0.09,
      },
    );
    const task = payload.tasks?.[0];
    if (!task || task.status_code !== 20000 || !task.result) {
      throw new Error(task?.status_message ?? "DataForSEO 没有返回有效任务");
    }
    return task.result;
  }

  private async collectStandard(
    taskInput: unknown[],
    market: ResearchMarket,
  ) {
    const posted = await this.request<SearchVolumeResult>(
      `${DATA_FOR_SEO_BASE_URL}/task_post`,
      {
        method: "POST",
        body: JSON.stringify(taskInput),
      },
      {
        operation: "google_ads_search_volume_standard",
        units: 1,
        market: market.countryCode,
        estimatedCostUsd: 0.06,
      },
    );
    const task = posted.tasks?.[0];
    if (!task?.id || task.status_code >= 40000) {
      throw new Error(task?.status_message ?? "DataForSEO 批量任务创建失败");
    }

    const deadline = Date.now() + this.standardTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.standardPollIntervalMs),
      );
      const payload = await this.request<SearchVolumeResult>(
        `${DATA_FOR_SEO_BASE_URL}/task_get/${encodeURIComponent(task.id)}`,
      );
      const completed = payload.tasks?.[0];
      if (completed?.status_code === 20000 && completed.result) {
        return completed.result;
      }
      if (completed && completed.status_code >= 40000) {
        throw new Error(completed.status_message);
      }
    }
    throw new Error("DataForSEO 批量任务等待超时，可稍后重新执行");
  }

  private async pollTask<T>(url: string) {
    const deadline = Date.now() + this.standardTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.standardPollIntervalMs),
      );
      const payload = await this.request<T>(url);
      const completed = payload.tasks?.[0];
      if (completed?.status_code === 20000 && completed.result) {
        return completed.result;
      }
      if (completed && completed.status_code >= 40000) {
        throw new Error(completed.status_message);
      }
    }
    throw new Error("DataForSEO Standard 任务等待超时");
  }

  private sourceGap(
    opportunity: Opportunity,
    category: "SEARCH" | "COMPETITOR" | "APP_STORE",
    sourceName: string,
    error: unknown,
    market: ResearchMarket,
  ): EvidenceItem {
    return {
      id: randomUUID(),
      opportunityId: opportunity.id,
      category,
      sourceName,
      sourceUrl: null,
      metric: "source_gap",
      value: null,
      unit: null,
      direction: "UNKNOWN",
      strength: 0,
      summary: `${sourceName} 本轮未能取得数据，已记录为证据缺口。`,
      rawExcerpt: error instanceof Error ? error.message.slice(0, 300) : null,
      collectedAt: new Date().toISOString(),
      freshnessDays: 0,
      market: this.marketLabel(market),
    };
  }

  private async collectOptionalEvidence(
    requests: ResearchCollectionRequest[],
    evidenceByOpportunity: Map<string, EvidenceItem[]>,
    market: ResearchMarket,
    delivery: ResearchDelivery,
  ) {
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < requests.length) {
        const request = requests[nextIndex];
        nextIndex += 1;
        if (!request) continue;
        const current = evidenceByOpportunity.get(request.opportunity.id) ?? [];
        if (
          this.collectWebCompetitors &&
          request.opportunity.recommendedPlatform !== "IOS"
        ) {
          const keyword = this.keywordsFor(request.opportunity)[0] ?? keywordFor(request.opportunity);
          const cached = request.forceRefresh
            ? []
            : this.cachedEvidence(
                request.opportunity,
                "serp",
                market,
                keyword,
                ["organic_competitor_domains", "serp_results_count"],
                this.serpCacheDays,
              );
          try {
            current.push(
              ...(cached.length === 2
                ? cached
                : await this.collectWebCompetition(
                    request.opportunity,
                    market,
                    keyword,
                    delivery,
                  )),
            );
          } catch (error) {
            current.push(
              this.sourceGap(
                request.opportunity,
                "COMPETITOR",
                `DataForSEO ${market.countryCode === "CN" ? "Baidu" : "Google"} SERP`,
                error,
                market,
              ),
            );
          }
        }
        if (
          this.collectAppleMarket &&
          request.opportunity.recommendedPlatform !== "WEB"
        ) {
          const keyword = this.keywordsFor(request.opportunity)[0] ?? keywordFor(request.opportunity);
          const cached = request.forceRefresh
            ? []
            : this.cachedEvidence(
                request.opportunity,
                "apple",
                market,
                keyword,
                [
                  "app_store_competitors",
                  "competitor_average_rating",
                  "competitor_review_volume",
                ],
                this.appCacheDays,
              );
          try {
            current.push(
              ...(cached.length === 3
                ? cached
                : await this.collectAppleCompetition(
                    request.opportunity,
                    market,
                    keyword,
                  )),
            );
          } catch (error) {
            current.push(
              this.sourceGap(
                request.opportunity,
                "APP_STORE",
                "DataForSEO Apple App Data",
                error,
                market,
              ),
            );
          }
        }
        evidenceByOpportunity.set(request.opportunity.id, current);
      }
    };
    const workerCount = Math.min(3, requests.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  private marketLabel(market: ResearchMarket) {
    return `${market.countryCode}/${market.searchLanguageCode}`;
  }

  private async collectWebCompetition(
    opportunity: Opportunity,
    market: ResearchMarket,
    keyword: string,
    delivery: ResearchDelivery,
  ) {
    const engine = market.countryCode === "CN" ? "baidu" : "google";
    const body = JSON.stringify([
      {
        keyword,
        location_code: market.locationCode,
        language_code: market.searchLanguageCode,
        depth: 10,
        priority: 1,
        tag: `research:${opportunity.id}:${market.countryCode}`,
      },
    ]);
    let result: OrganicSerpResult | undefined;
    if (delivery === "live") {
      const payload = await this.request<OrganicSerpResult>(
        `${DATA_FOR_SEO_SERP_BASE_URL}/${engine}/organic/live/advanced`,
        { method: "POST", body },
        {
          operation: `${engine}_organic_serp_live`,
          units: 1,
          market: market.countryCode,
          estimatedCostUsd: 0.002,
        },
      );
      result = payload.tasks?.[0]?.result?.[0];
    } else {
      const posted = await this.request<OrganicSerpResult>(
        `${DATA_FOR_SEO_SERP_BASE_URL}/${engine}/organic/task_post`,
        { method: "POST", body },
        {
          operation: `${engine}_organic_serp_standard`,
          units: 1,
          market: market.countryCode,
          estimatedCostUsd: SERP_STANDARD_COST_USD,
        },
      );
      const task = posted.tasks?.[0];
      if (!task?.id || task.status_code >= 40000) {
        throw new Error(task?.status_message ?? `${engine} SERP 任务创建失败`);
      }
      const completed = await this.pollTask<OrganicSerpResult>(
        `${DATA_FOR_SEO_SERP_BASE_URL}/${engine}/organic/task_get/advanced/${encodeURIComponent(task.id)}`,
      );
      result = completed[0];
    }
    if (!result) throw new Error(`${engine} SERP 没有返回结果`);
    const organic = (result.items ?? []).filter(
      (item) => item.type === "organic" && item.domain,
    );
    const domains = [...new Set(organic.map((item) => item.domain!))];
    const excerpt = organic
      .slice(0, 8)
      .map((item) => `${item.domain}: ${item.title ?? ""}`)
      .join("\n");
    const now = new Date().toISOString();
    const sourceName = `DataForSEO ${engine === "baidu" ? "Baidu" : "Google"} SERP`;
    const marketLabel = this.marketLabel(market);
    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPETITOR" as const,
        sourceName,
        sourceUrl: organic[0]?.url ?? null,
        metric: "organic_competitor_domains",
        value: domains.length,
        unit: "domains",
        direction: "UNKNOWN" as const,
        strength: Math.min(90, 45 + domains.length * 5),
        summary: `目标关键词首页发现 ${domains.length} 个独立自然搜索竞品域名。`,
        rawExcerpt: excerpt || null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "serp",
          marketLabel,
          keyword,
          "organic_competitor_domains",
        ),
        market: marketLabel,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPETITOR" as const,
        sourceName,
        sourceUrl: null,
        metric: "serp_results_count",
        value: result.se_results_count ?? 0,
        unit: "results",
        direction: "UNKNOWN" as const,
        strength: 55,
        summary: `${engine === "baidu" ? "Baidu" : "Google"} 估算相关结果量约 ${result.se_results_count ?? 0}。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "serp",
          marketLabel,
          keyword,
          "serp_results_count",
        ),
        market: marketLabel,
      },
    ];
  }

  private async collectAppleCompetition(
    opportunity: Opportunity,
    market: ResearchMarket,
    keyword: string,
  ) {
    const posted = await this.request<AppleAppSearchResult>(
      `${DATA_FOR_SEO_APP_SEARCH_URL}/task_post`,
      {
        method: "POST",
        body: JSON.stringify([
          {
            keyword,
            location_code: market.locationCode,
            language_code: market.searchLanguageCode,
            depth: 100,
            tag: `${opportunity.id}:${market.countryCode}`,
          },
        ]),
      },
      {
        operation: "apple_app_search",
        units: 1,
        market: market.countryCode,
        estimatedCostUsd: APP_SEARCH_COST_USD,
      },
    );
    const task = posted.tasks?.[0];
    if (!task?.id || task.status_code >= 40000) {
      throw new Error(task?.status_message ?? "Apple App Search 任务创建失败");
    }
    const deadline = Date.now() + this.standardTimeoutMs;
    let result: AppleAppSearchResult | undefined;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.standardPollIntervalMs),
      );
      const payload = await this.request<AppleAppSearchResult>(
        `${DATA_FOR_SEO_APP_SEARCH_URL}/task_get/advanced/${encodeURIComponent(task.id)}`,
      );
      const completed = payload.tasks?.[0];
      if (completed?.status_code === 20000 && completed.result) {
        result = completed.result[0];
        break;
      }
      if (completed && completed.status_code >= 40000) {
        throw new Error(completed.status_message);
      }
    }
    if (!result) throw new Error("Apple App Search 批量任务等待超时");
    const items = result.items ?? [];
    const ratingValue = (item: AppleAppItem) =>
      typeof item.rating === "number" ? item.rating : item.rating?.value ?? 0;
    const ratings = items.map(ratingValue).filter((value) => value > 0);
    const averageRating = ratings.length
      ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
      : 0;
    const totalReviews = items.reduce(
      (sum, item) => sum + (item.reviews_count ?? 0),
      0,
    );
    const excerpt = items
      .slice(0, 10)
      .map(
        (item) =>
          `${item.title ?? item.app_id ?? "Unknown"} | rating ${ratingValue(item).toFixed(1)} | reviews ${item.reviews_count ?? 0}`,
      )
      .join("\n");
    const now = new Date().toISOString();
    const marketLabel = this.marketLabel(market);
    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "APP_STORE" as const,
        sourceName: "DataForSEO Apple App Search",
        sourceUrl: items[0]?.url ?? null,
        metric: "app_store_competitors",
        value: items.length,
        unit: "apps",
        direction: "UNKNOWN" as const,
        strength: Math.min(95, 45 + Math.min(items.length, 20) * 2),
        summary: `App Store 关键词结果中发现 ${items.length} 个候选竞品。`,
        rawExcerpt: excerpt || null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "apple",
          marketLabel,
          keyword,
          "app_store_competitors",
        ),
        market: marketLabel,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "APP_STORE" as const,
        sourceName: "DataForSEO Apple App Search",
        sourceUrl: null,
        metric: "competitor_average_rating",
        value: Number(averageRating.toFixed(2)),
        unit: "rating",
        direction: "UNKNOWN" as const,
        strength: ratings.length ? 70 : 20,
        summary: `有评分数据的竞品平均评分约 ${averageRating.toFixed(2)}。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "apple",
          marketLabel,
          keyword,
          "competitor_average_rating",
        ),
        market: marketLabel,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "APP_STORE" as const,
        sourceName: "DataForSEO Apple App Search",
        sourceUrl: null,
        metric: "competitor_review_volume",
        value: totalReviews,
        unit: "reviews",
        direction: "UNKNOWN" as const,
        strength: totalReviews > 0 ? 75 : 20,
        summary: `本轮 App Store 竞品累计评论量约 ${totalReviews}。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "apple",
          marketLabel,
          keyword,
          "competitor_review_volume",
        ),
        market: marketLabel,
      },
    ];
  }

  private toEvidence(
    opportunity: Opportunity,
    result: SearchVolumeResult,
    now: string,
    market: ResearchMarket,
    sourceName: string,
    requestedKeyword: string,
  ): EvidenceItem[] {
    const monthly = result.monthly_searches ?? [];
    const newest = monthly[0]?.search_volume ?? 0;
    const oldest = monthly.at(-1)?.search_volume ?? newest;
    const trend = oldest > 0 ? Math.round(((newest - oldest) / oldest) * 100) : 0;
    const competition =
      result.competition_index ??
      (typeof result.competition === "number"
        ? Math.round(result.competition * 100)
        : 0);
    const keyword = result.keyword ?? keywordFor(opportunity);
    const marketLabel = this.marketLabel(market);

    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "SEARCH",
        sourceName,
        sourceUrl: null,
        metric: "monthly_searches",
        value: result.search_volume ?? 0,
        unit: "queries",
        direction: trend > 5 ? "UP" : trend < -5 ? "DOWN" : "FLAT",
        strength: result.search_volume ? Math.min(95, 45 + Math.log10(result.search_volume + 1) * 12) : 25,
        summary: `关键词“${keyword}”月搜索量约 ${result.search_volume ?? 0}。`,
        rawExcerpt: result.search_intent
          ? `Search intent: ${result.search_intent}`
          : null,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "keyword",
          marketLabel,
          requestedKeyword,
          "monthly_searches",
        ),
        market: marketLabel,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "TREND",
        sourceName,
        sourceUrl: null,
        metric: "monthly_series_change",
        value: trend,
        unit: "%",
        direction: trend > 5 ? "UP" : trend < -5 ? "DOWN" : "FLAT",
        strength: Math.min(90, 50 + Math.abs(trend)),
        summary: `可用月度序列首尾变化约 ${trend >= 0 ? "+" : ""}${trend}%。`,
        rawExcerpt: `Keyword: ${keyword}`,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "keyword",
          marketLabel,
          requestedKeyword,
          "monthly_series_change",
        ),
        market: marketLabel,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMMERCIAL",
        sourceName,
        sourceUrl: null,
        metric: "cpc",
        value: result.cpc ?? 0,
        unit: "USD",
        direction: "UNKNOWN",
        strength: Math.min(90, 45 + (result.cpc ?? 0) * 7),
        summary: `关键词 CPC 约 $${(result.cpc ?? 0).toFixed(2)}，作为商业意图的辅助信号。`,
        rawExcerpt: `Keyword: ${keyword}; competition index: ${competition}; keyword difficulty: ${result.keyword_difficulty ?? "unknown"}; search intent: ${result.search_intent ?? "unknown"}`,
        collectedAt: now,
        freshnessDays: 0,
        fingerprint: evidenceFingerprint(
          opportunity.id,
          "keyword",
          marketLabel,
          requestedKeyword,
          "cpc",
        ),
        market: marketLabel,
      },
    ];
  }
}

export function createResearchProvider(
  config: AppConfig,
  db?: RadarDatabase,
): ResearchDataProvider {
  if (
    config.researchProvider === "real" &&
    config.dataForSeoLogin &&
    config.dataForSeoPassword
  ) {
    return new DataForSeoProvider(config.dataForSeoLogin, config.dataForSeoPassword, {
      standardPollIntervalMs: config.dataForSeoBatchPollIntervalMs,
      standardTimeoutMs: config.dataForSeoBatchTimeoutMs,
      requestTimeoutMs: config.providerRequestTimeoutMs,
      maxRetries: config.providerMaxRetries,
      marketLocationCode: config.marketLocationCode,
      marketLanguageCode: config.marketLanguageCode,
      marketCountryCode: config.marketCountryCode,
      markets: config.researchMarkets,
      collectWebCompetitors: config.collectWebCompetitors,
      collectAppleMarket: config.collectAppleMarket,
      usageLedger: db ? new UsageLedger(db, config) : undefined,
      database: db,
      keywordCacheDays: config.researchKeywordCacheDays,
      serpCacheDays: config.researchSerpCacheDays,
      appCacheDays: config.researchAppCacheDays,
    });
  }
  return new DemoResearchProvider();
}

export function persistEvidence(db: RadarDatabase, evidence: EvidenceItem[]) {
  const statement = db.prepare(`
    INSERT INTO evidence_items (
      id, opportunity_id, category, source_name, source_url, metric, value, unit,
      direction, strength, summary, raw_excerpt, collected_at, freshness_days,
      fingerprint, market
    ) VALUES (
      @id, @opportunityId, @category, @sourceName, @sourceUrl, @metric, @value, @unit,
      @direction, @strength, @summary, @rawExcerpt, @collectedAt, @freshnessDays,
      @fingerprint, @market
    )
    ON CONFLICT(opportunity_id, fingerprint) WHERE fingerprint IS NOT NULL
    DO UPDATE SET
      category = excluded.category,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      metric = excluded.metric,
      value = excluded.value,
      unit = excluded.unit,
      direction = excluded.direction,
      strength = excluded.strength,
      summary = excluded.summary,
      raw_excerpt = excluded.raw_excerpt,
      collected_at = excluded.collected_at,
      freshness_days = excluded.freshness_days,
      market = excluded.market
  `);
  const insert = db.transaction((items: EvidenceItem[]) => {
    items.forEach((item) =>
      statement.run({
        ...item,
        fingerprint: item.fingerprint ?? null,
        market: item.market ?? null,
      }),
    );
  });
  insert(evidence);
}

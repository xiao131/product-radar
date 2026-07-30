import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
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
}

function stableNumber(input: string, min: number, max: number) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

function keywordFor(opportunity: Opportunity) {
  return opportunity.name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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
}

interface DataForSeoProviderOptions {
  standardPollIntervalMs?: number;
  standardTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  marketLocationCode?: number;
  marketLanguageCode?: string;
  marketCountryCode?: string;
  collectWebCompetitors?: boolean;
  collectAppleMarket?: boolean;
  usageLedger?: UsageLedger;
}

const DATA_FOR_SEO_BASE_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume";
const DATA_FOR_SEO_SERP_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
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
  private readonly marketLocationCode: number;
  private readonly marketLanguageCode: string;
  private readonly marketCountryCode: string;
  private readonly collectWebCompetitors: boolean;
  private readonly collectAppleMarket: boolean;
  private readonly usageLedger?: UsageLedger;

  constructor(
    private readonly login: string,
    private readonly password: string,
    options: DataForSeoProviderOptions = {},
  ) {
    this.standardPollIntervalMs = options.standardPollIntervalMs ?? 60_000;
    this.standardTimeoutMs = options.standardTimeoutMs ?? 4 * 60 * 60 * 1_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.marketLocationCode = options.marketLocationCode ?? 2840;
    this.marketLanguageCode = options.marketLanguageCode ?? "en";
    this.marketCountryCode = options.marketCountryCode ?? "US";
    this.collectWebCompetitors = options.collectWebCompetitors ?? false;
    this.collectAppleMarket = options.collectAppleMarket ?? false;
    this.usageLedger = options.usageLedger;
  }

  async collect(opportunity: Opportunity): Promise<EvidenceItem[]> {
    const result = await this.collectBatch([{ opportunity, version: 1 }]);
    return result.get(opportunity.id) ?? [];
  }

  async collectBatch(
    requests: ResearchCollectionRequest[],
    delivery: ResearchDelivery = "live",
  ): Promise<Map<string, EvidenceItem[]>> {
    if (!requests.length) return new Map();
    if (requests.length > 1000) {
      throw new Error("DataForSEO 单个批次最多支持 1000 个候选产品");
    }

    const groups = new Map<string, ResearchCollectionRequest[]>();
    for (const request of requests) {
      const keyword = keywordFor(request.opportunity).toLocaleLowerCase();
      const group = groups.get(keyword) ?? [];
      group.push(request);
      groups.set(keyword, group);
    }
    const keywords = [...groups.keys()];
    const taskInput = [
      {
        keywords,
        location_code: this.marketLocationCode,
        language_code: this.marketLanguageCode,
      },
    ];

    const results =
      delivery === "standard"
        ? await this.collectStandard(taskInput)
        : await this.collectLive(taskInput);
    const resultByKeyword = new Map<string, SearchVolumeResult>();
    results.forEach((result, index) => {
      const requestedKeyword = keywords[index];
      const returnedKeyword = result.keyword?.toLocaleLowerCase();
      if (returnedKeyword) resultByKeyword.set(returnedKeyword, result);
      if (requestedKeyword && !resultByKeyword.has(requestedKeyword)) {
        resultByKeyword.set(requestedKeyword, result);
      }
    });

    const now = new Date().toISOString();
    const evidenceByOpportunity = new Map<string, EvidenceItem[]>();
    for (const [keyword, group] of groups) {
      const result = resultByKeyword.get(keyword);
      if (!result) {
        throw new Error(`DataForSEO 没有返回关键词“${keyword}”的数据`);
      }
      for (const { opportunity } of group) {
        evidenceByOpportunity.set(
          opportunity.id,
          this.toEvidence(opportunity, result, now),
        );
      }
    }
    await this.collectOptionalEvidence(requests, evidenceByOpportunity);
    return evidenceByOpportunity;
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
    billed?: { operation: string; units: number },
  ) {
    if (billed) {
      this.usageLedger?.reserve(
        "DATAFORSEO",
        billed.operation,
        billed.units,
        { market: this.marketCountryCode },
      );
    }
    const payload = await withRetry(
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
        retries: this.maxRetries,
      },
    );
    if (billed) {
      const reportedCost =
        payload.cost ??
        payload.tasks?.reduce((sum, task) => sum + (task.cost ?? 0), 0) ??
        0;
      this.usageLedger?.recordMeasurement(
        "DATAFORSEO",
        billed.operation,
        0,
        0,
        reportedCost,
      );
    }
    return payload;
  }

  private async collectLive(taskInput: unknown[]) {
    const payload = await this.request<SearchVolumeResult>(
      `${DATA_FOR_SEO_BASE_URL}/live`,
      {
        method: "POST",
        body: JSON.stringify(taskInput),
      },
      { operation: "google_ads_search_volume_live", units: 1 },
    );
    const task = payload.tasks?.[0];
    if (!task || task.status_code !== 20000 || !task.result) {
      throw new Error(task?.status_message ?? "DataForSEO 没有返回有效任务");
    }
    return task.result;
  }

  private async collectStandard(taskInput: unknown[]) {
    const posted = await this.request<SearchVolumeResult>(
      `${DATA_FOR_SEO_BASE_URL}/task_post`,
      {
        method: "POST",
        body: JSON.stringify(taskInput),
      },
      { operation: "google_ads_search_volume_standard", units: 1 },
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

  private sourceGap(
    opportunity: Opportunity,
    category: "COMPETITOR" | "APP_STORE",
    sourceName: string,
    error: unknown,
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
      market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
    };
  }

  private async collectOptionalEvidence(
    requests: ResearchCollectionRequest[],
    evidenceByOpportunity: Map<string, EvidenceItem[]>,
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
          try {
            current.push(
              ...(await this.collectWebCompetition(request.opportunity)),
            );
          } catch (error) {
            current.push(
              this.sourceGap(
                request.opportunity,
                "COMPETITOR",
                "DataForSEO Google SERP",
                error,
              ),
            );
          }
        }
        if (
          this.collectAppleMarket &&
          request.opportunity.recommendedPlatform !== "WEB"
        ) {
          try {
            current.push(
              ...(await this.collectAppleCompetition(request.opportunity)),
            );
          } catch (error) {
            current.push(
              this.sourceGap(
                request.opportunity,
                "APP_STORE",
                "DataForSEO Apple App Data",
                error,
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

  private async collectWebCompetition(opportunity: Opportunity) {
    const payload = await this.request<OrganicSerpResult>(
      DATA_FOR_SEO_SERP_URL,
      {
        method: "POST",
        body: JSON.stringify([
          {
            keyword: keywordFor(opportunity),
            location_code: this.marketLocationCode,
            language_code: this.marketLanguageCode,
            depth: 10,
          },
        ]),
      },
      { operation: "google_organic_serp", units: 1 },
    );
    const result = payload.tasks?.[0]?.result?.[0];
    if (!result) throw new Error("Google SERP 没有返回结果");
    const organic = (result.items ?? []).filter(
      (item) => item.type === "organic" && item.domain,
    );
    const domains = [...new Set(organic.map((item) => item.domain!))];
    const excerpt = organic
      .slice(0, 8)
      .map((item) => `${item.domain}: ${item.title ?? ""}`)
      .join("\n");
    const now = new Date().toISOString();
    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPETITOR" as const,
        sourceName: "DataForSEO Google SERP",
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
        market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMPETITOR" as const,
        sourceName: "DataForSEO Google SERP",
        sourceUrl: null,
        metric: "serp_results_count",
        value: result.se_results_count ?? 0,
        unit: "results",
        direction: "UNKNOWN" as const,
        strength: 55,
        summary: `Google 估算相关结果量约 ${result.se_results_count ?? 0}。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
      },
    ];
  }

  private async collectAppleCompetition(opportunity: Opportunity) {
    const posted = await this.request<AppleAppSearchResult>(
      `${DATA_FOR_SEO_APP_SEARCH_URL}/task_post`,
      {
        method: "POST",
        body: JSON.stringify([
          {
            keyword: keywordFor(opportunity),
            location_code: this.marketLocationCode,
            language_code: this.marketLanguageCode,
            depth: 100,
            tag: opportunity.id,
          },
        ]),
      },
      { operation: "apple_app_search", units: 1 },
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
    const market = `${this.marketCountryCode}/${this.marketLanguageCode}`;
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
        market,
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
        market,
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
        market,
      },
    ];
  }

  private toEvidence(
    opportunity: Opportunity,
    result: SearchVolumeResult,
    now: string,
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

    return [
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "SEARCH",
        sourceName: "DataForSEO Google Ads",
        sourceUrl: null,
        metric: "monthly_searches",
        value: result.search_volume ?? 0,
        unit: "queries",
        direction: trend > 5 ? "UP" : trend < -5 ? "DOWN" : "FLAT",
        strength: result.search_volume ? Math.min(95, 45 + Math.log10(result.search_volume + 1) * 12) : 25,
        summary: `关键词“${result.keyword ?? keywordFor(opportunity)}”月搜索量约 ${result.search_volume ?? 0}。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "TREND",
        sourceName: "DataForSEO Google Ads",
        sourceUrl: null,
        metric: "monthly_series_change",
        value: trend,
        unit: "%",
        direction: trend > 5 ? "UP" : trend < -5 ? "DOWN" : "FLAT",
        strength: Math.min(90, 50 + Math.abs(trend)),
        summary: `可用月度序列首尾变化约 ${trend >= 0 ? "+" : ""}${trend}%。`,
        rawExcerpt: null,
        collectedAt: now,
        freshnessDays: 0,
        market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
      },
      {
        id: randomUUID(),
        opportunityId: opportunity.id,
        category: "COMMERCIAL",
        sourceName: "DataForSEO Google Ads",
        sourceUrl: null,
        metric: "cpc",
        value: result.cpc ?? 0,
        unit: "USD",
        direction: "UNKNOWN",
        strength: Math.min(90, 45 + (result.cpc ?? 0) * 7),
        summary: `关键词 CPC 约 $${(result.cpc ?? 0).toFixed(2)}，作为商业意图的辅助信号。`,
        rawExcerpt: `Competition index: ${competition}`,
        collectedAt: now,
        freshnessDays: 0,
        market: `${this.marketCountryCode}/${this.marketLanguageCode}`,
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
      collectWebCompetitors: config.collectWebCompetitors,
      collectAppleMarket: config.collectAppleMarket,
      usageLedger: db ? new UsageLedger(db, config) : undefined,
    });
  }
  return new DemoResearchProvider();
}

export function persistEvidence(db: RadarDatabase, evidence: EvidenceItem[]) {
  const statement = db.prepare(`
    INSERT OR IGNORE INTO evidence_items (
      id, opportunity_id, category, source_name, source_url, metric, value, unit,
      direction, strength, summary, raw_excerpt, collected_at, freshness_days,
      fingerprint, market
    ) VALUES (
      @id, @opportunityId, @category, @sourceName, @sourceUrl, @metric, @value, @unit,
      @direction, @strength, @summary, @rawExcerpt, @collectedAt, @freshnessDays,
      @fingerprint, @market
    )
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

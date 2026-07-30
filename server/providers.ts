import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
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
  result?: T[] | null;
}

interface DataForSeoResponse<T> {
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
}

const DATA_FOR_SEO_BASE_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume";

export class DataForSeoProvider implements ResearchDataProvider {
  readonly mode = "REAL" as const;
  private readonly standardPollIntervalMs: number;
  private readonly standardTimeoutMs: number;

  constructor(
    private readonly login: string,
    private readonly password: string,
    options: DataForSeoProviderOptions = {},
  ) {
    this.standardPollIntervalMs = options.standardPollIntervalMs ?? 60_000;
    this.standardTimeoutMs = options.standardTimeoutMs ?? 4 * 60 * 60 * 1_000;
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
        location_code: 2840,
        language_code: "en",
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
    return evidenceByOpportunity;
  }

  private get headers() {
    return {
      Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: this.headers,
    });
    if (!response.ok) {
      throw new Error(`DataForSEO 请求失败：HTTP ${response.status}`);
    }
    const payload = (await response.json()) as DataForSeoResponse<T>;
    if (payload.status_code && payload.status_code !== 20000) {
      throw new Error(payload.status_message ?? "DataForSEO 请求失败");
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
      },
    ];
  }
}

export function createResearchProvider(config: AppConfig): ResearchDataProvider {
  if (
    config.researchProvider === "real" &&
    config.dataForSeoLogin &&
    config.dataForSeoPassword
  ) {
    return new DataForSeoProvider(config.dataForSeoLogin, config.dataForSeoPassword, {
      standardPollIntervalMs: config.dataForSeoBatchPollIntervalMs,
      standardTimeoutMs: config.dataForSeoBatchTimeoutMs,
    });
  }
  return new DemoResearchProvider();
}

export function persistEvidence(db: RadarDatabase, evidence: EvidenceItem[]) {
  const statement = db.prepare(`
    INSERT INTO evidence_items (
      id, opportunity_id, category, source_name, source_url, metric, value, unit,
      direction, strength, summary, raw_excerpt, collected_at, freshness_days
    ) VALUES (
      @id, @opportunityId, @category, @sourceName, @sourceUrl, @metric, @value, @unit,
      @direction, @strength, @summary, @rawExcerpt, @collectedAt, @freshnessDays
    )
  `);
  const insert = db.transaction((items: EvidenceItem[]) => {
    items.forEach((item) => statement.run(item));
  });
  insert(evidence);
}

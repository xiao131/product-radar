import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import type { EvidenceItem, Opportunity } from "../shared/types.js";

export interface ResearchDataProvider {
  readonly mode: "DEMO" | "REAL";
  collect(opportunity: Opportunity, version: number): Promise<EvidenceItem[]>;
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
}

interface DataForSeoTask<T> {
  status_code: number;
  status_message: string;
  result?: T[];
}

interface DataForSeoResponse<T> {
  tasks?: Array<DataForSeoTask<T>>;
}

interface SearchVolumeResult {
  keyword?: string;
  search_volume?: number;
  competition?: number;
  competition_index?: number;
  cpc?: number;
  monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
}

export class DataForSeoProvider implements ResearchDataProvider {
  readonly mode = "REAL" as const;

  constructor(
    private readonly login: string,
    private readonly password: string,
  ) {}

  async collect(opportunity: Opportunity): Promise<EvidenceItem[]> {
    const response = await fetch(
      "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            keywords: [keywordFor(opportunity)],
            location_code: 2840,
            language_code: "en",
          },
        ]),
      },
    );

    if (!response.ok) {
      throw new Error(`DataForSEO 请求失败：HTTP ${response.status}`);
    }

    const payload = (await response.json()) as DataForSeoResponse<SearchVolumeResult>;
    const task = payload.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      throw new Error(task?.status_message ?? "DataForSEO 没有返回有效任务");
    }

    const result = task.result?.[0];
    if (!result) throw new Error("DataForSEO 没有返回关键词数据");

    const monthly = result.monthly_searches ?? [];
    const newest = monthly[0]?.search_volume ?? 0;
    const oldest = monthly.at(-1)?.search_volume ?? newest;
    const trend = oldest > 0 ? Math.round(((newest - oldest) / oldest) * 100) : 0;
    const competition = result.competition_index ?? Math.round((result.competition ?? 0) * 100);
    const now = new Date().toISOString();

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
    return new DataForSeoProvider(config.dataForSeoLogin, config.dataForSeoPassword);
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

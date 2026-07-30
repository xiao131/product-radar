import { createHash } from "node:crypto";
import type { SignalSource } from "../shared/types.js";
import type { AppConfig, ResearchMarket } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { RetryableProviderError, withRetry } from "./retry.js";
import { UsageBudgetExceededError, UsageLedger } from "./usage.js";

const API_BASE = "https://api.dataforseo.com/v3";

const ENGLISH_LABS_SEEDS = [
  "personal productivity",
  "small business workflow",
  "creator tools",
  "family organizer",
  "health tracking",
  "photo management",
  "finance tracker",
  "study planner",
  "developer tools",
  "automation app",
  "privacy app",
  "habit tracker",
];

const ENGLISH_PAIN_QUERIES = [
  "\"I wish there was an app\"",
  "\"looking for a tool that\"",
  "\"is there an app for\"",
  "\"there must be a better way to\"",
  "\"how do you keep track of\"",
  "\"manual process takes too long\"",
  "\"app that automatically\"",
  "\"alternative to spreadsheets\"",
];

const CHINESE_PAIN_QUERIES = [
  "\"有没有这样的工具\"",
  "\"有没有软件可以\"",
  "\"求推荐一个工具\"",
  "\"有没有更简单的方法\"",
  "\"手动处理太麻烦\"",
  "\"如何自动整理\"",
  "\"什么软件可以记录\"",
  "\"替代 Excel 的工具\"",
];

interface DataForSeoTask<T> {
  id?: string;
  status_code: number;
  status_message?: string;
  cost?: number;
  result?: T[];
}

interface DataForSeoEnvelope<T> {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<DataForSeoTask<T>>;
}

interface LabsKeywordItem {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    competition?: number | null;
    cpc?: number | null;
    search_volume_trend?: {
      monthly?: number | null;
      quarterly?: number | null;
      yearly?: number | null;
    };
  };
  keyword_properties?: {
    keyword_difficulty?: number | null;
    detected_language?: string | null;
  };
  search_intent_info?: {
    main_intent?: string | null;
  };
}

interface LabsKeywordResult {
  items?: LabsKeywordItem[];
}

interface SerpItem {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  domain?: string;
}

interface SerpResult {
  keyword?: string;
  items?: SerpItem[];
}

interface AppListItem {
  app_id?: string;
  title?: string;
  url?: string;
  developer?: string;
  categories?: string[];
  rating?: number | { value?: number };
  reviews_count?: number;
  price?: number;
  rank_group?: number;
}

interface AppListResult {
  items?: AppListItem[];
}

export interface DiscoveredSignalInput {
  fingerprint: string;
  sourceType: SignalSource;
  title: string;
  content: string;
  sourceUrl: string | null;
  tags: string[];
  market: string;
  sourceName: string;
  metrics: Record<string, unknown>;
}

export interface DiscoveryProviderResult {
  signals: DiscoveredSignalInput[];
  counts: {
    labs: number;
    web: number;
    appStore: number;
  };
  warnings: string[];
  budgetStopped: boolean;
}

function fingerprint(...parts: Array<string | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((part) => part?.trim().toLowerCase() ?? "").join("|"))
    .digest("hex");
}

function marketLabel(market: ResearchMarket) {
  return `${market.countryCode}/${market.searchLanguageCode}`;
}

function boundedText(value: string | undefined, limit: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function inferSourceType(domain: string | undefined): SignalSource {
  const normalized = domain?.toLowerCase() ?? "";
  if (normalized.includes("reddit.com")) return "REDDIT";
  if (
    normalized === "x.com" ||
    normalized.endsWith(".x.com") ||
    normalized.includes("twitter.com")
  ) {
    return "X";
  }
  return "FORUM";
}

function ratingValue(item: AppListItem) {
  return typeof item.rating === "number"
    ? item.rating
    : Number(item.rating?.value ?? 0);
}

function taskCost<T>(payload: DataForSeoEnvelope<T>) {
  if (typeof payload.cost === "number" && payload.cost > 0) {
    return payload.cost;
  }
  return (
    payload.tasks?.reduce((sum, task) => sum + Number(task.cost ?? 0), 0) ?? 0
  );
}

export class DataForSeoDiscoveryProvider {
  private readonly ledger: UsageLedger;

  constructor(
    private readonly config: AppConfig,
    private readonly database: RadarDatabase,
  ) {
    this.ledger = new UsageLedger(database, config);
  }

  private get headers() {
    return {
      Authorization: `Basic ${Buffer.from(
        `${this.config.dataForSeoLogin}:${this.config.dataForSeoPassword}`,
      ).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    billed?: {
      operation: string;
      units: number;
      estimatedCostUsd: number;
      market: string;
    },
  ) {
    const reservationId = billed
      ? this.ledger.reserve(
          "DATAFORSEO",
          billed.operation,
          billed.units,
          { market: billed.market, automaticDiscovery: true },
          billed.estimatedCostUsd,
        )
      : undefined;
    try {
      const payload = await withRetry(
        async () => {
          const response = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: this.headers,
            signal: AbortSignal.timeout(this.config.providerRequestTimeoutMs),
          });
          if (!response.ok) {
            const message = `DataForSEO 自动发现请求失败：HTTP ${response.status}`;
            if (response.status === 429 || response.status >= 500) {
              throw new RetryableProviderError(message);
            }
            throw new Error(message);
          }
          const body = (await response.json()) as DataForSeoEnvelope<T>;
          if (body.status_code && body.status_code !== 20000) {
            const message = body.status_message ?? "DataForSEO 自动发现请求失败";
            if (body.status_code >= 50000) {
              throw new RetryableProviderError(message);
            }
            throw new Error(message);
          }
          return body;
        },
        { retries: this.config.providerMaxRetries },
      );
      if (billed) {
        this.ledger.settle(
          reservationId,
          billed.operation,
          0,
          0,
          taskCost(payload),
          { market: billed.market, automaticDiscovery: true },
        );
      }
      return payload;
    } catch (error) {
      this.ledger.settle(
        reservationId,
        `${billed?.operation ?? "discovery"}_failed`,
        0,
        0,
        billed?.estimatedCostUsd ?? 0,
        {
          market: billed?.market,
          automaticDiscovery: true,
          failed: true,
        },
      );
      throw error;
    }
  }

  private async pollTask<T>(path: string, taskId: string) {
    const deadline = Date.now() + this.config.dataForSeoBatchTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.dataForSeoBatchPollIntervalMs),
      );
      const payload = await this.request<T>(
        `${path}/${encodeURIComponent(taskId)}`,
      );
      const task = payload.tasks?.[0];
      if (task?.status_code === 20000 && task.result) return task.result;
      if (task && task.status_code >= 40000) {
        throw new Error(task.status_message ?? "DataForSEO 任务失败");
      }
    }
    throw new Error("DataForSEO 自动发现任务等待超时");
  }

  private async collectLabs(market: ResearchMarket) {
    // DataForSEO Labs Google currently has no mainland-China keyword database.
    if (market.countryCode === "CN") return [];
    const limit = this.config.discoveryLabsLimit;
    const payload = await this.request<LabsKeywordResult>(
      "/dataforseo_labs/google/keyword_ideas/live",
      {
        method: "POST",
        body: JSON.stringify([
          {
            keywords: ENGLISH_LABS_SEEDS,
            location_code: market.locationCode,
            language_code: market.keywordLanguageCode,
            limit,
            include_serp_info: false,
            include_clickstream_data: false,
            order_by: [
              "keyword_info.search_volume,desc",
              "keyword_properties.keyword_difficulty,asc",
            ],
          },
        ]),
      },
      {
        operation: "discovery_keyword_ideas",
        units: 1,
        market: market.countryCode,
        estimatedCostUsd: 0.012 + limit * 0.00012,
      },
    );
    const task = payload.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      throw new Error(task?.status_message ?? "关键词发现任务失败");
    }
    const items = task.result?.[0]?.items ?? [];
    const label = marketLabel(market);
    return items
      .filter((item) => boundedText(item.keyword, 140).length >= 3)
      .map((item): DiscoveredSignalInput => {
        const keyword = boundedText(item.keyword, 140);
        const volume = Number(item.keyword_info?.search_volume ?? 0);
        const monthlyTrend = Number(
          item.keyword_info?.search_volume_trend?.monthly ?? 0,
        );
        const quarterlyTrend = Number(
          item.keyword_info?.search_volume_trend?.quarterly ?? 0,
        );
        return {
          fingerprint: fingerprint("labs-keyword", label, keyword),
          sourceType: monthlyTrend > 10 ? "TREND" : "SEARCH",
          title: keyword,
          content: `搜索需求：月均约 ${volume}；月度变化 ${monthlyTrend}%；季度变化 ${quarterlyTrend}%；搜索意图 ${item.search_intent_info?.main_intent ?? "unknown"}。`,
          sourceUrl: null,
          tags: ["auto", "dataforseo", "keyword"],
          market: label,
          sourceName: "DataForSEO Labs Keyword Ideas",
          metrics: {
            searchVolume: volume,
            monthlyTrend,
            quarterlyTrend,
            yearlyTrend: Number(
              item.keyword_info?.search_volume_trend?.yearly ?? 0,
            ),
            competition: Number(item.keyword_info?.competition ?? 0),
            cpc: Number(item.keyword_info?.cpc ?? 0),
            keywordDifficulty: Number(
              item.keyword_properties?.keyword_difficulty ?? 0,
            ),
            searchIntent: item.search_intent_info?.main_intent ?? null,
          },
        };
      });
  }

  private queriesFor(market: ResearchMarket) {
    const queries =
      market.countryCode === "CN"
        ? CHINESE_PAIN_QUERIES
        : ENGLISH_PAIN_QUERIES;
    return queries.slice(0, this.config.discoverySerpQueriesPerMarket);
  }

  private async collectSerp(market: ResearchMarket) {
    const queries = this.queriesFor(market);
    if (!queries.length) return [];
    const engine = market.countryCode === "CN" ? "baidu" : "google";
    const posted = await this.request<SerpResult>(
      `/serp/${engine}/organic/task_post`,
      {
        method: "POST",
        body: JSON.stringify(
          queries.map((keyword, index) => ({
            keyword,
            location_code: market.locationCode,
            language_code: market.searchLanguageCode,
            depth: 10,
            priority: 1,
            tag: `auto-discovery:${market.countryCode}:${index}`,
          })),
        ),
      },
      {
        operation: `discovery_${engine}_serp_standard`,
        units: queries.length,
        market: market.countryCode,
        estimatedCostUsd: queries.length * 0.0006,
      },
    );
    const tasks = posted.tasks ?? [];
    const invalid = tasks.find(
      (task) => !task.id || task.status_code >= 40000,
    );
    if (invalid) {
      throw new Error(invalid.status_message ?? "搜索发现任务创建失败");
    }
    const resultSets = await Promise.all(
      tasks.map((task) =>
        this.pollTask<SerpResult>(
          `/serp/${engine}/organic/task_get/advanced`,
          task.id!,
        ),
      ),
    );
    const label = marketLabel(market);
    return resultSets.flatMap((results, taskIndex) => {
      const query = queries[taskIndex] ?? "product pain";
      return (results[0]?.items ?? [])
        .filter(
          (item) =>
            item.type === "organic" &&
            boundedText(item.title, 200).length > 0 &&
            Boolean(item.url),
        )
        .slice(0, 5)
        .map((item): DiscoveredSignalInput => {
          const title = boundedText(item.title, 140);
          const description = boundedText(item.description, 1_200);
          return {
            fingerprint: fingerprint("serp", label, item.url),
            sourceType: inferSourceType(item.domain),
            title,
            content: `${description || title}\n发现查询：${query}`.slice(0, 2_000),
            sourceUrl: item.url ?? null,
            tags: ["auto", "dataforseo", "pain-search"],
            market: label,
            sourceName: `DataForSEO ${engine === "baidu" ? "Baidu" : "Google"} SERP`,
            metrics: {
              discoveryQuery: query,
              domain: item.domain ?? null,
            },
          };
        });
    });
  }

  private async collectAppStore(market: ResearchMarket) {
    if (this.config.discoveryAppDepth <= 0) return [];
    const posted = await this.request<AppListResult>(
      "/app_data/apple/app_list/task_post",
      {
        method: "POST",
        body: JSON.stringify([
          {
            app_collection: "new_free_ios",
            location_code: market.locationCode,
            language_code: market.searchLanguageCode,
            depth: this.config.discoveryAppDepth,
            priority: 1,
            tag: `auto-discovery:${market.countryCode}:new-free-ios`,
          },
        ]),
      },
      {
        operation: "discovery_apple_app_list_standard",
        units: 1,
        market: market.countryCode,
        estimatedCostUsd:
          Math.max(1, Math.ceil(this.config.discoveryAppDepth / 100)) * 0.0012,
      },
    );
    const task = posted.tasks?.[0];
    if (!task?.id || task.status_code >= 40000) {
      throw new Error(task?.status_message ?? "App Store 发现任务创建失败");
    }
    const results = await this.pollTask<AppListResult>(
      "/app_data/apple/app_list/task_get/advanced",
      task.id,
    );
    const label = marketLabel(market);
    return (results[0]?.items ?? [])
      .filter((item) => boundedText(item.title, 140).length > 0)
      .slice(0, 40)
      .map((item): DiscoveredSignalInput => {
        const title = boundedText(item.title, 140);
        const categories = item.categories?.slice(0, 5) ?? [];
        return {
          fingerprint: fingerprint(
            "app-store-new",
            label,
            item.app_id ?? item.url ?? title,
          ),
          sourceType: "APP_STORE",
          title,
          content: `新上架免费 iOS App：${title}；开发者 ${boundedText(item.developer, 120) || "unknown"}；分类 ${categories.join(", ") || "unknown"}；评分 ${ratingValue(item).toFixed(1)}；评论 ${item.reviews_count ?? 0}。`,
          sourceUrl: item.url ?? null,
          tags: ["auto", "dataforseo", "ios", "new-app"],
          market: label,
          sourceName: "DataForSEO Apple App List",
          metrics: {
            appId: item.app_id ?? null,
            developer: item.developer ?? null,
            categories,
            rating: ratingValue(item),
            reviews: Number(item.reviews_count ?? 0),
            price: Number(item.price ?? 0),
            rank: Number(item.rank_group ?? 0),
          },
        };
      });
  }

  async collect(): Promise<DiscoveryProviderResult> {
    const signals: DiscoveredSignalInput[] = [];
    const warnings: string[] = [];
    const counts = { labs: 0, web: 0, appStore: 0 };
    let budgetStopped = false;

    for (const market of this.config.researchMarkets) {
      const sources = [
        {
          label: "Labs",
          run: () => this.collectLabs(market),
          count: "labs" as const,
        },
        {
          label: market.countryCode === "CN" ? "Baidu SERP" : "Google SERP",
          run: () => this.collectSerp(market),
          count: "web" as const,
        },
        {
          label: "Apple App Store",
          run: () => this.collectAppStore(market),
          count: "appStore" as const,
        },
      ];
      for (const source of sources) {
        if (budgetStopped) break;
        try {
          const collected = await source.run();
          signals.push(...collected);
          counts[source.count] += collected.length;
        } catch (error) {
          if (error instanceof UsageBudgetExceededError) {
            budgetStopped = true;
            warnings.push(error.message);
            break;
          }
          warnings.push(
            `${market.countryCode} ${source.label}: ${
              error instanceof Error ? error.message : "未知错误"
            }`,
          );
        }
      }
    }

    return {
      signals: [
        ...new Map(signals.map((signal) => [signal.fingerprint, signal])).values(),
      ],
      counts,
      warnings,
      budgetStopped,
    };
  }
}

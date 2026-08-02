import "dotenv/config";
import path from "node:path";

export type AiProvider = "gateway" | "openai" | "anthropic" | "deepseek";
export type AiReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ResearchMarket {
  countryCode: string;
  locationCode: number;
  keywordLanguageCode: string;
  searchLanguageCode: string;
}

export interface AppConfig {
  appEnv: "development" | "test" | "production";
  host: string;
  port: number;
  publicOrigin: string;
  trustProxyHops: number;
  databasePath: string;
  databaseBusyTimeoutMs: number;
  seedDemoData: boolean;
  researchProvider: "demo" | "real";
  aiProvider: AiProvider;
  aiModel: string;
  aiGatewayApiKey?: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  deepSeekApiKey?: string;
  deepSeekBaseUrl: string;
  aiReasoningEffort: AiReasoningEffort;
  aiDisableResponseStorage: boolean;
  aiRequestTimeoutMs: number;
  researchAiConcurrency: number;
  dataForSeoLogin?: string;
  dataForSeoPassword?: string;
  marketLocationCode: number;
  marketLanguageCode: string;
  marketCountryCode: string;
  availableResearchMarkets: ResearchMarket[];
  researchMarkets: ResearchMarket[];
  collectWebCompetitors: boolean;
  collectAppleMarket: boolean;
  researchFreshnessDays: number;
  researchKeywordCacheDays: number;
  researchSerpCacheDays: number;
  researchAppCacheDays: number;
  researchRateLimitPerHour: number;
  requestRateLimitPerMinute: number;
  loginRateLimitPer15Minutes: number;
  providerRequestTimeoutMs: number;
  providerMaxRetries: number;
  maxAiRunsPerDay: number;
  maxDataForSeoTasksPerDay: number;
  maxDataForSeoCostPerDayUsd: number;
  maxDataForSeoDiscoveryCostPerDayUsd: number;
  maxDataForSeoCostPerMonthUsd: number;
  dataForSeoBatchPollIntervalMs: number;
  dataForSeoBatchTimeoutMs: number;
  autoDiscoveryEnabled: boolean;
  discoveryLabsLimit: number;
  discoveryLabsFreshnessDays: number;
  discoverySerpQueriesPerMarket: number;
  discoverySerpFreshnessDays: number;
  discoveryAppDepth: number;
  discoveryAppFreshnessDays: number;
  discoveryMaxCandidatesPerRun: number;
  discoveryAiSignalLimit: number;
  discoveryAiMaxBatchesPerRun: number;
  authRequired: boolean;
  adminUsername: string;
  adminPasswordHash?: string;
  sessionSecret?: string;
  sessionTtlHours: number;
  schedulerEnabled: boolean;
  schedulerPollIntervalMs: number;
  schedulerDiscoveryHour: number;
  schedulerResearchHour: number;
  schedulerBackupHour: number;
  backupDirectory: string;
  backupRetentionCount: number;
  alertWebhookUrl?: string;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function requireProductionValue(name: string, value: string | undefined) {
  if (!value) throw new Error(`生产配置缺少 ${name}`);
  return value;
}

function adminUsernameValue(value: string | undefined) {
  const username = (value?.trim() || "xx131").toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("ADMIN_USERNAME 只能包含 3-64 位小写字母、数字、点、下划线或连字符");
  }
  return username;
}

function aiProviderValue(value: string | undefined): AiProvider {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "deepseek" ||
    value === "gateway"
  ) {
    return value;
  }
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return process.env.OPENAI_API_KEY ? "openai" : "gateway";
}

function anthropicBaseUrlValue(value: string | undefined) {
  const normalized = (value?.trim() || "https://api.anthropic.com/v1").replace(
    /\/+$/,
    "",
  );
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function reasoningEffortValue(value: string | undefined): AiReasoningEffort {
  const efforts: AiReasoningEffort[] = [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  return efforts.includes(value as AiReasoningEffort)
    ? (value as AiReasoningEffort)
    : "xhigh";
}

function researchMarketsValue(
  value: string | undefined,
  fallback: ResearchMarket,
) {
  if (!value?.trim()) return [fallback];
  const markets = value.split(",").map((entry) => {
    const [countryCode, locationCode, keywordLanguageCode, searchLanguageCode] =
      entry.split(":").map((part) => part.trim());
    const numericLocationCode = Number(locationCode);
    if (
      !/^[A-Za-z]{2,3}$/.test(countryCode ?? "") ||
      !Number.isInteger(numericLocationCode) ||
      numericLocationCode <= 0 ||
      !keywordLanguageCode ||
      !searchLanguageCode
    ) {
      throw new Error(
        "RESEARCH_MARKETS 格式无效，应为 COUNTRY:LOCATION:KEYWORD_LANG:SEARCH_LANG，多个市场用逗号分隔",
      );
    }
    return {
      countryCode: countryCode.toUpperCase(),
      locationCode: numericLocationCode,
      keywordLanguageCode,
      searchLanguageCode,
    };
  });
  if (new Set(markets.map((market) => market.countryCode)).size !== markets.length) {
    throw new Error("RESEARCH_MARKETS 不能重复配置同一个国家");
  }
  return markets;
}

export function isAiConfigured(config: AppConfig) {
  return config.aiProvider === "openai"
    ? Boolean(config.openAiApiKey)
    : config.aiProvider === "anthropic"
      ? Boolean(config.anthropicApiKey)
      : config.aiProvider === "deepseek"
        ? Boolean(config.deepSeekApiKey)
        : Boolean(config.aiGatewayApiKey);
}

export function loadConfig(): AppConfig {
  const appEnv =
    process.env.APP_ENV === "production" || process.env.NODE_ENV === "production"
      ? "production"
      : process.env.APP_ENV === "test" || process.env.NODE_ENV === "test"
        ? "test"
        : "development";
  const host = process.env.HOST ?? "127.0.0.1";
  const port = integerInRange(process.env.PORT, 8787, 1, 65_535);
  const publicOrigin =
    process.env.PUBLIC_ORIGIN ??
    `${appEnv === "production" ? "https" : "http"}://${host}:${port}`;
  const requestedResearchProvider =
    process.env.RESEARCH_PROVIDER === "real" ? "real" : "demo";
  const aiProvider = aiProviderValue(process.env.AI_PROVIDER);
  const aiModel =
    process.env.AI_MODEL ??
    (aiProvider === "openai"
      ? "gpt-5.6-terra"
      : aiProvider === "anthropic"
        ? "claude-sonnet-4-5"
        : aiProvider === "deepseek"
          ? "deepseek-v4-flash"
          : "openai/gpt-5.6-terra");
  const anthropicApiKey =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    (aiProvider === "anthropic" ? process.env.OPENAI_API_KEY : undefined);
  const anthropicBaseUrl = anthropicBaseUrlValue(
    process.env.ANTHROPIC_BASE_URL?.trim() ||
      (aiProvider === "anthropic" ? process.env.OPENAI_BASE_URL : undefined),
  );
  const hasAi =
    aiProvider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY)
      : aiProvider === "anthropic"
        ? Boolean(anthropicApiKey)
        : aiProvider === "deepseek"
          ? Boolean(process.env.DEEPSEEK_API_KEY)
          : Boolean(process.env.AI_GATEWAY_API_KEY);
  const hasSearch = Boolean(
    process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD,
  );
  const authRequired = booleanValue(process.env.AUTH_REQUIRED, appEnv === "production");
  const seedDemoData = booleanValue(process.env.SEED_DEMO_DATA, appEnv !== "production");
  const marketLocationCode = integerInRange(
    process.env.MARKET_LOCATION_CODE,
    2840,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const marketLanguageCode =
    process.env.MARKET_LANGUAGE_CODE?.trim() || "en";
  const marketCountryCode =
    process.env.MARKET_COUNTRY_CODE?.trim().toUpperCase() || "US";
  const researchMarkets = researchMarketsValue(process.env.RESEARCH_MARKETS, {
    countryCode: marketCountryCode,
    locationCode: marketLocationCode,
    keywordLanguageCode: marketLanguageCode,
    searchLanguageCode: marketLanguageCode,
  });

  if (appEnv === "production") {
    const configuredOrigin = requireProductionValue(
      "PUBLIC_ORIGIN",
      process.env.PUBLIC_ORIGIN,
    );
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(configuredOrigin);
    } catch {
      throw new Error("PUBLIC_ORIGIN 必须是有效的 HTTPS Origin");
    }
    if (
      parsedOrigin.protocol !== "https:" ||
      parsedOrigin.origin !== configuredOrigin.replace(/\/+$/, "")
    ) {
      throw new Error("PUBLIC_ORIGIN 必须是没有路径的 HTTPS Origin");
    }
    if (!["demo", "real"].includes(process.env.RESEARCH_PROVIDER ?? "")) {
      throw new Error("生产环境必须显式设置 RESEARCH_PROVIDER=demo 或 real");
    }
    if (requestedResearchProvider === "real" && (!hasAi || !hasSearch)) {
      throw new Error(
        "RESEARCH_PROVIDER=real 时必须配置 AI 凭据、DATAFORSEO_LOGIN 和 DATAFORSEO_PASSWORD",
      );
    }
    if (!authRequired) throw new Error("生产环境不允许关闭 AUTH_REQUIRED");
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    if (
      passwordHash &&
      !/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash)
    ) {
      throw new Error("ADMIN_PASSWORD_HASH 格式无效，请使用 npm run auth:hash 生成");
    }
    const secret = requireProductionValue("SESSION_SECRET", process.env.SESSION_SECRET);
    if (secret.length < 32) throw new Error("SESSION_SECRET 至少需要 32 个字符");
  }

  return {
    appEnv,
    host,
    port,
    publicOrigin: publicOrigin.replace(/\/+$/, ""),
    trustProxyHops: integerInRange(
      process.env.TRUST_PROXY_HOPS,
      0,
      0,
      10,
    ),
    databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/product-radar.db"),
    databaseBusyTimeoutMs: positiveNumber(
      process.env.DATABASE_BUSY_TIMEOUT_MS,
      5_000,
    ),
    seedDemoData,
    researchProvider:
      requestedResearchProvider === "real" && hasAi && hasSearch ? "real" : "demo",
    aiProvider,
    aiModel,
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    anthropicApiKey,
    anthropicBaseUrl,
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
    deepSeekBaseUrl:
      process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, "") ||
      "https://api.deepseek.com",
    aiReasoningEffort:
      aiProvider === "deepseek"
        ? "max"
        : reasoningEffortValue(process.env.AI_REASONING_EFFORT),
    aiDisableResponseStorage: booleanValue(
      process.env.AI_DISABLE_RESPONSE_STORAGE,
      true,
    ),
    aiRequestTimeoutMs: positiveNumber(
      process.env.AI_REQUEST_TIMEOUT_MS,
      10 * 60 * 1_000,
    ),
    researchAiConcurrency: integerInRange(
      process.env.RESEARCH_AI_CONCURRENCY,
      1,
      1,
      3,
    ),
    dataForSeoLogin: process.env.DATAFORSEO_LOGIN,
    dataForSeoPassword: process.env.DATAFORSEO_PASSWORD,
    marketLocationCode,
    marketLanguageCode,
    marketCountryCode,
    availableResearchMarkets: researchMarkets.map((market) => ({ ...market })),
    researchMarkets,
    collectWebCompetitors: booleanValue(
      process.env.COLLECT_WEB_COMPETITORS,
      true,
    ),
    collectAppleMarket: booleanValue(process.env.COLLECT_APPLE_MARKET, true),
    researchFreshnessDays: positiveNumber(process.env.RESEARCH_FRESHNESS_DAYS, 7),
    researchKeywordCacheDays: positiveNumber(
      process.env.RESEARCH_KEYWORD_CACHE_DAYS,
      30,
    ),
    researchSerpCacheDays: positiveNumber(
      process.env.RESEARCH_SERP_CACHE_DAYS,
      14,
    ),
    researchAppCacheDays: positiveNumber(
      process.env.RESEARCH_APP_CACHE_DAYS,
      30,
    ),
    researchRateLimitPerHour: positiveNumber(
      process.env.RESEARCH_RATE_LIMIT_PER_HOUR,
      30,
    ),
    requestRateLimitPerMinute: positiveNumber(
      process.env.REQUEST_RATE_LIMIT_PER_MINUTE,
      240,
    ),
    loginRateLimitPer15Minutes: positiveNumber(
      process.env.LOGIN_RATE_LIMIT_PER_15_MINUTES,
      10,
    ),
    providerRequestTimeoutMs: positiveNumber(
      process.env.PROVIDER_REQUEST_TIMEOUT_MS,
      120_000,
    ),
    providerMaxRetries: integerInRange(
      process.env.PROVIDER_MAX_RETRIES,
      2,
      0,
      8,
    ),
    maxAiRunsPerDay: nonNegativeNumber(process.env.MAX_AI_RUNS_PER_DAY, 30),
    maxDataForSeoTasksPerDay: nonNegativeNumber(
      process.env.MAX_DATAFORSEO_TASKS_PER_DAY,
      100,
    ),
    maxDataForSeoCostPerDayUsd: nonNegativeNumber(
      process.env.MAX_DATAFORSEO_COST_PER_DAY_USD,
      0.5,
    ),
    maxDataForSeoDiscoveryCostPerDayUsd: nonNegativeNumber(
      process.env.MAX_DATAFORSEO_DISCOVERY_COST_PER_DAY_USD,
      0.05,
    ),
    maxDataForSeoCostPerMonthUsd: nonNegativeNumber(
      process.env.MAX_DATAFORSEO_COST_PER_MONTH_USD,
      10,
    ),
    dataForSeoBatchPollIntervalMs: positiveNumber(
      process.env.DATAFORSEO_BATCH_POLL_INTERVAL_MS,
      60_000,
    ),
    dataForSeoBatchTimeoutMs: positiveNumber(
      process.env.DATAFORSEO_BATCH_TIMEOUT_MS,
      4 * 60 * 60 * 1_000,
    ),
    autoDiscoveryEnabled: booleanValue(
      process.env.AUTO_DISCOVERY_ENABLED,
      requestedResearchProvider === "real" && hasAi && hasSearch,
    ),
    discoveryLabsLimit: integerInRange(
      process.env.DISCOVERY_LABS_LIMIT,
      100,
      10,
      1_000,
    ),
    discoveryLabsFreshnessDays: positiveNumber(
      process.env.DISCOVERY_LABS_FRESHNESS_DAYS,
      30,
    ),
    discoverySerpQueriesPerMarket: integerInRange(
      process.env.DISCOVERY_SERP_QUERIES_PER_MARKET,
      8,
      0,
      50,
    ),
    discoverySerpFreshnessDays: positiveNumber(
      process.env.DISCOVERY_SERP_FRESHNESS_DAYS,
      3,
    ),
    discoveryAppDepth: integerInRange(
      process.env.DISCOVERY_APP_DEPTH,
      100,
      0,
      1_000,
    ),
    discoveryAppFreshnessDays: positiveNumber(
      process.env.DISCOVERY_APP_FRESHNESS_DAYS,
      1,
    ),
    discoveryMaxCandidatesPerRun: integerInRange(
      process.env.DISCOVERY_MAX_CANDIDATES_PER_RUN,
      5,
      1,
      20,
    ),
    discoveryAiSignalLimit: integerInRange(
      process.env.DISCOVERY_AI_SIGNAL_LIMIT,
      60,
      20,
      300,
    ),
    discoveryAiMaxBatchesPerRun: integerInRange(
      process.env.DISCOVERY_AI_MAX_BATCHES_PER_RUN,
      5,
      1,
      20,
    ),
    authRequired,
    adminUsername: adminUsernameValue(process.env.ADMIN_USERNAME),
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
    sessionSecret: process.env.SESSION_SECRET,
    sessionTtlHours: positiveNumber(process.env.SESSION_TTL_HOURS, 24),
    schedulerEnabled: booleanValue(
      process.env.SCHEDULER_ENABLED,
      appEnv === "production",
    ),
    schedulerPollIntervalMs: positiveNumber(
      process.env.SCHEDULER_POLL_INTERVAL_MS,
      15 * 60 * 1_000,
    ),
    schedulerDiscoveryHour: integerInRange(
      process.env.SCHEDULER_DISCOVERY_HOUR,
      3,
      0,
      23,
    ),
    schedulerResearchHour: integerInRange(
      process.env.SCHEDULER_RESEARCH_HOUR,
      3,
      0,
      23,
    ),
    schedulerBackupHour: integerInRange(
      process.env.SCHEDULER_BACKUP_HOUR,
      2,
      0,
      23,
    ),
    backupDirectory: path.resolve(
      process.env.BACKUP_DIRECTORY ?? "./data/backups",
    ),
    backupRetentionCount: integerInRange(
      process.env.BACKUP_RETENTION_COUNT,
      14,
      1,
      365,
    ),
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
  };
}

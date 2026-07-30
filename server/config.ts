import "dotenv/config";
import path from "node:path";

export type AiProvider = "gateway" | "openai";
export type AiReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AppConfig {
  port: number;
  databasePath: string;
  researchProvider: "demo" | "real";
  aiProvider: AiProvider;
  aiModel: string;
  aiGatewayApiKey?: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  aiReasoningEffort: AiReasoningEffort;
  aiDisableResponseStorage: boolean;
  dataForSeoLogin?: string;
  dataForSeoPassword?: string;
  researchFreshnessDays: number;
  researchRateLimitPerHour: number;
  dataForSeoBatchPollIntervalMs: number;
  dataForSeoBatchTimeoutMs: number;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function aiProviderValue(value: string | undefined): AiProvider {
  if (value === "openai" || value === "gateway") return value;
  return process.env.OPENAI_API_KEY ? "openai" : "gateway";
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

export function isAiConfigured(config: AppConfig) {
  return config.aiProvider === "openai"
    ? Boolean(config.openAiApiKey)
    : Boolean(config.aiGatewayApiKey);
}

export function loadConfig(): AppConfig {
  const requestedResearchProvider =
    process.env.RESEARCH_PROVIDER === "real" ? "real" : "demo";
  const aiProvider = aiProviderValue(process.env.AI_PROVIDER);
  const aiModel =
    process.env.AI_MODEL ??
    (aiProvider === "openai" ? "gpt-5.6-terra" : "openai/gpt-5.6-terra");
  const hasAi =
    aiProvider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY)
      : Boolean(process.env.AI_GATEWAY_API_KEY);
  const hasSearch = Boolean(
    process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD,
  );

  return {
    port: Number(process.env.PORT ?? 8787),
    databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/product-radar.db"),
    researchProvider:
      requestedResearchProvider === "real" && hasAi && hasSearch ? "real" : "demo",
    aiProvider,
    aiModel,
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    aiReasoningEffort: reasoningEffortValue(process.env.AI_REASONING_EFFORT),
    aiDisableResponseStorage: booleanValue(
      process.env.AI_DISABLE_RESPONSE_STORAGE,
      true,
    ),
    dataForSeoLogin: process.env.DATAFORSEO_LOGIN,
    dataForSeoPassword: process.env.DATAFORSEO_PASSWORD,
    researchFreshnessDays: positiveNumber(process.env.RESEARCH_FRESHNESS_DAYS, 7),
    researchRateLimitPerHour: positiveNumber(
      process.env.RESEARCH_RATE_LIMIT_PER_HOUR,
      30,
    ),
    dataForSeoBatchPollIntervalMs: positiveNumber(
      process.env.DATAFORSEO_BATCH_POLL_INTERVAL_MS,
      60_000,
    ),
    dataForSeoBatchTimeoutMs: positiveNumber(
      process.env.DATAFORSEO_BATCH_TIMEOUT_MS,
      4 * 60 * 60 * 1_000,
    ),
  };
}

import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  port: number;
  databasePath: string;
  researchProvider: "demo" | "real";
  aiModel: string;
  aiGatewayApiKey?: string;
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

export function loadConfig(): AppConfig {
  const requestedProvider = process.env.RESEARCH_PROVIDER === "real" ? "real" : "demo";
  const hasAi = Boolean(process.env.AI_GATEWAY_API_KEY);
  const hasSearch = Boolean(
    process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD,
  );

  return {
    port: Number(process.env.PORT ?? 8787),
    databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/product-radar.db"),
    researchProvider: requestedProvider === "real" && hasAi && hasSearch ? "real" : "demo",
    aiModel: process.env.AI_MODEL ?? "openai/gpt-5.6-terra",
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY,
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

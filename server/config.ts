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
  };
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { AiProvider, AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";

const RUNTIME_SETTINGS_KEY = "runtime_preferences_v1";
const SECRET_PREFIX = "encrypted_ai_key_v1:";

const storedRuntimeSettingsSchema = z.object({
  aiProvider: z.enum(["openai", "anthropic", "gateway"]),
  aiModel: z.string().trim().min(1).max(120),
  openAiBaseUrl: z.string().url(),
  anthropicBaseUrl: z.string().url(),
  aiRequestTimeoutMs: z.number().int().min(30_000).max(30 * 60 * 1_000),
  researchAiConcurrency: z.number().int().min(1).max(3).default(1),
  providerMaxRetries: z.number().int().min(0).max(3),
  discoveryAiSignalLimit: z.number().int().min(20).max(300),
  discoveryAiMaxBatchesPerRun: z.number().int().min(1).max(20),
  autoDiscoveryEnabled: z.boolean(),
  discoveryMaxCandidatesPerRun: z.number().int().min(1).max(20),
  schedulerDiscoveryHour: z.number().int().min(0).max(23),
  schedulerResearchHour: z.number().int().min(0).max(23),
  schedulerBackupHour: z.number().int().min(0).max(23),
  enabledMarketCodes: z.array(z.string().trim().min(2).max(3)).min(1),
  maxDataForSeoCostPerDayUsd: z.number().min(0).max(1_000),
  maxDataForSeoDiscoveryCostPerDayUsd: z.number().min(0).max(1_000),
  maxDataForSeoCostPerMonthUsd: z.number().min(0).max(10_000),
  researchKeywordCacheDays: z.number().int().min(1).max(365),
  researchSerpCacheDays: z.number().int().min(1).max(365),
  researchAppCacheDays: z.number().int().min(1).max(365),
  discoveryLabsFreshnessDays: z.number().int().min(1).max(365),
  discoverySerpFreshnessDays: z.number().int().min(1).max(365),
  discoveryAppFreshnessDays: z.number().int().min(1).max(365),
});

export const runtimeSettingsUpdateSchema = z
  .object({
    aiProvider: z.enum(["openai", "anthropic", "gateway"]),
    aiModel: z.string().trim().min(1).max(120),
    aiBaseUrl: z.string().trim().max(300),
    aiApiKey: z.string().trim().max(1_000).optional(),
    aiRequestTimeoutSeconds: z.number().int().min(30).max(1_800),
    researchAiConcurrency: z.number().int().min(1).max(3),
    providerMaxRetries: z.number().int().min(0).max(3),
    discoveryAiSignalLimit: z.number().int().min(20).max(300),
    discoveryAiMaxBatchesPerRun: z.number().int().min(1).max(20),
    autoDiscoveryEnabled: z.boolean(),
    discoveryMaxCandidatesPerRun: z.number().int().min(1).max(20),
    schedulerDiscoveryHour: z.number().int().min(0).max(23),
    schedulerResearchHour: z.number().int().min(0).max(23),
    schedulerBackupHour: z.number().int().min(0).max(23),
    enabledMarketCodes: z.array(z.string().trim().min(2).max(3)).min(1),
    maxDataForSeoCostPerDayUsd: z.number().min(0).max(1_000),
    maxDataForSeoDiscoveryCostPerDayUsd: z.number().min(0).max(1_000),
    maxDataForSeoCostPerMonthUsd: z.number().min(0).max(10_000),
    researchKeywordCacheDays: z.number().int().min(1).max(365),
    researchSerpCacheDays: z.number().int().min(1).max(365),
    researchAppCacheDays: z.number().int().min(1).max(365),
    discoveryLabsFreshnessDays: z.number().int().min(1).max(365),
    discoverySerpFreshnessDays: z.number().int().min(1).max(365),
    discoveryAppFreshnessDays: z.number().int().min(1).max(365),
  })
  .superRefine((value, context) => {
    if (value.aiProvider !== "gateway") {
      try {
        new URL(value.aiBaseUrl);
      } catch {
        context.addIssue({
          code: "custom",
          path: ["aiBaseUrl"],
          message: "AI Base URL 格式无效",
        });
      }
    }
    if (
      value.maxDataForSeoDiscoveryCostPerDayUsd >
      value.maxDataForSeoCostPerDayUsd
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxDataForSeoDiscoveryCostPerDayUsd"],
        message: "自动发现每日上限不能高于 DataForSEO 每日总上限",
      });
    }
  });

export type RuntimeSettingsUpdate = z.infer<
  typeof runtimeSettingsUpdateSchema
>;
type StoredRuntimeSettings = z.infer<typeof storedRuntimeSettingsSchema>;

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function anthropicBaseUrl(value: string) {
  const normalized = normalizedBaseUrl(value);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function encryptionKey(sessionSecret: string) {
  return createHash("sha256")
    .update("product-radar-runtime-settings-v1")
    .update(sessionSecret)
    .digest();
}

function encryptSecret(value: string, sessionSecret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(sessionSecret), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptSecret(value: string, sessionSecret: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("加密密钥格式无效");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(sessionSecret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function storedValue(db: RadarDatabase, key: string) {
  return db
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
}

function upsertValue(db: RadarDatabase, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

function secretConfigKey(provider: AiProvider) {
  return `${SECRET_PREFIX}${provider}`;
}

function loadEncryptedSecret(
  db: RadarDatabase,
  provider: AiProvider,
  sessionSecret: string | undefined,
) {
  if (!sessionSecret) return undefined;
  const row = storedValue(db, secretConfigKey(provider));
  if (!row) return undefined;
  try {
    const encrypted = JSON.parse(row.value_json) as unknown;
    return typeof encrypted === "string"
      ? decryptSecret(encrypted, sessionSecret)
      : undefined;
  } catch {
    return undefined;
  }
}

function preferencesFromConfig(config: AppConfig): StoredRuntimeSettings {
  return {
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    openAiBaseUrl: config.openAiBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl,
    aiRequestTimeoutMs: config.aiRequestTimeoutMs,
    researchAiConcurrency: config.researchAiConcurrency,
    providerMaxRetries: config.providerMaxRetries,
    discoveryAiSignalLimit: config.discoveryAiSignalLimit,
    discoveryAiMaxBatchesPerRun: config.discoveryAiMaxBatchesPerRun,
    autoDiscoveryEnabled: config.autoDiscoveryEnabled,
    discoveryMaxCandidatesPerRun: config.discoveryMaxCandidatesPerRun,
    schedulerDiscoveryHour: config.schedulerDiscoveryHour,
    schedulerResearchHour: config.schedulerResearchHour,
    schedulerBackupHour: config.schedulerBackupHour,
    enabledMarketCodes: config.researchMarkets.map((market) => market.countryCode),
    maxDataForSeoCostPerDayUsd: config.maxDataForSeoCostPerDayUsd,
    maxDataForSeoDiscoveryCostPerDayUsd:
      config.maxDataForSeoDiscoveryCostPerDayUsd,
    maxDataForSeoCostPerMonthUsd: config.maxDataForSeoCostPerMonthUsd,
    researchKeywordCacheDays: config.researchKeywordCacheDays,
    researchSerpCacheDays: config.researchSerpCacheDays,
    researchAppCacheDays: config.researchAppCacheDays,
    discoveryLabsFreshnessDays: config.discoveryLabsFreshnessDays,
    discoverySerpFreshnessDays: config.discoverySerpFreshnessDays,
    discoveryAppFreshnessDays: config.discoveryAppFreshnessDays,
  };
}

function applyPreferences(
  config: AppConfig,
  preferences: StoredRuntimeSettings,
) {
  const { enabledMarketCodes, ...assignablePreferences } = preferences;
  const marketCodes = new Set(
    enabledMarketCodes.map((code) => code.toUpperCase()),
  );
  const selectedMarkets = config.availableResearchMarkets.filter((market) =>
    marketCodes.has(market.countryCode),
  );
  Object.assign(config, assignablePreferences, {
    researchMarkets: selectedMarkets.length
      ? selectedMarkets.map((market) => ({ ...market }))
      : config.availableResearchMarkets.map((market) => ({ ...market })),
  });
}

export function applyStoredRuntimeSettings(
  db: RadarDatabase,
  config: AppConfig,
) {
  const row = storedValue(db, RUNTIME_SETTINGS_KEY);
  if (row) {
    try {
      const parsed = storedRuntimeSettingsSchema.safeParse(
        JSON.parse(row.value_json),
      );
      if (parsed.success) applyPreferences(config, parsed.data);
    } catch {
      // Keep deployment defaults when persisted settings are unreadable.
    }
  }

  const openAiKey = loadEncryptedSecret(db, "openai", config.sessionSecret);
  const anthropicKey = loadEncryptedSecret(
    db,
    "anthropic",
    config.sessionSecret,
  );
  const gatewayKey = loadEncryptedSecret(db, "gateway", config.sessionSecret);
  if (openAiKey) config.openAiApiKey = openAiKey;
  if (anthropicKey) config.anthropicApiKey = anthropicKey;
  if (gatewayKey) config.aiGatewayApiKey = gatewayKey;
  return config;
}

export function previewRuntimeSettings(
  config: AppConfig,
  input: RuntimeSettingsUpdate,
) {
  const availableCodes = new Set(
    config.availableResearchMarkets.map((market) => market.countryCode),
  );
  const enabledMarketCodes = [
    ...new Set(input.enabledMarketCodes.map((code) => code.toUpperCase())),
  ];
  if (enabledMarketCodes.some((code) => !availableCodes.has(code))) {
    throw new Error("包含服务器尚未配置的数据市场");
  }
  const current = preferencesFromConfig(config);
  const next: StoredRuntimeSettings = {
    ...current,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    openAiBaseUrl:
      input.aiProvider === "openai"
        ? normalizedBaseUrl(input.aiBaseUrl)
        : current.openAiBaseUrl,
    anthropicBaseUrl:
      input.aiProvider === "anthropic"
        ? anthropicBaseUrl(input.aiBaseUrl)
        : current.anthropicBaseUrl,
    aiRequestTimeoutMs: input.aiRequestTimeoutSeconds * 1_000,
    researchAiConcurrency: input.researchAiConcurrency,
    providerMaxRetries: input.providerMaxRetries,
    discoveryAiSignalLimit: input.discoveryAiSignalLimit,
    discoveryAiMaxBatchesPerRun: input.discoveryAiMaxBatchesPerRun,
    autoDiscoveryEnabled: input.autoDiscoveryEnabled,
    discoveryMaxCandidatesPerRun: input.discoveryMaxCandidatesPerRun,
    schedulerDiscoveryHour: input.schedulerDiscoveryHour,
    schedulerResearchHour: input.schedulerResearchHour,
    schedulerBackupHour: input.schedulerBackupHour,
    enabledMarketCodes,
    maxDataForSeoCostPerDayUsd: input.maxDataForSeoCostPerDayUsd,
    maxDataForSeoDiscoveryCostPerDayUsd:
      input.maxDataForSeoDiscoveryCostPerDayUsd,
    maxDataForSeoCostPerMonthUsd: input.maxDataForSeoCostPerMonthUsd,
    researchKeywordCacheDays: input.researchKeywordCacheDays,
    researchSerpCacheDays: input.researchSerpCacheDays,
    researchAppCacheDays: input.researchAppCacheDays,
    discoveryLabsFreshnessDays: input.discoveryLabsFreshnessDays,
    discoverySerpFreshnessDays: input.discoverySerpFreshnessDays,
    discoveryAppFreshnessDays: input.discoveryAppFreshnessDays,
  };
  const preview: AppConfig = {
    ...config,
    availableResearchMarkets: config.availableResearchMarkets.map((market) => ({
      ...market,
    })),
    researchMarkets: config.researchMarkets.map((market) => ({ ...market })),
  };
  applyPreferences(preview, next);
  const apiKey = input.aiApiKey?.trim();
  if (apiKey) {
    if (input.aiProvider === "openai") preview.openAiApiKey = apiKey;
    if (input.aiProvider === "anthropic") preview.anthropicApiKey = apiKey;
    if (input.aiProvider === "gateway") preview.aiGatewayApiKey = apiKey;
  }
  return { preview, preferences: next };
}

export function saveRuntimeSettings(
  db: RadarDatabase,
  config: AppConfig,
  input: RuntimeSettingsUpdate,
) {
  const { preview, preferences } = previewRuntimeSettings(config, input);
  const apiKey = input.aiApiKey?.trim();
  if (apiKey && !config.sessionSecret) {
    throw new Error("当前环境缺少 SESSION_SECRET，不能安全保存 API Key");
  }
  db.transaction(() => {
    upsertValue(db, RUNTIME_SETTINGS_KEY, preferences);
    if (apiKey && config.sessionSecret) {
      upsertValue(
        db,
        secretConfigKey(input.aiProvider),
        encryptSecret(apiKey, config.sessionSecret),
      );
    }
  })();
  Object.assign(config, preview);
  return config;
}

export function runtimeSettingsResponse(config: AppConfig) {
  const selectedBaseUrl =
    config.aiProvider === "openai"
      ? config.openAiBaseUrl
      : config.aiProvider === "anthropic"
        ? config.anthropicBaseUrl
        : "";
  const aiKeyConfigured =
    config.aiProvider === "openai"
      ? Boolean(config.openAiApiKey)
      : config.aiProvider === "anthropic"
        ? Boolean(config.anthropicApiKey)
        : Boolean(config.aiGatewayApiKey);
  return {
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    aiBaseUrl: selectedBaseUrl,
    aiKeyConfigured,
    aiRequestTimeoutSeconds: Math.round(config.aiRequestTimeoutMs / 1_000),
    researchAiConcurrency: config.researchAiConcurrency,
    providerMaxRetries: config.providerMaxRetries,
    discoveryAiSignalLimit: config.discoveryAiSignalLimit,
    discoveryAiMaxBatchesPerRun: config.discoveryAiMaxBatchesPerRun,
    autoDiscoveryEnabled: config.autoDiscoveryEnabled,
    discoveryMaxCandidatesPerRun: config.discoveryMaxCandidatesPerRun,
    schedulerDiscoveryHour: config.schedulerDiscoveryHour,
    schedulerResearchHour: config.schedulerResearchHour,
    schedulerBackupHour: config.schedulerBackupHour,
    markets: config.availableResearchMarkets.map((market) => ({
      countryCode: market.countryCode,
      languageCode: market.searchLanguageCode,
      enabled: config.researchMarkets.some(
        (selected) => selected.countryCode === market.countryCode,
      ),
    })),
    maxDataForSeoCostPerDayUsd: config.maxDataForSeoCostPerDayUsd,
    maxDataForSeoDiscoveryCostPerDayUsd:
      config.maxDataForSeoDiscoveryCostPerDayUsd,
    maxDataForSeoCostPerMonthUsd: config.maxDataForSeoCostPerMonthUsd,
    researchKeywordCacheDays: config.researchKeywordCacheDays,
    researchSerpCacheDays: config.researchSerpCacheDays,
    researchAppCacheDays: config.researchAppCacheDays,
    discoveryLabsFreshnessDays: config.discoveryLabsFreshnessDays,
    discoverySerpFreshnessDays: config.discoverySerpFreshnessDays,
    discoveryAppFreshnessDays: config.discoveryAppFreshnessDays,
  };
}

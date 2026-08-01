import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  applyStoredRuntimeSettings,
  runtimeSettingsResponse,
  saveRuntimeSettings,
} from "./runtime-settings.js";
import { createTestConfig } from "./test-config.js";

describe("runtime settings", () => {
  it("persists preferences and encrypts provider keys without returning them", () => {
    const database = createDatabase(":memory:", false);
    const config = createTestConfig({
      sessionSecret: "a-secure-test-session-secret-with-32-chars",
      availableResearchMarkets: [
        { countryCode: "US", locationCode: 2840, keywordLanguageCode: "en", searchLanguageCode: "en" },
        { countryCode: "CN", locationCode: 2156, keywordLanguageCode: "zh_CN", searchLanguageCode: "zh-CN" },
      ],
    });

    saveRuntimeSettings(database, config, {
      aiProvider: "anthropic",
      aiModel: "claude-opus-5",
      aiBaseUrl: "https://relay.example",
      aiApiKey: "secret-provider-key",
      aiRequestTimeoutSeconds: 600,
      researchAiConcurrency: 1,
      providerMaxRetries: 1,
      discoveryAiSignalLimit: 60,
      discoveryAiMaxBatchesPerRun: 5,
      autoDiscoveryEnabled: true,
      discoveryMaxCandidatesPerRun: 5,
      schedulerDiscoveryHour: 4,
      schedulerResearchHour: 5,
      schedulerBackupHour: 2,
      enabledMarketCodes: ["US", "CN"],
      maxDataForSeoCostPerDayUsd: 0.5,
      maxDataForSeoDiscoveryCostPerDayUsd: 0.05,
      maxDataForSeoCostPerMonthUsd: 10,
      researchKeywordCacheDays: 30,
      researchSerpCacheDays: 14,
      researchAppCacheDays: 30,
      discoveryLabsFreshnessDays: 30,
      discoverySerpFreshnessDays: 3,
      discoveryAppFreshnessDays: 1,
    });

    const stored = database
      .prepare("SELECT value_json FROM settings")
      .all() as Array<{ value_json: string }>;
    expect(JSON.stringify(stored)).not.toContain("secret-provider-key");
    expect(config.anthropicApiKey).toBe("secret-provider-key");
    expect(config.anthropicBaseUrl).toBe("https://relay.example/v1");
    expect(config.aiRequestTimeoutMs).toBe(600_000);
    expect(config.researchAiConcurrency).toBe(1);
    expect(config.researchMarkets.map((market) => market.countryCode)).toEqual([
      "US",
      "CN",
    ]);
    expect(runtimeSettingsResponse(config)).not.toHaveProperty("aiApiKey");

    const restarted = createTestConfig({
      sessionSecret: config.sessionSecret,
      availableResearchMarkets: config.availableResearchMarkets,
    });
    applyStoredRuntimeSettings(database, restarted);
    expect(restarted.anthropicApiKey).toBe("secret-provider-key");
    expect(restarted.aiModel).toBe("claude-opus-5");
    expect(restarted.aiRequestTimeoutMs).toBe(600_000);
    database.close();
  });
});

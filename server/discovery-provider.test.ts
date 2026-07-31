import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./db.js";
import { DataForSeoDiscoveryProvider } from "./discovery-provider.js";
import { createTestConfig } from "./test-config.js";
import { UsageLedger } from "./usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSEO automatic discovery", () => {
  it("normalizes Labs keyword ideas and records provider-reported cost", async () => {
    const database = createDatabase(":memory:", false);
    const config = createTestConfig({
      researchProvider: "real",
      dataForSeoLogin: "login",
      dataForSeoPassword: "password",
      autoDiscoveryEnabled: true,
      discoveryLabsLimit: 10,
      discoverySerpQueriesPerMarket: 0,
      discoveryAppDepth: 0,
    });
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status_code: 20000,
          cost: 0.0132,
          tasks: [
            {
              status_code: 20000,
              cost: 0.0132,
              result: [
                {
                  items: [
                    {
                      keyword: "automatic receipt organizer",
                      keyword_info: {
                        search_volume: 8100,
                        competition: 0.42,
                        cpc: 2.4,
                        search_volume_trend: {
                          monthly: 28,
                          quarterly: 44,
                          yearly: 75,
                        },
                      },
                      keyword_properties: { keyword_difficulty: 31 },
                      search_intent_info: { main_intent: "commercial" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DataForSeoDiscoveryProvider(
      config,
      database,
    ).collect();

    expect(result.counts).toEqual({ labs: 1, web: 0, appStore: 0 });
    expect(result.signals[0]).toMatchObject({
      sourceType: "TREND",
      title: "automatic receipt organizer",
      market: "US/en",
      metrics: {
        searchVolume: 8100,
        monthlyTrend: 28,
      },
    });
    expect(new UsageLedger(database, config).today().dataForSeo).toMatchObject({
      used: 1,
      reportedCostUsd: 0.0132,
    });
    database.close();
  });

  it("does not repurchase discovery data inside its source freshness window", async () => {
    const database = createDatabase(":memory:", false);
    const config = createTestConfig({
      researchProvider: "real",
      dataForSeoLogin: "login",
      dataForSeoPassword: "password",
      autoDiscoveryEnabled: true,
      discoverySerpQueriesPerMarket: 0,
      discoveryAppDepth: 0,
    });
    database.prepare(
      `INSERT INTO usage_events (
         id, provider, operation, units, cost_usd, metadata_json, created_at
       ) VALUES (?, 'DATAFORSEO', 'discovery_keyword_ideas', 1, 0.024, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      JSON.stringify({ market: "US", automaticDiscovery: true }),
      new Date().toISOString(),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DataForSeoDiscoveryProvider(
      config,
      database,
    ).collect();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.counts).toEqual({ labs: 0, web: 0, appStore: 0 });
    database.close();
  });

  it("does not automatically retry a paid POST after an ambiguous failure", async () => {
    const database = createDatabase(":memory:", false);
    const config = createTestConfig({
      researchProvider: "real",
      dataForSeoLogin: "login",
      dataForSeoPassword: "password",
      autoDiscoveryEnabled: true,
      providerMaxRetries: 3,
      discoverySerpQueriesPerMarket: 0,
      discoveryAppDepth: 0,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("temporary error", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DataForSeoDiscoveryProvider(
      config,
      database,
    ).collect();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.warnings).toHaveLength(1);
    database.close();
  });
});

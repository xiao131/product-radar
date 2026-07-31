import { afterEach, describe, expect, it, vi } from "vitest";
import type { Opportunity } from "../shared/types.js";
import { createTestConfig } from "./test-config.js";
import { DataForSeoProvider, estimateResearchCost } from "./providers.js";

function opportunity(id: string, name: string): Opportunity {
  return {
    id,
    name,
    oneLiner: `${name} one-liner`,
    targetUser: "Independent developers",
    sourceType: "IDEA",
    recommendedPlatform: "WEB",
    verdict: "WATCH",
    researchStatus: "UNRESEARCHED",
    score: 0,
    scoreDelta: 0,
    confidence: 0,
    demandScore: 0,
    painScore: 0,
    trendScore: 0,
    willingnessScore: 0,
    competitionGapScore: 0,
    reachabilityScore: 0,
    buildabilityScore: 0,
    founderFitScore: 0,
    freshnessScore: 0,
    changeSummary: "",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastResearchedAt: null,
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function searchResult(keyword: string, searchVolume: number) {
  return {
    keyword,
    search_volume: searchVolume,
    competition_index: 42,
    cpc: 1.5,
    monthly_searches: [
      { year: 2026, month: 6, search_volume: searchVolume },
      { year: 2025, month: 7, search_volume: searchVolume / 2 },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSeoProvider", () => {
  it("estimates task units and cost before a paid request", () => {
    const config = createTestConfig({
      researchProvider: "real",
      researchMarkets: [
        {
          countryCode: "US",
          locationCode: 2840,
          keywordLanguageCode: "en",
          searchLanguageCode: "en",
        },
        {
          countryCode: "CN",
          locationCode: 2156,
          keywordLanguageCode: "zh_CN",
          searchLanguageCode: "zh-CN",
        },
      ],
      collectWebCompetitors: true,
      collectAppleMarket: true,
    });
    expect(estimateResearchCost([opportunity("web", "Web Tool")], config)).toEqual({
      taskUnits: 4,
      estimatedCostUsd: 0.184,
    });
    expect(
      estimateResearchCost(
        [
          opportunity("web", "Web Tool"),
          {
            ...opportunity("ios", "iOS Tool"),
            recommendedPlatform: "IOS",
          },
          {
            ...opportunity("both", "Cross Platform Tool"),
            recommendedPlatform: "WEB_AND_IOS",
          },
        ],
        config,
        "standard",
      ),
    ).toEqual({ taskUnits: 10, estimatedCostUsd: 0.1328 });
  });

  it("collects multiple opportunities in one live task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            status_message: "Ok.",
            result: [
              searchResult("first tool", 1000),
              searchResult("second tool", 2000),
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DataForSeoProvider("login", "password");

    const results = await provider.collectBatch([
      { opportunity: opportunity("one", "First Tool"), version: 1 },
      { opportunity: opportunity("two", "Second Tool"), version: 1 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/search_volume\/live$/);
    expect(JSON.parse(String(init.body))[0].keywords).toEqual([
      "first tool",
      "second tool",
    ]);
    expect(results.get("one")?.find((item) => item.metric === "monthly_searches")?.value)
      .toBe(1000);
    expect(results.get("two")?.find((item) => item.metric === "monthly_searches")?.value)
      .toBe(2000);
  });

  it("collects the same candidate across English and Chinese markets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              status_message: "Ok.",
              result: [searchResult("bilingual tool", 1200)],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              status_message: "Ok.",
              result: [searchResult("bilingual tool", 600)],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DataForSeoProvider("login", "password", {
      markets: [
        {
          countryCode: "US",
          locationCode: 2840,
          keywordLanguageCode: "en",
          searchLanguageCode: "en",
        },
        {
          countryCode: "CN",
          locationCode: 2156,
          keywordLanguageCode: "zh_CN",
          searchLanguageCode: "zh-CN",
        },
      ],
    });

    const results = await provider.collectBatch([
      {
        opportunity: opportunity("bilingual", "Bilingual Tool"),
        version: 1,
      },
    ]);
    const evidence = results.get("bilingual") ?? [];
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(firstInit.body))[0]).toMatchObject(
      { location_code: 2840, language_code: "en" },
    );
    expect(JSON.parse(String(secondInit.body))[0]).toMatchObject(
      { location_code: 2156, language_code: "zh_CN" },
    );
    expect(evidence).toHaveLength(6);
    expect(new Set(evidence.map((item) => item.market))).toEqual(
      new Set(["US/en", "CN/zh-CN"]),
    );
  });

  it("posts and polls a standard batch task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              id: "task-123",
              status_code: 20100,
              status_message: "Task Created.",
              result: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              id: "task-123",
              status_code: 20000,
              status_message: "Ok.",
              result: [searchResult("queued tool", 900)],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DataForSeoProvider("login", "password", {
      standardPollIntervalMs: 1,
      standardTimeoutMs: 100,
    });

    const results = await provider.collectBatch(
      [{ opportunity: opportunity("queued", "Queued Tool"), version: 1 }],
      "standard",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/search_volume\/task_post$/);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(
      /search_volume\/task_get\/task-123$/,
    );
    expect(results.get("queued")).toHaveLength(3);
  });

  it("collects Web SERP and Apple market evidence for a cross-platform idea", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              status_message: "Ok.",
              result: [searchResult("cross platform tool", 1500)],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              status_message: "Ok.",
              result: [
                {
                  se_results_count: 12000,
                  items: [
                    {
                      type: "organic",
                      domain: "first.example",
                      title: "First competitor",
                      url: "https://first.example",
                    },
                    {
                      type: "organic",
                      domain: "second.example",
                      title: "Second competitor",
                      url: "https://second.example",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              id: "apple-task",
              status_code: 20100,
              status_message: "Task Created.",
              result: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 20000,
          tasks: [
            {
              id: "apple-task",
              status_code: 20000,
              status_message: "Ok.",
              result: [
                {
                  items: [
                    {
                      app_id: "one",
                      title: "First App",
                      rating: { value: 4.2 },
                      reviews_count: 120,
                    },
                    {
                      app_id: "two",
                      title: "Second App",
                      rating: { value: 3.8 },
                      reviews_count: 80,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DataForSeoProvider("login", "password", {
      standardPollIntervalMs: 1,
      standardTimeoutMs: 100,
      collectWebCompetitors: true,
      collectAppleMarket: true,
      marketLocationCode: 2840,
      marketLanguageCode: "en",
      marketCountryCode: "US",
    });
    const candidate = {
      ...opportunity("cross-platform", "Cross Platform Tool"),
      recommendedPlatform: "WEB_AND_IOS" as const,
    };

    const results = await provider.collectBatch([
      { opportunity: candidate, version: 1 },
    ]);
    const evidence = results.get(candidate.id) ?? [];

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(
      /serp\/google\/organic\/live\/advanced$/,
    );
    expect(fetchMock.mock.calls[2]?.[0]).toMatch(
      /app_data\/apple\/app_searches\/task_post$/,
    );
    expect(fetchMock.mock.calls[3]?.[0]).toMatch(
      /app_data\/apple\/app_searches\/task_get\/advanced\/apple-task$/,
    );
    expect(
      evidence.find((item) => item.metric === "organic_competitor_domains")
        ?.value,
    ).toBe(2);
    expect(
      evidence.find((item) => item.metric === "app_store_competitors")?.value,
    ).toBe(2);
    expect(
      evidence.find((item) => item.metric === "competitor_average_rating")
        ?.value,
    ).toBe(4);
    expect(
      evidence.find((item) => item.metric === "competitor_review_volume")
        ?.value,
    ).toBe(200);
  });
});

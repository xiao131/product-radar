import { afterEach, describe, expect, it, vi } from "vitest";
import type { Opportunity } from "../shared/types.js";
import { DataForSeoProvider } from "./providers.js";

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
});

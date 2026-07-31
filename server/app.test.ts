import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configForManualOpportunityResearch, createApp } from "./app.js";
import { createDatabase, type RadarDatabase } from "./db.js";
import { createTestConfig } from "./test-config.js";
import { UsageBudgetExceededError } from "./usage.js";

const config = createTestConfig();

describe("Product Radar API", () => {
  let database: RadarDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    database = createDatabase(":memory:", true);
    app = createApp(database, config);
  });

  afterEach(() => {
    database.close();
  });

  it("returns a result-oriented dashboard", async () => {
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.mode).toBe("DEMO");
    expect(response.body.stats.opportunities).toBe(12);
    expect(response.body.topOpportunities[0].score).toBeGreaterThanOrEqual(80);
    expect(response.body.products).toHaveLength(3);
  });

  it("filters, sorts and paginates the radar database", async () => {
    const response = await request(app)
      .get("/api/opportunities")
      .query({
        page: 1,
        pageSize: 2,
        platform: "IOS",
        sortBy: "score",
        sortDirection: "desc",
      })
      .expect(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items.every((item: { recommendedPlatform: string }) => item.recommendedPlatform === "IOS")).toBe(true);
    expect(response.body.items[0].score).toBeGreaterThanOrEqual(response.body.items[1].score);
    expect(response.body.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("adds a product to the managed portfolio", async () => {
    await request(app)
      .post("/api/products")
      .send({
        name: "Local Lens",
        platform: "WEB_AND_IOS",
        status: "BUILDING",
        description: "A local-first research tool.",
        currentFocus: "Validate retention",
      })
      .expect(201);

    const response = await request(app).get("/api/products").expect(200);
    expect(response.body[0].name).toBe("Local Lens");
    expect(response.body).toHaveLength(4);
  });

  it("turns a raw signal into an opportunity and creates versioned research", async () => {
    const signalResponse = await request(app)
      .post("/api/signals")
      .send({
        sourceType: "REDDIT",
        title: "Calendar usable-time finder",
        content: "Show me the two-hour blocks I can actually use, not another meeting list.",
        tags: ["calendar", "complaint"],
      })
      .expect(201);

    const opportunityResponse = await request(app)
      .post(`/api/signals/${signalResponse.body.id}/process`)
      .expect(201);
    expect(opportunityResponse.body.researchStatus).toBe("UNRESEARCHED");

    const firstReport = await request(app)
      .post(`/api/opportunities/${opportunityResponse.body.id}/research`)
      .expect(201);
    expect(firstReport.body.version).toBe(1);
    expect(firstReport.body.cached).toBe(false);
    expect(firstReport.body.dimensionScores).toHaveLength(9);
    expect(firstReport.body.evidenceIds).toHaveLength(5);

    const cachedReport = await request(app)
      .post(`/api/opportunities/${opportunityResponse.body.id}/research`)
      .expect(200);
    expect(cachedReport.body.id).toBe(firstReport.body.id);
    expect(cachedReport.body.version).toBe(1);
    expect(cachedReport.body.cached).toBe(true);

    const secondReport = await request(app)
      .post(`/api/opportunities/${opportunityResponse.body.id}/research`)
      .send({ force: true })
      .expect(201);
    expect(secondReport.body.version).toBe(2);

    const detail = await request(app)
      .get(`/api/opportunities/${opportunityResponse.body.id}`)
      .expect(200);
    expect(detail.body.reports).toHaveLength(2);
    expect(detail.body.evidence).toHaveLength(9);
    expect(detail.body.opportunity.researchStatus).toBe("READY");
  });

  it("batch-researches only due opportunities in one workflow", async () => {
    const signalResponse = await request(app)
      .post("/api/signals")
      .send({
        sourceType: "IDEA",
        title: "Batch research candidate",
        content: "A newly created candidate should be due for research.",
        tags: ["batch"],
      })
      .expect(201);
    const opportunityResponse = await request(app)
      .post(`/api/signals/${signalResponse.body.id}/process`)
      .expect(201);

    const batch = await request(app)
      .post("/api/research/batch")
      .send({ delivery: "standard" })
      .expect(200);
    expect(batch.body.requested).toBe(1);
    expect(batch.body.researched).toBe(1);
    expect(batch.body.unchanged).toBe(0);
    expect(batch.body.failed).toBe(0);
    expect(batch.body.delivery).toBe("standard");

    const detail = await request(app)
      .get(`/api/opportunities/${opportunityResponse.body.id}`)
      .expect(200);
    expect(detail.body.opportunity.researchStatus).toBe("READY");
    expect(detail.body.reports).toHaveLength(1);
  });

  it("asks for one-time confirmation before manually exceeding the task budget", async () => {
    const realConfig = createTestConfig({
      researchProvider: "real",
      openAiApiKey: "test-key",
      dataForSeoLogin: "test-login",
      dataForSeoPassword: "test-password",
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
    app = createApp(database, realConfig);
    const signal = await request(app)
      .post("/api/signals")
      .send({
        sourceType: "IDEA",
        title: "Manual budget decision",
        content: "A Web workflow that needs market research.",
      })
      .expect(201);
    const candidate = await request(app)
      .post(`/api/signals/${signal.body.id}/process`)
      .expect(201);
    database
      .prepare(
        `INSERT INTO usage_events (
           id, provider, operation, units, cost_usd, metadata_json, created_at
         ) VALUES (?, 'DATAFORSEO', 'previous', 100, 0.3, '{}', ?)`,
      )
      .run(crypto.randomUUID(), new Date().toISOString());

    const confirmation = await request(app)
      .post(`/api/opportunities/${candidate.body.id}/research`)
      .send({ force: false })
      .expect(409);
    expect(confirmation.body).toMatchObject({
      code: "DATAFORSEO_TASK_BUDGET_CONFIRMATION_REQUIRED",
      details: {
        usedTasks: 100,
        taskLimit: 100,
        estimatedAdditionalTasks: 4,
        projectedTasks: 104,
        currentCostUsd: 0.3,
        estimatedAdditionalCostUsd: 0.07332,
        projectedCostUsd: 0.37332,
        dailyCostLimitUsd: 0.5,
      },
    });
    expect(
      database
        .prepare("SELECT research_status FROM opportunities WHERE id = ?")
        .get(candidate.body.id),
    ).toEqual({ research_status: "UNRESEARCHED" });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM usage_events")
        .get(),
    ).toEqual({ count: 1 });

    const overrideConfig = configForManualOpportunityResearch(
      database,
      realConfig,
      candidate.body.id,
      false,
      true,
    );
    expect(overrideConfig.maxDataForSeoTasksPerDay).toBe(104);
    expect(overrideConfig.maxDataForSeoCostPerDayUsd).toBe(0.5);

    database.prepare("UPDATE usage_events SET cost_usd = 0.44").run();
    expect(() =>
      configForManualOpportunityResearch(
        database,
        realConfig,
        candidate.body.id,
        false,
        true,
      ),
    ).toThrow(UsageBudgetExceededError);
  });

  it("rejects overlapping research for the same opportunity", async () => {
    const opportunity = (
      await request(app).get("/api/opportunities").expect(200)
    ).body.items[0];
    database
      .prepare(
        "UPDATE opportunities SET research_status = 'RUNNING', updated_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), opportunity.id);

    await request(app)
      .post(`/api/opportunities/${opportunity.id}/research`)
      .send({ force: true })
      .expect(409);
  });

  it("rate-limits research endpoints per client", async () => {
    app = createApp(database, {
      ...config,
      researchRateLimitPerHour: 1,
    });
    await request(app)
      .post("/api/opportunities/missing/research")
      .expect(404);
    await request(app)
      .post("/api/opportunities/missing/research")
      .expect(429);
  });

  it("imports CSV signals and validates required columns", async () => {
    await request(app)
      .post("/api/signals/import")
      .send({
        csv: [
          "title,content,source_type,tags",
          '"Export is painful","I need one-click clean exports",APP_REVIEW,"export;workflow"',
          '"Privacy issue","Location metadata keeps leaking",REDDIT,"privacy;photo"',
        ].join("\n"),
      })
      .expect(201)
      .expect({ imported: 2 });

    const signals = await request(app).get("/api/signals").expect(200);
    expect(signals.body).toHaveLength(5);

    await request(app)
      .post("/api/signals/import")
      .send({ csv: "title,source_type\nMissing content,IDEA" })
      .expect(400);
  });

  it("paginates the growing automatic signal library", async () => {
    const response = await request(app)
      .get("/api/signals")
      .query({ page: 1, pageSize: 2 })
      .expect(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it("reports automatic discovery and dollar-budget operations state", async () => {
    const response = await request(app)
      .get("/api/operations/status")
      .expect(200);
    expect(response.body.scheduler).toMatchObject({
      discoveryEnabled: false,
      discoveryHour: 3,
    });
    expect(response.body.usage.dataForSeo).toMatchObject({
      billedRequests: 0,
      dailyCostLimitUsd: 0.5,
      monthlyCostLimitUsd: 10,
    });
    expect(response.body.discovery).toMatchObject({
      latestAt: null,
      latestStatus: null,
      collectedSignals: 0,
      createdCandidates: 0,
      refreshedCandidates: 0,
    });
  });

  it("links a raw signal to an existing opportunity as complaint evidence", async () => {
    const opportunity = (
      await request(app).get("/api/opportunities").expect(200)
    ).body.items[0];
    const signal = await request(app)
      .post("/api/signals")
      .send({
        sourceType: "APP_REVIEW",
        title: "Export flow complaint",
        content: "The export loses all useful formatting and takes six manual steps.",
        sourceUrl: "https://example.com/review/1",
        tags: ["export"],
      })
      .expect(201);

    await request(app)
      .post(`/api/signals/${signal.body.id}/link`)
      .send({ opportunityId: opportunity.id })
      .expect(200);

    const detail = await request(app)
      .get(`/api/opportunities/${opportunity.id}`)
      .expect(200);
    expect(detail.body.opportunity.researchStatus).toBe("UNRESEARCHED");
    expect(
      detail.body.evidence.some(
        (item: { metric: string; rawExcerpt: string }) =>
          item.metric === "qualified_complaint" &&
          item.rawExcerpt.includes("six manual steps"),
      ),
    ).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { NoObjectGeneratedError } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createDatabase, type RadarDatabase } from "./db.js";
import {
  classifyJobResult,
  JobAlreadyRunningError,
  startBackupJob,
} from "./jobs.js";
import { latestSchemaVersion } from "./migrations.js";
import { mapOpportunity } from "./mappers.js";
import {
  applyEvidenceSufficiencyGuard,
  calculateWeightedScore,
  normalizeResearchDimensions,
  researchDueOpportunities,
  reusableFailedResearchEvidence,
  retryInvalidStructuredOutput,
} from "./research.js";
import { hashPassword } from "./security.js";
import { createTestConfig } from "./test-config.js";
import { UsageBudgetExceededError, UsageLedger } from "./usage.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("production security", () => {
  it("protects data and mutations with login and CSRF", async () => {
    const password = "correct-horse-battery-staple";
    const config = createTestConfig({
      authRequired: true,
      adminPasswordHash: await hashPassword(password),
      sessionSecret: "s".repeat(48),
      publicOrigin: "http://radar.test",
    });
    const database = createDatabase(":memory:", true);
    const app = createApp(database, config);
    const agent = request.agent(app);

    await agent.get("/api/dashboard").expect(401);
    await agent
      .post("/api/auth/login")
      .send({ password: "wrong-password" })
      .expect(401);
    const login = await agent
      .post("/api/auth/login")
      .send({ password })
      .expect(200);
    expect(login.body.csrfToken).toBeTruthy();
    const setCookie = login.headers["set-cookie"];
    expect(
      Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie),
    ).toContain("HttpOnly");

    await agent
      .post("/api/signals")
      .send({ title: "Blocked mutation", content: "Missing CSRF token" })
      .expect(403);
    await agent
      .post("/api/signals")
      .set("Origin", config.publicOrigin)
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({
        sourceType: "IDEA",
        title: "Protected mutation",
        content: "This request carries a valid signed session and CSRF token.",
        tags: [],
      })
      .expect(201);

    const settings = await agent.get("/api/settings").expect(200);
    expect(settings.body.databasePath).toBeUndefined();
    expect(settings.headers["content-security-policy"]).toBeTruthy();
    database.close();
  });
});

describe("production persistence", () => {
  it("migrates without demo data and creates a verified backup", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "product-radar-production-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "radar.db");
    const backupDirectory = path.join(directory, "backups");
    const database = createDatabase(databasePath, {
      seedDemoData: false,
      busyTimeoutMs: 100,
    });
    const migration = database
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version: number };
    const products = database
      .prepare("SELECT COUNT(*) AS count FROM products")
      .get() as { count: number };
    expect(migration.version).toBe(latestSchemaVersion());
    expect(products.count).toBe(0);

    const config = createTestConfig({
      databasePath,
      backupDirectory,
      backupRetentionCount: 2,
    });
    const started = startBackupJob(
      database,
      config,
      "manual",
    );
    expect(() => startBackupJob(database, config, "manual")).toThrow(
      JobAlreadyRunningError,
    );
    const completed = await started.completion;
    expect(completed.result.integrity).toBe("ok");
    expect(fs.existsSync(completed.result.path)).toBe(true);
    database.close();
  });
});

describe("production decision and budgets", () => {
  it("retries a structured AI stage once after an invalid object", async () => {
    const invalidObject = new NoObjectGeneratedError({
      message: "could not parse the response",
      cause: new Error("invalid JSON"),
      text: "not-json",
      response: undefined as never,
      usage: undefined as never,
      finishReason: undefined as never,
    });
    let attempts = 0;
    const result = await retryInvalidStructuredOutput(async (isRetry) => {
      attempts += 1;
      if (!isRetry) throw invalidObject;
      return "repaired";
    });
    expect(result).toBe("repaired");
    expect(attempts).toBe(2);
  });

  it("reports partial and fully failed research jobs accurately", () => {
    expect(
      classifyJobResult("RESEARCH", {
        requested: 5,
        failed: 2,
        failures: [{ message: "could not parse the response" }],
      }),
    ).toMatchObject({ status: "PARTIAL" });
    expect(
      classifyJobResult("RESEARCH", {
        requested: 5,
        failed: 5,
        failures: [{ message: "Billing service temporarily unavailable" }],
      }),
    ).toMatchObject({
      status: "FAILED",
      error: expect.stringContaining("5/5"),
    });
  });

  it("limits a targeted research run to the selected opportunity", async () => {
    const database = createDatabase(":memory:", true);
    const opportunities = database
      .prepare("SELECT id FROM opportunities ORDER BY created_at LIMIT 2")
      .all() as Array<{ id: string }>;
    database
      .prepare(
        "UPDATE opportunities SET research_status = 'FAILED' WHERE id IN (?, ?)",
      )
      .run(opportunities[0]?.id, opportunities[1]?.id);

    const result = await researchDueOpportunities(
      database,
      createTestConfig(),
      "standard",
      { targetOpportunityIds: [opportunities[0]!.id] },
    );

    expect(result).toMatchObject({ requested: 1, researched: 1, failed: 0 });
    expect(
      database
        .prepare("SELECT research_status FROM opportunities WHERE id = ?")
        .get(opportunities[0]!.id),
    ).toEqual({ research_status: "READY" });
    expect(
      database
        .prepare("SELECT research_status FROM opportunities WHERE id = ?")
        .get(opportunities[1]!.id),
    ).toEqual({ research_status: "FAILED" });
    database.close();
  });

  it("reuses fresh persisted evidence after an AI research failure", () => {
    const database = createDatabase(":memory:", true);
    const row = database
      .prepare("SELECT * FROM opportunities ORDER BY created_at LIMIT 1")
      .get() as Record<string, unknown>;
    const collectedAt = new Date().toISOString();
    database
      .prepare(
        "UPDATE opportunities SET research_status = 'FAILED' WHERE id = ?",
      )
      .run(row.id);
    database
      .prepare("UPDATE evidence_items SET collected_at = ? WHERE opportunity_id = ?")
      .run(collectedAt, row.id);

    const failedOpportunity = mapOpportunity({
      ...row,
      research_status: "FAILED",
    });
    const evidence = reusableFailedResearchEvidence(
      database,
      failedOpportunity,
      7,
    );

    expect(evidence).toHaveLength(3);
    expect(
      reusableFailedResearchEvidence(
        database,
        { ...failedOpportunity, researchStatus: "READY" },
        7,
      ),
    ).toBeNull();
    database.close();
  });

  it("normalizes fixed dimensions and computes the weighted score", () => {
    const dimensions = normalizeResearchDimensions([
      { key: "freshness", score: 90, explanation: "fresh" },
      { key: "founderFit", score: 80, explanation: "fit" },
      { key: "buildability", score: 70, explanation: "build" },
      { key: "reachability", score: 60, explanation: "reach" },
      { key: "competitionGap", score: 50, explanation: "competition" },
      { key: "willingness", score: 40, explanation: "pay" },
      { key: "trend", score: 30, explanation: "trend" },
      { key: "pain", score: 20, explanation: "pain" },
      { key: "demand", score: 10, explanation: "demand" },
    ]);
    expect(dimensions.map((item) => item.key)).toEqual([
      "demand",
      "pain",
      "trend",
      "willingness",
      "competitionGap",
      "reachability",
      "buildability",
      "founderFit",
      "freshness",
    ]);
    expect(calculateWeightedScore(dimensions)).toBe(43);
  });

  it("enforces durable daily provider budgets", () => {
    const database: RadarDatabase = createDatabase(":memory:", false);
    const config = createTestConfig({ maxAiRunsPerDay: 1 });
    const ledger = new UsageLedger(database, config);
    ledger.reserve("AI", "first");
    expect(() => ledger.reserve("AI", "second")).toThrow(
      UsageBudgetExceededError,
    );
    expect(ledger.today().ai.used).toBe(1);
    database.close();
  });

  it("enforces daily and monthly DataForSEO dollar caps", () => {
    const database: RadarDatabase = createDatabase(":memory:", false);
    const config = createTestConfig({
      maxDataForSeoTasksPerDay: 100,
      maxDataForSeoCostPerDayUsd: 0.5,
      maxDataForSeoCostPerMonthUsd: 0.75,
    });
    const ledger = new UsageLedger(database, config);
    const reservation = ledger.reserve(
      "DATAFORSEO",
      "first",
      1,
      {},
      0.4,
    );
    ledger.settle(reservation, "first_settled", 0, 0, 0.35);
    expect(() =>
      ledger.reserve("DATAFORSEO", "daily-over", 1, {}, 0.2),
    ).toThrow(UsageBudgetExceededError);
    const monthlyLedger = new UsageLedger(database, {
      ...config,
      maxDataForSeoCostPerDayUsd: 1,
      maxDataForSeoCostPerMonthUsd: 0.5,
    });
    expect(() =>
      monthlyLedger.reserve("DATAFORSEO", "monthly-over", 1, {}, 0.2),
    ).toThrow(UsageBudgetExceededError);
    database.close();
  });

  it("stops a second automatic discovery batch before transmission", () => {
    const database: RadarDatabase = createDatabase(":memory:", false);
    const config = createTestConfig({
      maxDataForSeoCostPerDayUsd: 1,
      maxDataForSeoDiscoveryCostPerDayUsd: 0.05,
    });
    const ledger = new UsageLedger(database, config);
    ledger.reserve(
      "DATAFORSEO",
      "discovery_first_batch",
      1,
      {},
      0.036,
    );
    expect(() =>
      ledger.reserve(
        "DATAFORSEO",
        "discovery_second_batch",
        1,
        {},
        0.02,
      ),
    ).toThrow(UsageBudgetExceededError);
    expect(ledger.today().dataForSeo).toMatchObject({
      billedRequests: 1,
      discoveryCostUsd: 0.036,
      discoveryCostLimitUsd: 0.05,
    });
    database.close();
  });

  it("downgrades a build-now verdict when evidence coverage is weak", () => {
    const guarded = applyEvidenceSufficiencyGuard(
      "BUILD_NOW",
      {
        categories: ["SEARCH", "TREND"],
        sourceCount: 1,
      },
      1,
    );
    expect(guarded.verdict).toBe("VALIDATE_FIRST");
    expect(guarded.reasons).toContain("缺少用户痛点或抱怨证据");
    expect(guarded.reasons).toContain("缺少 Web 或 App Store 竞争证据");
  });
});

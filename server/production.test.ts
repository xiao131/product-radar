import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
import {
  latestSchemaVersion,
  migrateDatabase,
  repairHistoricalJobOutcomes,
} from "./migrations.js";
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
      .send({ username: "xx131", password: "wrong-password" })
      .expect(401);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "xx131", password })
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

  it("updates the administrator credentials and invalidates older sessions", async () => {
    const password = "correct-horse-battery-staple";
    const newPassword = "new-pass";
    const config = createTestConfig({
      authRequired: true,
      adminUsername: "xx131",
      adminPasswordHash: await hashPassword(password),
      sessionSecret: "s".repeat(48),
      publicOrigin: "http://radar.test",
    });
    const database = createDatabase(":memory:", true);
    const app = createApp(database, config);
    const currentAgent = request.agent(app);
    const olderAgent = request.agent(app);

    const currentLogin = await currentAgent
      .post("/api/auth/login")
      .send({ username: "xx131", password })
      .expect(200);
    await olderAgent
      .post("/api/auth/login")
      .send({ username: "xx131", password })
      .expect(200);

    const before = await currentAgent.get("/api/auth/account").expect(200);
    expect(before.body).toMatchObject({ configured: true, username: "xx131" });

    await currentAgent
      .patch("/api/auth/account")
      .set("Origin", config.publicOrigin)
      .set("X-CSRF-Token", currentLogin.body.csrfToken)
      .send({
        username: "radar.owner",
        currentPassword: password,
        newPassword: "1234567",
      })
      .expect(400);

    const updated = await currentAgent
      .patch("/api/auth/account")
      .set("Origin", config.publicOrigin)
      .set("X-CSRF-Token", currentLogin.body.csrfToken)
      .send({
        username: "radar.owner",
        currentPassword: password,
        newPassword,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      configured: true,
      username: "radar.owner",
    });

    await currentAgent.get("/api/dashboard").expect(200);
    await olderAgent.get("/api/dashboard").expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ username: "xx131", password })
      .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ username: "radar.owner", password: newPassword })
      .expect(200);
    database.close();
  });

  it("rejects administrator passwords shorter than eight characters", async () => {
    await expect(hashPassword("1234567")).rejects.toThrow(
      "生产管理员密码至少需要 8 个字符",
    );
  });
});

describe("production persistence", () => {
  it("reclassifies legacy ideas and the six confirmed mistaken products during migration", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    migrateDatabase(database, 12);
    const createdAt = new Date().toISOString();
    const insert = database.prepare(`
      INSERT INTO products (
        id, name, platform, status, url, description, current_focus,
        source_opportunity_id, created_at, updated_at
      ) VALUES (?, ?, 'WEB', ?, NULL, ?, '', NULL, ?, ?)
    `);
    insert.run(crypto.randomUUID(), "Historical TODO", "IDEA", "An undeveloped idea", createdAt, createdAt);
    insert.run(crypto.randomUUID(), "ScreenNote", "LIVE", "This was never developed", createdAt, createdAt);
    insert.run(crypto.randomUUID(), "专注与应用时长控制", "ARCHIVED", "A rejected candidate", createdAt, createdAt);
    insert.run(crypto.randomUUID(), "Real Product", "LIVE", "A confirmed live product", createdAt, createdAt);

    migrateDatabase(database);

    const products = database.prepare("SELECT name FROM products ORDER BY name").all() as Array<{ name: string }>;
    expect(products).toEqual([{ name: "Real Product" }]);
    const signals = database.prepare(
      "SELECT title, status, metrics_json FROM signals WHERE source_name = '产品历史纠错' ORDER BY title",
    ).all() as Array<{ title: string; status: string; metrics_json: string }>;
    expect(signals.map((signal) => signal.title)).toEqual(["Historical TODO", "ScreenNote", "专注与应用时长控制"]);
    expect(signals.every((signal) => signal.status === "NEW")).toBe(true);
    expect(signals.every((signal) => JSON.parse(signal.metrics_json)._reclassifiedFromProduct === true)).toBe(true);
    database.close();
  });

  it("renames the legacy default administrator account", () => {
    const database = createDatabase(":memory:", {
      seedDemoData: false,
    });
    const createdAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO admin_account (
           id, username, password_hash, session_version, created_at, updated_at
         ) VALUES (1, 'admin', 'test-hash', 1, ?, ?)`,
      )
      .run(createdAt, createdAt);
    database.prepare("DELETE FROM schema_migrations WHERE version = 10").run();

    migrateDatabase(database);

    const account = database
      .prepare("SELECT username, session_version FROM admin_account WHERE id = 1")
      .get() as { username: string; session_version: number };
    expect(account).toEqual({ username: "xx131", session_version: 2 });
    database.close();
  });

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
    const opportunityColumns = database
      .prepare("PRAGMA table_info(opportunities)")
      .all() as Array<{ name: string; dflt_value: string | null }>;
    const productIndexes = database
      .prepare("PRAGMA index_list(products)")
      .all() as Array<{ name: string; unique: number }>;
    const adminColumns = database
      .prepare("PRAGMA table_info(admin_account)")
      .all() as Array<{ name: string }>;
    expect(migration.version).toBe(latestSchemaVersion());
    expect(products.count).toBe(0);
    expect(opportunityColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "workflow_status",
          dflt_value: "'UNDECIDED'",
        }),
        expect.objectContaining({ name: "workflow_updated_at" }),
        expect.objectContaining({ name: "original_language", dflt_value: "'und'" }),
        expect.objectContaining({ name: "target_markets_json", dflt_value: "'[]'" }),
        expect.objectContaining({ name: "localized_content_json", dflt_value: "'{}'" }),
        expect.objectContaining({ name: "market_assessments_json", dflt_value: "'[]'" }),
      ]),
    );
    expect(productIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "idx_product_source_opportunity",
          unique: 1,
        }),
      ]),
    );
    expect(adminColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "username" }),
        expect.objectContaining({ name: "password_hash" }),
        expect.objectContaining({ name: "session_version" }),
      ]),
    );

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

  it("repairs historical research jobs that were marked complete despite total failure", () => {
    const database = createDatabase(":memory:", false);
    const jobId = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO job_runs (
           id, job_type, trigger_type, status, provider_mode,
           result_json, started_at, finished_at
         ) VALUES (?, 'RESEARCH', 'manual', 'COMPLETED', 'REAL', ?, ?, ?)`,
      )
      .run(
        jobId,
        JSON.stringify({ requested: 5, researched: 0, failed: 5 }),
        new Date().toISOString(),
        new Date().toISOString(),
      );

    repairHistoricalJobOutcomes(database);

    expect(
      database
        .prepare("SELECT status, error FROM job_runs WHERE id = ?")
        .get(jobId),
    ).toEqual({
      status: "FAILED",
      error: "5/5 个候选调研失败（历史任务状态已修正）",
    });
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

  it("allows a second structured-output repair before failing the stage", async () => {
    const invalidObject = new NoObjectGeneratedError({
      message: "could not validate the response",
      cause: new Error("missing field"),
      text: "{}",
      response: undefined as never,
      usage: undefined as never,
      finishReason: undefined as never,
    });
    let attempts = 0;

    const result = await retryInvalidStructuredOutput(async () => {
      attempts += 1;
      if (attempts < 3) throw invalidObject;
      return "repaired-on-third-attempt";
    });

    expect(result).toBe("repaired-on-third-attempt");
    expect(attempts).toBe(3);
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

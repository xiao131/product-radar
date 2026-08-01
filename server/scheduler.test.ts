import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  hasCompletedJobToday,
  hasScheduledAttemptToday,
  recordScheduledSkip,
  runSchedulerCycle,
  scheduledJobDecision,
} from "./scheduler.js";
import { createTestConfig } from "./test-config.js";

function insertJob(
  database: ReturnType<typeof createDatabase>,
  input: {
    jobType: "DISCOVERY" | "RESEARCH" | "BACKUP";
    trigger: "manual" | "scheduled" | "cli";
    status: "COMPLETED" | "FAILED";
  },
) {
  database
    .prepare(
      `INSERT INTO job_runs (
         id, job_type, trigger_type, status, provider_mode,
         result_json, error, started_at, finished_at
       ) VALUES (?, ?, ?, ?, 'REAL', '{}', ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.jobType,
      input.trigger,
      input.status,
      input.status === "FAILED" ? "provider timeout" : null,
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

describe("cost-safe automatic scheduling", () => {
  it("still schedules after a failed manual or CLI task", () => {
    const database = createDatabase(":memory:", false);
    insertJob(database, {
      jobType: "DISCOVERY",
      trigger: "cli",
      status: "FAILED",
    });

    expect(hasCompletedJobToday(database, "DISCOVERY")).toBe(false);
    expect(hasScheduledAttemptToday(database, "DISCOVERY")).toBe(false);
    expect(scheduledJobDecision(database, "DISCOVERY")).toEqual({
      action: "RUN",
    });
    database.close();
  });

  it("records one visible skip after a successful manual task", () => {
    const database = createDatabase(":memory:", false);
    insertJob(database, {
      jobType: "RESEARCH",
      trigger: "manual",
      status: "COMPLETED",
    });

    const decision = scheduledJobDecision(database, "RESEARCH");
    expect(decision.action).toBe("SATISFIED");
    if (decision.action !== "SATISFIED") throw new Error("unexpected decision");
    expect(
      recordScheduledSkip(
        database,
        createTestConfig(),
        "RESEARCH",
        decision.completed,
      ),
    ).toBe(true);
    expect(
      recordScheduledSkip(
        database,
        createTestConfig(),
        "RESEARCH",
        decision.completed,
      ),
    ).toBe(false);
    expect(
      database
        .prepare(
          `SELECT status, error FROM job_runs
           WHERE job_type = 'RESEARCH' AND status = 'SKIPPED'`,
        )
        .get(),
    ).toEqual({
      status: "SKIPPED",
      error: "今天已手动完成多维调研，本次定时执行已跳过。",
    });
    expect(hasScheduledAttemptToday(database, "RESEARCH")).toBe(false);
    database.close();
  });

  it("does not retry a failed scheduled paid task on the same day", () => {
    const database = createDatabase(":memory:", false);
    insertJob(database, {
      jobType: "RESEARCH",
      trigger: "scheduled",
      status: "FAILED",
    });

    expect(hasScheduledAttemptToday(database, "RESEARCH")).toBe(true);
    expect(scheduledJobDecision(database, "RESEARCH")).toEqual({
      action: "ALREADY_ATTEMPTED",
    });
    database.close();
  });

  it("continues later scheduled tasks when an earlier task fails", async () => {
    const database = createDatabase(":memory:", false);
    const calls: string[] = [];

    await runSchedulerCycle(
      database,
      createTestConfig({
        autoDiscoveryEnabled: true,
        schedulerBackupHour: 0,
        schedulerDiscoveryHour: 0,
        schedulerResearchHour: 0,
      }),
      1,
      {
        backup: async () => {
          calls.push("backup");
        },
        discovery: async () => {
          calls.push("discovery");
          throw new Error("discovery provider unavailable");
        },
        research: async () => {
          calls.push("research");
        },
      },
    );

    expect(calls).toEqual(["backup", "discovery", "research"]);
    database.close();
  });
});

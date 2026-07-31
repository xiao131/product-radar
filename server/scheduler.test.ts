import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  hasAttemptedJobToday,
  hasCompletedJobToday,
} from "./scheduler.js";

describe("automatic discovery scheduling", () => {
  it("does not schedule another discovery after a failed attempt today", () => {
    const database = createDatabase(":memory:", false);
    database
      .prepare(
        `INSERT INTO job_runs (
           id, job_type, trigger_type, status, provider_mode,
           result_json, error, started_at, finished_at
         ) VALUES (?, 'DISCOVERY', 'scheduled', 'FAILED', 'REAL', '{}', ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        "AI provider timeout",
        new Date().toISOString(),
        new Date().toISOString(),
      );

    expect(hasAttemptedJobToday(database, "DISCOVERY")).toBe(true);
    expect(hasCompletedJobToday(database, "DISCOVERY")).toBe(false);
    database.close();
  });
});

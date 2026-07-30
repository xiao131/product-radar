import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { JobAlreadyRunningError, runBackupJob, runResearchJob } from "./jobs.js";
import { logEvent } from "./logger.js";

function localDayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function completedToday(db: RadarDatabase, jobType: "RESEARCH" | "BACKUP") {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM job_runs
         WHERE job_type = ?
           AND status = 'COMPLETED'
           AND started_at >= ?
         LIMIT 1`,
      )
      .get(jobType, localDayStart()),
  );
}

export function startScheduler(db: RadarDatabase, config: AppConfig) {
  if (!config.schedulerEnabled) return { stop() {} };
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const hour = new Date().getHours();
      if (
        hour >= config.schedulerBackupHour &&
        !completedToday(db, "BACKUP")
      ) {
        await runBackupJob(db, config, "scheduled");
      }
      if (
        hour >= config.schedulerResearchHour &&
        !completedToday(db, "RESEARCH")
      ) {
        await runResearchJob(db, config, "scheduled", "standard");
      }
    } catch (error) {
      if (!(error instanceof JobAlreadyRunningError)) {
        logEvent("error", "scheduler_tick_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), config.schedulerPollIntervalMs);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
  logEvent("info", "scheduler_started", {
    pollIntervalMs: config.schedulerPollIntervalMs,
    researchHour: config.schedulerResearchHour,
    backupHour: config.schedulerBackupHour,
  });
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

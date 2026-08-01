import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import {
  JobAlreadyRunningError,
  runBackupJob,
  runDiscoveryJob,
  runResearchJob,
} from "./jobs.js";
import { logEvent } from "./logger.js";

export type ScheduledJobType = "DISCOVERY" | "RESEARCH" | "BACKUP";

interface CompletedJobToday {
  id: string;
  triggerType: "manual" | "scheduled" | "cli";
  startedAt: string;
}

interface SchedulerRuntimeState {
  startedAt: string;
  lastTickAt: string | null;
  nextTickAt: string | null;
  running: boolean;
}

const schedulerStates = new WeakMap<RadarDatabase, SchedulerRuntimeState>();

function localDayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function hasCompletedJobToday(
  db: RadarDatabase,
  jobType: ScheduledJobType,
) {
  return Boolean(completedJobToday(db, jobType));
}

export function completedJobToday(
  db: RadarDatabase,
  jobType: ScheduledJobType,
): CompletedJobToday | null {
  const row = db
    .prepare(
      `SELECT id, trigger_type, started_at
       FROM job_runs
       WHERE job_type = ?
         AND status = 'COMPLETED'
         AND started_at >= ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(jobType, localDayStart()) as
    | {
        id: string;
        trigger_type: CompletedJobToday["triggerType"];
        started_at: string;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        triggerType: row.trigger_type,
        startedAt: row.started_at,
      }
    : null;
}

export function hasScheduledAttemptToday(
  db: RadarDatabase,
  jobType: ScheduledJobType,
) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM job_runs
         WHERE job_type = ?
           AND trigger_type = 'scheduled'
           AND status != 'SKIPPED'
           AND started_at >= ?
         LIMIT 1`,
      )
      .get(jobType, localDayStart()),
  );
}

function hasScheduledSkipToday(db: RadarDatabase, jobType: ScheduledJobType) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM job_runs
         WHERE job_type = ?
           AND trigger_type = 'scheduled'
           AND status = 'SKIPPED'
           AND started_at >= ?
         LIMIT 1`,
      )
      .get(jobType, localDayStart()),
  );
}

export type ScheduledJobDecision =
  | { action: "RUN" }
  | { action: "ALREADY_ATTEMPTED" }
  | { action: "SATISFIED"; completed: CompletedJobToday };

export function scheduledJobDecision(
  db: RadarDatabase,
  jobType: ScheduledJobType,
): ScheduledJobDecision {
  const completed = completedJobToday(db, jobType);
  if (completed) return { action: "SATISFIED", completed };
  if (hasScheduledAttemptToday(db, jobType)) {
    return { action: "ALREADY_ATTEMPTED" };
  }
  return { action: "RUN" };
}

const scheduledJobLabels: Record<ScheduledJobType, string> = {
  BACKUP: "数据备份",
  DISCOVERY: "自动发现",
  RESEARCH: "多维调研",
};

const triggerLabels: Record<CompletedJobToday["triggerType"], string> = {
  manual: "手动",
  cli: "命令行",
  scheduled: "定时",
};

export function recordScheduledSkip(
  db: RadarDatabase,
  config: AppConfig,
  jobType: ScheduledJobType,
  completed: CompletedJobToday,
) {
  if (
    completed.triggerType === "scheduled" ||
    hasScheduledSkipToday(db, jobType)
  ) {
    return false;
  }
  const recordedAt = new Date().toISOString();
  const reason = `今天已${triggerLabels[completed.triggerType]}完成${scheduledJobLabels[jobType]}，本次定时执行已跳过。`;
  db.prepare(
    `INSERT INTO job_runs (
       id, job_type, trigger_type, status, provider_mode,
       result_json, error, started_at, finished_at
     ) VALUES (?, ?, 'scheduled', 'SKIPPED', ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    jobType,
    jobType === "BACKUP" ? null : config.researchProvider.toUpperCase(),
    JSON.stringify({
      reasonCode: "completed_today",
      completedJobId: completed.id,
      completedTrigger: completed.triggerType,
    }),
    reason,
    recordedAt,
    recordedAt,
  );
  logEvent("info", "scheduler_job_skipped", { jobType, reason });
  return true;
}

function nextScheduledRunAt(
  db: RadarDatabase,
  jobType: ScheduledJobType,
  hour: number,
  enabled: boolean,
  runtime: SchedulerRuntimeState | undefined,
) {
  if (!enabled) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const settled =
    hasCompletedJobToday(db, jobType) ||
    hasScheduledAttemptToday(db, jobType);
  if (settled) {
    target.setDate(target.getDate() + 1);
  } else if (now.getTime() >= target.getTime()) {
    return runtime?.nextTickAt ?? now.toISOString();
  }
  return target.toISOString();
}

export function schedulerRuntimeStatus(
  db: RadarDatabase,
  config: AppConfig,
) {
  const runtime = schedulerStates.get(db);
  return {
    running: runtime?.running ?? false,
    startedAt: runtime?.startedAt ?? null,
    lastTickAt: runtime?.lastTickAt ?? null,
    nextTickAt: runtime?.nextTickAt ?? null,
    nextRuns: {
      backup: nextScheduledRunAt(
        db,
        "BACKUP",
        config.schedulerBackupHour,
        config.schedulerEnabled,
        runtime,
      ),
      discovery: nextScheduledRunAt(
        db,
        "DISCOVERY",
        config.schedulerDiscoveryHour,
        config.schedulerEnabled && config.autoDiscoveryEnabled,
        runtime,
      ),
      research: nextScheduledRunAt(
        db,
        "RESEARCH",
        config.schedulerResearchHour,
        config.schedulerEnabled,
        runtime,
      ),
    },
  };
}

export function startScheduler(db: RadarDatabase, config: AppConfig) {
  if (!config.schedulerEnabled) return { stop() {} };
  let stopped = false;
  let running = false;
  const runtime: SchedulerRuntimeState = {
    startedAt: new Date().toISOString(),
    lastTickAt: null,
    nextTickAt: new Date(Date.now() + 5_000).toISOString(),
    running: false,
  };
  schedulerStates.set(db, runtime);

  async function runScheduled(
    jobType: ScheduledJobType,
    run: () => Promise<unknown>,
  ) {
    const decision = scheduledJobDecision(db, jobType);
    if (decision.action === "RUN") {
      await run();
      return;
    }
    if (decision.action === "SATISFIED") {
      recordScheduledSkip(db, config, jobType, decision.completed);
    }
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    runtime.running = true;
    try {
      const hour = new Date().getHours();
      if (hour >= config.schedulerBackupHour) {
        await runScheduled("BACKUP", () =>
          runBackupJob(db, config, "scheduled"),
        );
      }
      if (config.autoDiscoveryEnabled && hour >= config.schedulerDiscoveryHour) {
        await runScheduled("DISCOVERY", () =>
          runDiscoveryJob(db, config, "scheduled"),
        );
      }
      if (hour >= config.schedulerResearchHour) {
        await runScheduled("RESEARCH", () =>
          runResearchJob(db, config, "scheduled", "standard"),
        );
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
      runtime.running = false;
      runtime.lastTickAt = new Date().toISOString();
      runtime.nextTickAt = new Date(
        Date.now() + config.schedulerPollIntervalMs,
      ).toISOString();
    }
  }

  const timer = setInterval(() => void tick(), config.schedulerPollIntervalMs);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
  logEvent("info", "scheduler_started", {
    pollIntervalMs: config.schedulerPollIntervalMs,
    discoveryEnabled: config.autoDiscoveryEnabled,
    discoveryHour: config.schedulerDiscoveryHour,
    researchHour: config.schedulerResearchHour,
    backupHour: config.schedulerBackupHour,
  });
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      runtime.running = false;
      runtime.nextTickAt = null;
    },
  };
}

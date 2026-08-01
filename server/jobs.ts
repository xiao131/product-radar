import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { runAutomaticDiscovery } from "./discovery.js";
import { logEvent } from "./logger.js";
import { researchDueOpportunities } from "./research.js";
import { createVerifiedBackup } from "./backup.js";
import { readableAiError } from "./errors.js";

export class JobAlreadyRunningError extends Error {}

type JobTrigger = "manual" | "scheduled" | "cli";
type JobCompletionStatus = "COMPLETED" | "PARTIAL" | "FAILED";
const activeJobs = new WeakMap<RadarDatabase, Set<Promise<unknown>>>();

export function classifyJobResult(
  jobType: "DISCOVERY" | "RESEARCH" | "BACKUP",
  result: unknown,
): { status: JobCompletionStatus; error: string | null } {
  if (jobType !== "RESEARCH" || !result || typeof result !== "object") {
    return { status: "COMPLETED", error: null };
  }
  const summary = result as {
    requested?: unknown;
    failed?: unknown;
    failures?: Array<{ message?: unknown }>;
  };
  const requested = Number(summary.requested ?? 0);
  const failed = Number(summary.failed ?? 0);
  if (!Number.isFinite(failed) || failed <= 0) {
    return { status: "COMPLETED", error: null };
  }
  const firstFailure = summary.failures?.find(
    (failure) => typeof failure.message === "string" && failure.message.trim(),
  )?.message;
  const detail = firstFailure ? `：${readableAiError(firstFailure)}` : "";
  const error = `${failed}/${Math.max(requested, failed)} 个候选调研失败${detail}`;
  return {
    status: requested > 0 && failed >= requested ? "FAILED" : "PARTIAL",
    error,
  };
}

function snapshotConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    availableResearchMarkets: config.availableResearchMarkets.map((market) => ({
      ...market,
    })),
    researchMarkets: config.researchMarkets.map((market) => ({ ...market })),
  };
}

function now() {
  return new Date().toISOString();
}

function acquireLock(
  db: RadarDatabase,
  name: string,
  ownerId: string,
  ttlMs: number,
) {
  const acquiredAt = now();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = db
    .prepare(
      `INSERT INTO job_locks (name, owner_id, acquired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         owner_id = excluded.owner_id,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE job_locks.expires_at < excluded.acquired_at`,
    )
    .run(name, ownerId, acquiredAt, expiresAt);
  if (result.changes === 0) {
    throw new JobAlreadyRunningError(`${name} 任务已经在运行`);
  }
}

function releaseLock(db: RadarDatabase, name: string, ownerId: string) {
  db.prepare("DELETE FROM job_locks WHERE name = ? AND owner_id = ?").run(
    name,
    ownerId,
  );
}

async function sendAlert(
  config: AppConfig,
  event: string,
  message: string,
  jobId: string,
) {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "product-radar",
        event,
        jobId,
        message: message.slice(0, 500),
        time: now(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logEvent("warn", "alert_delivery_failed", {
      jobId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function startJob<T>(
  db: RadarDatabase,
  config: AppConfig,
  jobType: "DISCOVERY" | "RESEARCH" | "BACKUP",
  triggerType: JobTrigger,
  ttlMs: number,
  work: (jobId: string) => Promise<T>,
) {
  const jobId = randomUUID();
  const lockName = `job:${jobType.toLowerCase()}`;
  acquireLock(db, lockName, jobId, ttlMs);
  const startedAt = now();
  try {
    db.prepare(
      `INSERT INTO job_runs (
         id, job_type, trigger_type, status, provider_mode, started_at
       ) VALUES (?, ?, ?, 'RUNNING', ?, ?)`,
    ).run(
      jobId,
      jobType,
      triggerType,
      jobType === "RESEARCH" || jobType === "DISCOVERY"
        ? config.researchProvider.toUpperCase()
        : null,
      startedAt,
    );
  } catch (error) {
    releaseLock(db, lockName, jobId);
    throw error;
  }
  logEvent("info", "job_started", { jobId, jobType, triggerType });
  const completion = (async () => {
    try {
      const result = await work(jobId);
      const finishedAt = now();
      const outcome = classifyJobResult(jobType, result);
      db.prepare(
        `UPDATE job_runs
         SET status = ?, result_json = ?, error = ?, finished_at = ?
         WHERE id = ?`,
      ).run(
        outcome.status,
        JSON.stringify(result),
        outcome.error,
        finishedAt,
        jobId,
      );
      logEvent(outcome.status === "COMPLETED" ? "info" : "warn", "job_completed", {
        jobId,
        jobType,
        status: outcome.status,
        finishedAt,
      });
      if (outcome.status === "FAILED" && outcome.error) {
        await sendAlert(
          config,
          `${jobType.toLowerCase()}_failed`,
          outcome.error,
          jobId,
        );
      }
      return { jobId, status: outcome.status, result };
    } catch (error) {
      const message =
        jobType === "DISCOVERY" || jobType === "RESEARCH"
          ? readableAiError(error)
          : error instanceof Error
            ? error.message
            : "未知任务错误";
      const finishedAt = now();
      db.prepare(
        `UPDATE job_runs
         SET status = 'FAILED', error = ?, finished_at = ?
         WHERE id = ?`,
      ).run(message, finishedAt, jobId);
      logEvent("error", "job_failed", {
        jobId,
        jobType,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message,
      });
      await sendAlert(config, `${jobType.toLowerCase()}_failed`, message, jobId);
      throw error;
    } finally {
      releaseLock(db, lockName, jobId);
    }
  })();
  const tracked = activeJobs.get(db) ?? new Set<Promise<unknown>>();
  tracked.add(completion);
  activeJobs.set(db, tracked);
  void completion.then(
    () => tracked.delete(completion),
    () => tracked.delete(completion),
  );
  return { jobId, status: "RUNNING" as const, completion };
}

export async function waitForActiveJobs(
  db: RadarDatabase,
  timeoutMs = 30_000,
) {
  const jobs = [...(activeJobs.get(db) ?? [])];
  if (!jobs.length) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const completed = Promise.allSettled(jobs).then(() => true as const);
  const result = await Promise.race([completed, timedOut]);
  if (timer) clearTimeout(timer);
  return result;
}

export function recoverStaleJobs(db: RadarDatabase) {
  const current = now();
  db.transaction(() => {
    // This application supports one write process. Any persisted lock at startup
    // therefore belongs to a process that is no longer running.
    db.prepare("DELETE FROM job_locks").run();
    db.prepare(
      `UPDATE job_runs
       SET status = 'FAILED',
           error = COALESCE(error, '服务重启时检测到未完成任务'),
           finished_at = COALESCE(finished_at, ?)
       WHERE status = 'RUNNING'`,
    ).run(current);
    db.prepare(
      `UPDATE opportunities
       SET research_status = 'FAILED', updated_at = ?
       WHERE research_status = 'RUNNING'`,
    ).run(current);
    db.prepare(
      `UPDATE backup_runs
       SET status = 'FAILED',
           error = COALESCE(error, '服务重启时检测到未完成备份'),
           finished_at = COALESCE(finished_at, ?)
       WHERE status = 'RUNNING'`,
    ).run(current);
  })();
}

export function runResearchJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
  delivery: "live" | "standard",
  scope: {
    targetOpportunityIds?: string[];
    forceRefreshIds?: string[];
  } = {},
) {
  return startResearchJob(
    db,
    config,
    trigger,
    delivery,
    scope,
  ).completion;
}

export function startResearchJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
  delivery: "live" | "standard",
  scope: {
    targetOpportunityIds?: string[];
    forceRefreshIds?: string[];
  } = {},
) {
  const taskConfig = snapshotConfig(config);
  return startJob(
    db,
    taskConfig,
    "RESEARCH",
    trigger,
    Math.max(
      taskConfig.dataForSeoBatchTimeoutMs + 60 * 60 * 1_000,
      48 * 60 * 60 * 1_000,
    ),
    () =>
      researchDueOpportunities(
        db,
        taskConfig,
        delivery,
        scope,
      ),
  );
}

export function runDiscoveryJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
) {
  return startDiscoveryJob(db, config, trigger).completion;
}

export function startDiscoveryJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
) {
  const taskConfig = snapshotConfig(config);
  return startJob(
    db,
    taskConfig,
    "DISCOVERY",
    trigger,
    Math.max(
      taskConfig.dataForSeoBatchTimeoutMs + 60 * 60 * 1_000,
      24 * 60 * 60 * 1_000,
    ),
    (jobId) => runAutomaticDiscovery(db, taskConfig, jobId),
  );
}

export function startDiscoveryPipeline(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
) {
  const discovery = startDiscoveryJob(db, config, trigger);
  const pipelineCompletion = discovery.completion.then(async (completed) => {
    if (!completed.result.opportunityIds.length) {
      return { discovery: completed, research: null };
    }
    const research = startResearchJob(db, config, trigger, "standard", {
      targetOpportunityIds: completed.result.opportunityIds,
    });
    return {
      discovery: completed,
      research: await research.completion,
    };
  });
  return { ...discovery, pipelineCompletion };
}

export function runBackupJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
) {
  return startBackupJob(db, config, trigger).completion;
}

export function startBackupJob(
  db: RadarDatabase,
  config: AppConfig,
  trigger: JobTrigger,
) {
  const taskConfig = snapshotConfig(config);
  return startJob(db, taskConfig, "BACKUP", trigger, 30 * 60 * 1_000, () =>
    createVerifiedBackup(db, taskConfig),
  );
}

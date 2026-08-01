import type Database from "better-sqlite3";
import { consolidateAutomaticSignalDuplicates } from "./signal-dedupe.js";

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export function repairHistoricalJobOutcomes(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, job_type, status, result_json
       FROM job_runs
       WHERE job_type = 'RESEARCH'
         AND status IN ('COMPLETED', 'PARTIAL')`,
    )
    .all() as Array<{
    id: string;
    job_type: string;
    status: string;
    result_json: string;
  }>;
  for (const row of rows) {
    let result: { requested?: number; failed?: number };
    try {
      result = JSON.parse(row.result_json) as typeof result;
    } catch {
      continue;
    }
    const requested = Number(result.requested ?? 0);
    const failed = Number(result.failed ?? 0);
    if (requested <= 0 || failed <= 0) continue;
    const status = failed >= requested ? "FAILED" : "PARTIAL";
    const error = `${failed}/${requested} 个候选调研失败（历史任务状态已修正）`;
    db.prepare(
      `UPDATE job_runs
       SET status = ?, error = COALESCE(error, ?)
       WHERE id = ?`,
    ).run(status, error, row.id);
  }
}

const initialSchema = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('WEB', 'IOS', 'WEB_AND_IOS')),
  status TEXT NOT NULL CHECK (status IN ('IDEA', 'BUILDING', 'LIVE', 'PAUSED', 'ARCHIVED')),
  url TEXT,
  description TEXT NOT NULL DEFAULT '',
  current_focus TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  one_liner TEXT NOT NULL,
  target_user TEXT NOT NULL,
  source_type TEXT NOT NULL,
  recommended_platform TEXT NOT NULL CHECK (recommended_platform IN ('WEB', 'IOS', 'WEB_AND_IOS')),
  verdict TEXT NOT NULL CHECK (verdict IN ('BUILD_NOW', 'VALIDATE_FIRST', 'WATCH', 'SKIP')),
  research_status TEXT NOT NULL CHECK (research_status IN ('UNRESEARCHED', 'READY', 'RUNNING', 'FAILED')),
  score INTEGER NOT NULL DEFAULT 0,
  score_delta INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  demand_score INTEGER NOT NULL DEFAULT 0,
  pain_score INTEGER NOT NULL DEFAULT 0,
  trend_score INTEGER NOT NULL DEFAULT 0,
  willingness_score INTEGER NOT NULL DEFAULT 0,
  competition_gap_score INTEGER NOT NULL DEFAULT 0,
  reachability_score INTEGER NOT NULL DEFAULT 0,
  buildability_score INTEGER NOT NULL DEFAULT 0,
  founder_fit_score INTEGER NOT NULL DEFAULT 0,
  freshness_score INTEGER NOT NULL DEFAULT 0,
  change_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_researched_at TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('NEW', 'PROCESSED', 'ARCHIVED')),
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  metric TEXT NOT NULL,
  value REAL,
  unit TEXT,
  direction TEXT NOT NULL,
  strength INTEGER NOT NULL,
  summary TEXT NOT NULL,
  raw_excerpt TEXT,
  collected_at TEXT NOT NULL,
  freshness_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  provider_mode TEXT NOT NULL,
  verdict TEXT NOT NULL,
  recommended_platform TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  score INTEGER NOT NULL,
  score_delta INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  researcher_summary TEXT NOT NULL,
  debate_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(opportunity_id, version)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opportunity_score ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_updated ON opportunities(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_research_due ON opportunities(last_researched_at, research_status);
CREATE INDEX IF NOT EXISTS idx_signal_status ON signals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_opportunity ON research_reports(opportunity_id, version DESC);
`;

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial radar schema",
    up(db) {
      db.exec(initialSchema);
    },
  },
  {
    version: 2,
    name: "production operations and report audit",
    up(db) {
      db.exec(`
        ALTER TABLE evidence_items ADD COLUMN fingerprint TEXT;
        ALTER TABLE evidence_items ADD COLUMN market TEXT;
        ALTER TABLE research_reports ADD COLUMN model_id TEXT;
        ALTER TABLE research_reports ADD COLUMN prompt_version TEXT;
        ALTER TABLE research_reports ADD COLUMN usage_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE research_reports ADD COLUMN evidence_snapshot_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE research_reports ADD COLUMN evidence_coverage_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE research_reports ADD COLUMN guardrail_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE research_reports ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]';

        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_fingerprint
          ON evidence_items(opportunity_id, fingerprint)
          WHERE fingerprint IS NOT NULL;

        CREATE TABLE IF NOT EXISTS job_runs (
          id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          trigger_type TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_mode TEXT,
          result_json TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS job_locks (
          name TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_events (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          operation TEXT NOT NULL,
          units REAL NOT NULL DEFAULT 1,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backup_runs (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          path TEXT,
          size_bytes INTEGER,
          integrity_result TEXT,
          error TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_job_runs_started
          ON job_runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_usage_provider_created
          ON usage_events(provider, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_backup_runs_started
          ON backup_runs(started_at DESC);
      `);
    },
  },
  {
    version: 3,
    name: "automatic discovery and source deduplication",
    up(db) {
      db.exec(`
        ALTER TABLE signals ADD COLUMN fingerprint TEXT;
        ALTER TABLE signals ADD COLUMN market TEXT;
        ALTER TABLE signals ADD COLUMN source_name TEXT;
        ALTER TABLE signals ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE signals ADD COLUMN discovery_run_id TEXT;
        ALTER TABLE signals ADD COLUMN auto_collected INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE opportunities ADD COLUMN discovery_key TEXT;
        ALTER TABLE opportunities ADD COLUMN auto_discovered INTEGER NOT NULL DEFAULT 0;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_fingerprint
          ON signals(fingerprint)
          WHERE fingerprint IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_signal_discovery_run
          ON signals(discovery_run_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_discovery_key
          ON opportunities(discovery_key)
          WHERE discovery_key IS NOT NULL;
      `);
    },
  },
  {
    version: 4,
    name: "cost safe discovery signal identity",
    up(db) {
      db.exec(`
        ALTER TABLE signals ADD COLUMN canonical_key TEXT;
        ALTER TABLE signals ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 1;
      `);
      consolidateAutomaticSignalDuplicates(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_canonical_key
          ON signals(canonical_key)
          WHERE canonical_key IS NOT NULL;
      `);
    },
  },
  {
    version: 5,
    name: "AI signal review state and confidence scale",
    up(db) {
      db.exec(`
        ALTER TABLE signals ADD COLUMN ai_reviewed_at TEXT;
        ALTER TABLE signals ADD COLUMN ai_review_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE signals ADD COLUMN last_ai_run_id TEXT;

        CREATE INDEX IF NOT EXISTS idx_signal_ai_review_queue
          ON signals(auto_collected, opportunity_id, ai_review_count, updated_at DESC);

        UPDATE opportunities
        SET confidence = MIN(100, ROUND(confidence * 100))
        WHERE auto_discovered = 1
          AND confidence > 0
          AND confidence <= 1
          AND NOT EXISTS (
            SELECT 1 FROM research_reports
            WHERE research_reports.opportunity_id = opportunities.id
          );
      `);
    },
  },
  {
    version: 6,
    name: "decision invalidation watermark",
    up(db) {
      db.exec(`
        ALTER TABLE opportunities ADD COLUMN stale_since TEXT;

        UPDATE opportunities
        SET stale_since = updated_at
        WHERE research_status != 'READY';

        CREATE INDEX IF NOT EXISTS idx_opportunity_stale
          ON opportunities(stale_since, research_status);
      `);
    },
  },
  {
    version: 7,
    name: "repair historical research job outcomes",
    up(db) {
      repairHistoricalJobOutcomes(db);
    },
  },
];

export function migrateDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

export function latestSchemaVersion() {
  return migrations.at(-1)?.version ?? 0;
}

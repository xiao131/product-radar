import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedDemoData } from "./demo-data.js";

export type RadarDatabase = Database.Database;

const schema = `
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

export function createDatabase(databasePath: string, withSeed = true): RadarDatabase {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  if (withSeed) seedDemoData(db);
  return db;
}

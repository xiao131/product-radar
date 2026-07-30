import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedDemoData } from "./demo-data.js";
import { migrateDatabase } from "./migrations.js";

export type RadarDatabase = Database.Database;

interface DatabaseOptions {
  seedDemoData?: boolean;
  busyTimeoutMs?: number;
}

export function createDatabase(
  databasePath: string,
  options: boolean | DatabaseOptions = true,
): RadarDatabase {
  const resolvedOptions: DatabaseOptions =
    typeof options === "boolean" ? { seedDemoData: options } : options;
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${Math.max(0, resolvedOptions.busyTimeoutMs ?? 5_000)}`);
  migrateDatabase(db);
  if (resolvedOptions.seedDemoData ?? true) seedDemoData(db);
  return db;
}

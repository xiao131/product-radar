import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";

function backupFileName() {
  return `product-radar-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
}

function pruneBackups(directory: string, retentionCount: number) {
  const backups = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^product-radar-.*\.db$/.test(entry.name))
    .map((entry) => ({
      path: path.join(directory, entry.name),
      modifiedAt: fs.statSync(path.join(directory, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const backup of backups.slice(retentionCount)) {
    fs.unlinkSync(backup.path);
  }
}

export async function createVerifiedBackup(
  db: RadarDatabase,
  config: AppConfig,
) {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  fs.mkdirSync(config.backupDirectory, { recursive: true });
  const destination = path.join(config.backupDirectory, backupFileName());
  db.prepare(
    `INSERT INTO backup_runs (id, status, started_at)
     VALUES (?, 'RUNNING', ?)`,
  ).run(id, startedAt);

  try {
    await db.backup(destination);
    const verification = new Database(destination, {
      readonly: true,
      fileMustExist: true,
    });
    const integrity = String(verification.pragma("integrity_check", { simple: true }));
    verification.close();
    if (integrity !== "ok") {
      throw new Error(`SQLite 备份完整性检查失败：${integrity}`);
    }
    const sizeBytes = fs.statSync(destination).size;
    const finishedAt = new Date().toISOString();
    db.prepare(
      `UPDATE backup_runs
       SET status = 'COMPLETED', path = ?, size_bytes = ?,
           integrity_result = ?, finished_at = ?
       WHERE id = ?`,
    ).run(destination, sizeBytes, integrity, finishedAt, id);
    pruneBackups(config.backupDirectory, config.backupRetentionCount);
    return {
      id,
      status: "COMPLETED" as const,
      path: destination,
      sizeBytes,
      integrity,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    const message = error instanceof Error ? error.message : "未知备份错误";
    const finishedAt = new Date().toISOString();
    db.prepare(
      `UPDATE backup_runs
       SET status = 'FAILED', error = ?, finished_at = ?
       WHERE id = ?`,
    ).run(message, finishedAt, id);
    throw error;
  }
}

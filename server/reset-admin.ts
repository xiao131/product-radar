import "dotenv/config";
import path from "node:path";
import { createDatabase } from "./db.js";
import { hashPassword, normalizeAdminUsername } from "./security.js";

const password = process.env.RADAR_ADMIN_PASSWORD;

if (!password) {
  console.error(
    "请通过 RADAR_ADMIN_PASSWORD 环境变量提供至少 12 位的新密码",
  );
  process.exitCode = 1;
} else {
  const databasePath = path.resolve(
    process.env.DATABASE_PATH ?? "./data/product-radar.db",
  );
  const db = createDatabase(databasePath, { seedDemoData: false });
  try {
    const existing = db
      .prepare("SELECT username FROM admin_account WHERE id = 1")
      .get() as { username: string } | undefined;
    const username = normalizeAdminUsername(
      process.env.RADAR_ADMIN_USERNAME ?? existing?.username ?? "xx131",
    );
    const passwordHash = await hashPassword(password);
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO admin_account (
         id, username, password_hash, session_version, created_at, updated_at
       ) VALUES (1, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username,
         password_hash = excluded.password_hash,
         session_version = admin_account.session_version + 1,
         updated_at = excluded.updated_at`,
    ).run(username, passwordHash, updatedAt, updatedAt);
    console.log(`管理员账号 ${username} 已重置，旧登录会话已失效。`);
  } finally {
    db.close();
  }
}

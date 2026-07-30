import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [sourceInput, destinationInput] = process.argv.slice(2);
if (!sourceInput || !destinationInput) {
  console.error(
    "用法：npm run backup:restore -- <backup.db> <new-database.db>",
  );
  process.exitCode = 1;
} else {
  const source = path.resolve(sourceInput);
  const destination = path.resolve(destinationInput);
  if (!fs.existsSync(source)) {
    throw new Error(`找不到备份文件：${source}`);
  }
  if (fs.existsSync(destination)) {
    throw new Error(`恢复目标已经存在，拒绝覆盖：${destination}`);
  }
  const backup = new Database(source, { readonly: true, fileMustExist: true });
  const sourceIntegrity = String(
    backup.pragma("integrity_check", { simple: true }),
  );
  backup.close();
  if (sourceIntegrity !== "ok") {
    throw new Error(`备份完整性检查失败：${sourceIntegrity}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const restored = new Database(destination, {
    readonly: true,
    fileMustExist: true,
  });
  const restoredIntegrity = String(
    restored.pragma("integrity_check", { simple: true }),
  );
  restored.close();
  if (restoredIntegrity !== "ok") {
    fs.unlinkSync(destination);
    throw new Error(`恢复文件完整性检查失败：${restoredIntegrity}`);
  }
  console.log(`恢复文件已创建：${destination}`);
}

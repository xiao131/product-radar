import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { recoverStaleJobs, waitForActiveJobs } from "./jobs.js";
import { startScheduler } from "./scheduler.js";
import { applyStoredRuntimeSettings } from "./runtime-settings.js";

const config = loadConfig();
const database = createDatabase(config.databasePath, {
  seedDemoData: config.seedDemoData,
  busyTimeoutMs: config.databaseBusyTimeoutMs,
});
applyStoredRuntimeSettings(database, config);
recoverStaleJobs(database);
const app = createApp(database, config);
const scheduler = startScheduler(database, config);

if (process.env.NODE_ENV === "production") {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(currentDirectory, "../dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_request, response) => {
    response.sendFile(path.join(dist, "index.html"));
  });
}

const server = app.listen(config.port, config.host, () => {
  console.log(
    `Product Radar API running at http://${config.host}:${config.port} (${config.researchProvider.toUpperCase()} mode)`,
  );
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  server.close(async () => {
    await waitForActiveJobs(database);
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

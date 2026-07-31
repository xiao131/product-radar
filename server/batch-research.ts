import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { recoverStaleJobs, runResearchJob } from "./jobs.js";
import { applyStoredRuntimeSettings } from "./runtime-settings.js";

const config = loadConfig();
const database = createDatabase(config.databasePath, {
  seedDemoData: config.seedDemoData,
  busyTimeoutMs: config.databaseBusyTimeoutMs,
});
applyStoredRuntimeSettings(database, config);
recoverStaleJobs(database);

try {
  const job = await runResearchJob(database, config, "cli", "standard");
  console.log(JSON.stringify(job.result, null, 2));
  if (job.result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  database.close();
}

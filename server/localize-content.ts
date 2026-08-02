import { loadConfig } from "./config.js";
import { backfillLocalizedContent, getContentLocalizationBacklog } from "./content-localization.js";
import { createDatabase } from "./db.js";
import { applyStoredRuntimeSettings } from "./runtime-settings.js";

const config = loadConfig();
const database = createDatabase(config.databasePath, {
  seedDemoData: config.seedDemoData,
  busyTimeoutMs: config.databaseBusyTimeoutMs,
});

try {
  applyStoredRuntimeSettings(database, config);
  const backlog = getContentLocalizationBacklog(database);
  console.log(
    JSON.stringify({
      event: "content_localization_backlog",
      opportunities: backlog.opportunities.length,
      reports: backlog.reports.length,
      evidence: backlog.evidence.length,
      dataForSeoRequests: 0,
    }),
  );
  const result = await backfillLocalizedContent(database, config);
  console.log(
    JSON.stringify({
      event: "content_localization_completed",
      ...result,
      dataForSeoRequests: 0,
    }),
  );
} finally {
  database.close();
}

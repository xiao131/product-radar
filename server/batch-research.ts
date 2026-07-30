import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { researchDueOpportunities } from "./research.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);

try {
  const result = await researchDueOpportunities(database, config, "standard");
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  database.close();
}

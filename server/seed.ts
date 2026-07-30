import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";

const config = loadConfig();
const database = createDatabase(config.databasePath, true);
const opportunityCount = (
  database.prepare("SELECT COUNT(*) AS count FROM opportunities").get() as {
    count: number;
  }
).count;
const productCount = (
  database.prepare("SELECT COUNT(*) AS count FROM products").get() as {
    count: number;
  }
).count;
console.log(`Seed ready: ${opportunityCount} opportunities, ${productCount} products.`);
database.close();

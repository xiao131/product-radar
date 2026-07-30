import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const app = createApp(database, config);

if (process.env.NODE_ENV === "production") {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(currentDirectory, "../dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_request, response) => {
    response.sendFile(path.join(dist, "index.html"));
  });
}

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(
    `Product Radar API running at http://127.0.0.1:${config.port} (${config.researchProvider.toUpperCase()} mode)`,
  );
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

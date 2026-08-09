import "dotenv/config";
import { buildApp } from "./app.js";
import { db } from "./db.js";

const app = buildApp();

const start = async () => {
  try {
    await app.listen({
      port: 8080,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    await db.end();
    process.exit(1);
  }
};

const shutdown = async () => {
  app.log.info("Shutting down...");

  await app.close();
  await db.end();

  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();

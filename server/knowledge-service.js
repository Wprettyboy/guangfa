import { loadEnvFile } from "node:process";

try {
  loadEnvFile?.(process.env.KNOWLEDGE_ENV_FILE || ".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

process.env.NODE_ENV = "production";
process.env.API_DEPLOYMENT_MODE = "production";

const { startKnowledgeHttpServer } = await import("./knowledge-http-server.js");
await startKnowledgeHttpServer();

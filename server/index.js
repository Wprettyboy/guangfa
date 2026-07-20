import { loadEnvFile } from "node:process";

try {
  loadEnvFile?.(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

process.env.NODE_ENV = "production";
process.env.API_DEPLOYMENT_MODE = "production";

const { startProductionServer } = await import("./http-server.js");
await startProductionServer();

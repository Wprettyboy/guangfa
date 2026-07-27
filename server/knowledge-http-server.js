import { createServer } from "node:http";
import { readAuthenticationCredentials } from "./api/auth.js";
import { initializeCapabilityService } from "./api/capability.js";
import { createApiGateway } from "./api/gateway.js";
import { knowledgeApiMiddleware } from "./api/knowledge.js";
import { closeKnowledgeDatabase, getKnowledgeDatabase } from "./knowledge/db.js";

async function startKnowledgeHttpServer(options = {}) {
  assertKnowledgeServiceConfiguration();
  initializeCapabilityService({ environment: "production" });
  const gateway = createApiGateway({
    deploymentMode: "production",
    middlewareFactory: knowledgeApiMiddleware,
  });
  const host = String(options.host || process.env.KNOWLEDGE_API_HOST || "0.0.0.0");
  const port = readPort(options.port ?? process.env.KNOWLEDGE_API_PORT ?? 8787);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://local");
      if (url.pathname === "/healthz") return sendJson(response, 200, { ok: true });
      if (url.pathname === "/readyz") return sendReadiness(response);
      await gateway(request, response, () => sendJson(response, 404, {
        error: "接口不存在",
        code: "NOT_FOUND",
        message: "接口不存在",
      }));
    } catch (error) {
      console.error(JSON.stringify({ event: "knowledge_http_error", message: error?.message || String(error), stack: error?.stack }));
      if (!response.headersSent) sendJson(response, 500, { error: "服务内部错误", code: "INTERNAL_ERROR", message: "服务内部错误" });
      else response.destroy();
    }
  });
  configureServer(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  installGracefulShutdown(server);
  console.info(JSON.stringify({ event: "knowledge_service_started", host, port: server.address().port, pid: process.pid }));
  return server;
}

async function sendReadiness(response) {
  try {
    const database = await getKnowledgeDatabase();
    database.prepare("SELECT 1 AS ready").get();
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 503, { ok: false, error: error?.message || "知识库存储未就绪" });
  }
}

function assertKnowledgeServiceConfiguration() {
  if (String(process.env.API_AUTH_MODE || "required").toLowerCase() !== "required") {
    throw new Error("Knowledge API 必须启用 API_AUTH_MODE=required");
  }
  const credentials = readAuthenticationCredentials({ minimumSecretBytes: 32 });
  if (credentials.apiKeys.length + credentials.bearerTokens.length === 0) {
    throw new Error("Knowledge API 缺少 API Key 或 Bearer Token");
  }
  const capabilitySecret = String(process.env.API_CAPABILITY_SECRET || "");
  if (Buffer.byteLength(capabilitySecret, "utf8") < 32) {
    throw new Error("API_CAPABILITY_SECRET 至少需要 32 字节");
  }
  if (!process.env.KNOWLEDGE_DATABASE_PATH || !process.env.KNOWLEDGE_DATA_DIR) {
    throw new Error("Knowledge API 必须配置独立的 KNOWLEDGE_DATABASE_PATH 和 KNOWLEDGE_DATA_DIR");
  }
}

function configureServer(server) {
  server.headersTimeout = 15_000;
  server.requestTimeout = 10 * 60 * 1000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
}

function installGracefulShutdown(server) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.info(JSON.stringify({ event: "knowledge_service_stopping", signal }));
    server.close(async () => {
      await closeKnowledgeDatabase().catch((error) => {
        console.error(JSON.stringify({ event: "knowledge_database_close_failed", message: error?.message || String(error) }));
        process.exitCode = 1;
      });
      if (process.exitCode == null) process.exitCode = 0;
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function readPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("KNOWLEDGE_API_PORT 无效");
  return port;
}

function sendJson(response, statusCode, body) {
  const json = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(json));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(json);
}

export { startKnowledgeHttpServer };

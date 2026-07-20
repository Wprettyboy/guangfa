import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { readAuthenticationCredentials } from "./api/auth.js";
import { initializeCapabilityService } from "./api/capability.js";
import { createApiGateway } from "./api/gateway.js";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

async function startProductionServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const distDir = path.resolve(options.distDir || path.join(rootDir, "dist"));
  assertProductionConfiguration(distDir);
  initializeCapabilityService({ environment: "production" });

  const gateway = createApiGateway({ deploymentMode: "production" });
  const handler = createApplicationHandler({ distDir, gateway });
  const tls = await readTlsOptions(options);
  const host = String(options.host || process.env.API_HOST || "127.0.0.1");
  const port = readPort(options.port ?? process.env.PORT ?? 5173);
  assertNetworkBoundary(host, tls);
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  configureServerLimits(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  installGracefulShutdown(server);
  console.info(JSON.stringify({
    event: "server_started",
    host,
    port,
    protocol: tls ? "https" : "http",
    pid: process.pid,
  }));
  return server;
}

function createApplicationHandler({ distDir, gateway }) {
  return async function handleApplicationRequest(request, response) {
    try {
      applyTransportSecurityHeader(response);
      const url = new URL(request.url || "/", "http://local");
      if (url.pathname === "/healthz" || url.pathname === "/readyz") {
        sendOperationalStatus(response, url.pathname === "/readyz" ? existsSync(path.join(distDir, "index.html")) : true);
        return;
      }
      await gateway(request, response, () => serveStaticRequest(request, response, url, distDir));
    } catch (error) {
      console.error(JSON.stringify({ event: "http_unhandled_error", message: error?.message || String(error), stack: error?.stack }));
      if (!response.headersSent) sendPlain(response, 500, "Internal Server Error");
      else response.destroy();
    }
  };
}

async function serveStaticRequest(request, response, url, distDir) {
  const method = String(request.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    response.setHeader("Allow", "GET, HEAD");
    sendPlain(response, 405, "Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendPlain(response, 400, "Bad Request");
    return;
  }
  if (pathname.includes("\0")) {
    sendPlain(response, 400, "Bad Request");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let filePath = resolveStaticPath(distDir, requestedPath);
  let fileStat = filePath ? await stat(filePath).catch(() => null) : null;
  if (!fileStat?.isFile() && acceptsHtml(request)) {
    filePath = path.join(distDir, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) {
    sendPlain(response, 404, "Not Found");
    return;
  }

  applyStaticSecurityHeaders(response);
  const etag = `W/\"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}\"`;
  response.setHeader("ETag", etag);
  response.setHeader("Content-Type", mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
  response.setHeader("Content-Length", fileStat.size);
  response.setHeader("Cache-Control", isHashedAsset(filePath) ? "public, max-age=31536000, immutable" : "no-cache");
  if (String(request.headers["if-none-match"] || "") === etag) {
    response.statusCode = 304;
    response.end();
    return;
  }
  response.statusCode = 200;
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).on("error", (error) => response.destroy(error)).pipe(response);
}

function resolveStaticPath(distDir, pathname) {
  const relative = pathname.replace(/^[/\\]+/, "");
  const resolved = path.resolve(distDir, relative);
  const prefix = `${distDir}${path.sep}`;
  return resolved === distDir || resolved.startsWith(prefix) ? resolved : "";
}

function applyStaticSecurityHeaders(response) {
  const officeOrigin = readOrigin(process.env.ONLYOFFICE_PUBLIC_URL || process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080");
  const officeSource = officeOrigin ? ` ${officeOrigin}` : "";
  const apiOrigin = readOrigin(process.env.VITE_API_BASE_URL || "");
  const connectSources = [...new Set(["'self'", officeOrigin, apiOrigin].filter(Boolean))].join(" ");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    `script-src 'self'${officeSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSources}`,
    `frame-src 'self'${officeSource}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "));
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function applyTransportSecurityHeader(response) {
  if (String(process.env.API_HSTS || "false").toLowerCase() === "true") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function sendOperationalStatus(response, ready) {
  const body = JSON.stringify({ ok: Boolean(ready) });
  response.statusCode = ready ? 200 : 503;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function sendPlain(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(message);
}

function acceptsHtml(request) {
  return String(request.headers.accept || "").split(",").some((value) => value.trim().startsWith("text/html"));
}

function isHashedAsset(filePath) {
  return filePath.includes(`${path.sep}assets${path.sep}`) && /-[A-Za-z0-9_-]{8,}\./.test(path.basename(filePath));
}

function assertProductionConfiguration(distDir) {
  if (!existsSync(path.join(distDir, "index.html"))) throw new Error(`生产构建不存在：${path.join(distDir, "index.html")}`);
  const authMode = String(process.env.API_AUTH_MODE || "required").toLowerCase();
  if (authMode !== "required") throw new Error("生产服务必须设置 API_AUTH_MODE=required");
  const credentials = readAuthenticationCredentials({ minimumSecretBytes: 32 });
  const authenticationSecrets = [...credentials.bearerTokens, ...credentials.apiKeys].map((credential) => credential.secret);
  if (!authenticationSecrets.length) throw new Error("生产服务缺少 API_AUTH_BEARER_TOKENS 或 API_AUTH_API_KEYS");
  const onlyOfficeSecret = String(process.env.ONLYOFFICE_JWT_SECRET || "").trim();
  if (!onlyOfficeSecret) throw new Error("生产服务缺少 ONLYOFFICE_JWT_SECRET");
  if (Buffer.byteLength(onlyOfficeSecret, "utf8") < 32) throw new Error("ONLYOFFICE_JWT_SECRET 至少需要 32 字节");
  const capabilitySecret = String(process.env.API_CAPABILITY_SECRET || "").trim();
  if (!capabilitySecret) throw new Error("生产环境必须配置 API_CAPABILITY_SECRET");
  if (Buffer.byteLength(capabilitySecret, "utf8") < 32) throw new Error("API_CAPABILITY_SECRET 至少需要 32 字节");
  const secrets = [...authenticationSecrets, onlyOfficeSecret, capabilitySecret];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error("生产登录凭证、ONLYOFFICE_JWT_SECRET 与 API_CAPABILITY_SECRET 必须相互独立");
  }
}

function assertNetworkBoundary(host, tls) {
  const normalized = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(normalized);
  const trustedProxy = String(process.env.API_TRUST_PROXY || "false").toLowerCase() === "true";
  if (!loopback && !tls && !trustedProxy) {
    throw new Error("非回环生产监听必须配置 TLS，或在受控 HTTPS 反向代理后启用 API_TRUST_PROXY");
  }
}

async function readTlsOptions(options) {
  const certFile = options.tlsCertFile || process.env.TLS_CERT_FILE;
  const keyFile = options.tlsKeyFile || process.env.TLS_KEY_FILE;
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) throw new Error("TLS_CERT_FILE 与 TLS_KEY_FILE 必须同时配置");
  const [cert, key] = await Promise.all([readFile(path.resolve(certFile)), readFile(path.resolve(keyFile))]);
  return { cert, key };
}

function configureServerLimits(server) {
  server.headersTimeout = readPositiveNumber(process.env.API_HEADERS_TIMEOUT_MS, 15000);
  server.requestTimeout = readPositiveNumber(process.env.API_REQUEST_TIMEOUT_MS, 10 * 60 * 1000);
  server.keepAliveTimeout = readPositiveNumber(process.env.API_KEEP_ALIVE_TIMEOUT_MS, 5000);
  server.maxHeadersCount = readPositiveNumber(process.env.API_MAX_HEADERS_COUNT, 100);
  server.maxRequestsPerSocket = readPositiveNumber(process.env.API_MAX_REQUESTS_PER_SOCKET, 1000);
}

function installGracefulShutdown(server) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.info(JSON.stringify({ event: "server_stopping", signal }));
    const forceTimer = setTimeout(() => server.closeAllConnections?.(), 10000);
    forceTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error) console.error(JSON.stringify({ event: "server_stop_failed", message: error.message }));
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function readOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function readPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 必须是 1-65535 的整数");
  return port;
}

function readPositiveNumber(value, fallback) {
  const number = Number(value || fallback);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export { createApplicationHandler, startProductionServer };

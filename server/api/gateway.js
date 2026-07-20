import { randomUUID } from "node:crypto";
import { apiMiddleware } from "./index.js";

const allowedRequestHeaders = [
  "Authorization",
  "Content-Type",
  "Idempotency-Key",
  "If-Match",
  "X-API-Key",
  "X-Request-ID",
];
const allowedMethods = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"];

function createApiGateway(options = {}) {
  const deploymentMode = String(options.deploymentMode || process.env.API_DEPLOYMENT_MODE || process.env.NODE_ENV || "development").toLowerCase();
  const production = deploymentMode === "production";
  const apiOptions = options.api || {};
  const middleware = apiMiddleware({
    ...apiOptions,
    auth: { environment: deploymentMode, ...(apiOptions.auth || {}) },
    rateLimit: { environment: deploymentMode, ...(apiOptions.rateLimit || {}) },
  });
  const allowedOrigins = readAllowedOrigins(options.allowedOrigins, { production });

  return async function handleApiGateway(request, response, next = () => {}) {
    const parsed = parseRequestUrl(request.url);
    if (!parsed || !isApiPath(parsed.pathname)) {
      next();
      return;
    }

    const origin = readHeader(request, "origin");
    if (origin && !isAllowedOrigin(request, origin, allowedOrigins, { production })) {
      sendGatewayError(request, response, 403, "ORIGIN_FORBIDDEN", "不允许的请求来源");
      return;
    }

    applyCorsHeaders(response, origin);
    if (String(request.method || "GET").toUpperCase() === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Cache-Control", "no-store");
      response.end();
      return;
    }

    const originalUrl = request.url;
    const versioned = isVersionedApiPath(parsed.pathname);
    request.apiVersion = versioned ? "v1" : "legacy";
    if (versioned) request.url = rewriteVersionedUrl(originalUrl);
    else applyLegacyApiHeaders(response, parsed);

    try {
      await middleware(request, response, next);
    } finally {
      request.url = originalUrl;
      delete request.apiVersion;
    }
  };
}

function readAllowedOrigins(value, { production }) {
  const configured = value ?? process.env.API_ALLOWED_ORIGINS;
  const values = Array.isArray(configured)
    ? configured
    : String(configured || "").split(",");
  const origins = new Set(values.map(normalizeOrigin).filter(Boolean));
  const onlyOfficeOrigin = normalizeOrigin(process.env.ONLYOFFICE_PUBLIC_URL || process.env.ONLYOFFICE_SERVER_URL || "");
  if (onlyOfficeOrigin) origins.add(onlyOfficeOrigin);
  if (!production) {
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:8080");
    origins.add("http://localhost:8080");
  }
  if (origins.has("*")) throw new Error("API_ALLOWED_ORIGINS 不允许使用通配符 *");
  if (production) {
    origins.forEach((origin) => {
      const url = new URL(origin);
      if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
        throw new Error(`生产环境 API Origin 必须使用 HTTPS：${origin}`);
      }
    });
  }
  return origins;
}

function isAllowedOrigin(request, origin, allowedOrigins, { production }) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowedOrigins.has(normalized)) return true;

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin && normalized === requestOrigin) return true;
  return false;
}

function getRequestOrigin(request) {
  const trustProxy = String(process.env.API_TRUST_PROXY || "false").toLowerCase() === "true";
  const forwardedProtocol = trustProxy ? readHeader(request, "x-forwarded-proto").split(",", 1)[0].trim() : "";
  const protocol = forwardedProtocol || (request.socket?.encrypted ? "https" : "http");
  const forwardedHost = trustProxy ? readHeader(request, "x-forwarded-host").split(",", 1)[0].trim() : "";
  const host = forwardedHost || readHeader(request, "host");
  return normalizeOrigin(host ? `${protocol}://${host}` : "");
}

function applyCorsHeaders(response, origin) {
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    appendVary(response, "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", allowedRequestHeaders.join(", "));
  response.setHeader("Access-Control-Allow-Methods", allowedMethods.join(", "));
  response.setHeader("Access-Control-Expose-Headers", "Allow, ETag, X-Request-ID");
  response.setHeader("Access-Control-Max-Age", "600");
}

function applyLegacyApiHeaders(response, parsed) {
  const successorPath = parsed.pathname === "/api"
    ? "/api/v1"
    : `/api/v1${parsed.pathname.slice(4)}`;
  response.setHeader("Link", `<${successorPath}${parsed.search}>; rel=\"successor-version\"`);
}

function rewriteVersionedUrl(value) {
  return String(value || "/api/v1").replace(/^\/api\/v1(?=\/|\?|$)/, "/api");
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isVersionedApiPath(pathname) {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

function parseRequestUrl(value) {
  try {
    return new URL(String(value || "/"), "http://local");
  } catch {
    return null;
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isLoopbackHostname(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(value || "").replace(/^\[|\]$/g, "").toLowerCase());
}

function readHeader(request, name) {
  const value = request.headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

function appendVary(response, value) {
  const existing = String(response.getHeader("Vary") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!existing.includes(value)) existing.push(value);
  response.setHeader("Vary", existing.join(", "));
}

function sendGatewayError(request, response, statusCode, code, message) {
  const candidate = readHeader(request, "x-request-id");
  const requestId = candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : randomUUID();
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Request-ID", requestId);
  response.end(JSON.stringify({ error: message, code, message, requestId }));
}

export {
  allowedMethods,
  allowedRequestHeaders,
  createApiGateway,
  isAllowedOrigin,
  readAllowedOrigins,
  rewriteVersionedUrl,
};

import { ApiError } from "../api/errors.js";

const defaultRequestTimeoutMs = 10 * 60 * 1000;
const defaultSearchTimeoutMs = 15_000;
const forwardedRequestHeaders = ["idempotency-key", "if-match", "x-request-id"];
const forwardedResponseHeaders = ["cache-control", "content-disposition", "etag", "last-modified", "retry-after"];

function isKnowledgeServiceConfigured() {
  return Boolean(String(process.env.KNOWLEDGE_SERVICE_BASE_URL || "").trim());
}

function createKnowledgeServiceForwarder() {
  if (!isKnowledgeServiceConfigured()) return null;
  return async (context) => {
    if (!context.route?.tags?.includes("knowledge")) return null;
    return { handled: true, result: await forwardKnowledgeRequest(context) };
  };
}

async function forwardKnowledgeRequest({ route, body, principal, request, url }) {
  const target = buildKnowledgeServiceUrl(url.pathname, url.search);
  const headers = createUpstreamHeaders(request?.headers);
  const requestBody = createUpstreamBody(route, body, headers);
  const response = await requestKnowledgeService(target, {
    method: String(request?.method || route.method || "GET").toUpperCase(),
    headers,
    body: requestBody,
    timeoutMs: readTimeout("KNOWLEDGE_SERVICE_TIMEOUT_MS", defaultRequestTimeoutMs),
    useApiKey: !(route.auth === "optional" && principal?.authentication === "anonymous"),
  });
  return readUpstreamResult(response);
}

async function searchKnowledgeService(payload) {
  const response = await requestKnowledgeService(buildKnowledgeServiceUrl("/api/knowledge-bases/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    timeoutMs: readTimeout("KNOWLEDGE_SERVICE_SEARCH_TIMEOUT_MS", defaultSearchTimeoutMs),
  });
  const result = await readUpstreamResult(response);
  return Array.isArray(result.body?.items) ? result.body.items : [];
}

async function requestKnowledgeService(url, { timeoutMs, useApiKey = true, ...options }) {
  const headers = new Headers(options.headers || {});
  if (useApiKey) {
    const apiKey = String(process.env.KNOWLEDGE_SERVICE_API_KEY || "").trim();
    if (!apiKey) throw new ApiError(503, "KNOWLEDGE_SERVICE_NOT_CONFIGURED", "独立知识库服务缺少 API Key");
    headers.set("X-API-Key", apiKey);
  }
  try {
    return await fetch(url, { ...options, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ApiError(504, "KNOWLEDGE_SERVICE_TIMEOUT", "独立知识库服务响应超时", { cause: error });
    }
    throw new ApiError(502, "KNOWLEDGE_SERVICE_UNAVAILABLE", "无法连接独立知识库服务", { cause: error });
  }
}

async function readUpstreamResult(response) {
  const contentType = String(response.headers.get("content-type") || "application/octet-stream");
  const headers = pickResponseHeaders(response.headers);
  if (isJsonContentType(contentType)) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(response.status, body.code || "KNOWLEDGE_SERVICE_ERROR", body.message || body.error || "独立知识库服务请求失败", {
        details: body.details,
        headers,
      });
    }
    return { statusCode: response.status, body, headers };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new ApiError(response.status, "KNOWLEDGE_SERVICE_ERROR", "独立知识库服务请求失败", { headers });
  return { kind: "buffer", statusCode: response.status, buffer, contentType, headers };
}

function buildKnowledgeServiceUrl(pathname, search = "") {
  const baseUrl = readKnowledgeServiceBaseUrl();
  const relativePath = String(pathname || "/api").replace(/^\/api(?:\/v1)?\/?/, "");
  const target = new URL(relativePath, baseUrl);
  target.search = String(search || "");
  return target;
}

function readKnowledgeServiceBaseUrl() {
  const raw = String(process.env.KNOWLEDGE_SERVICE_BASE_URL || "").trim();
  if (!raw) throw new ApiError(503, "KNOWLEDGE_SERVICE_NOT_CONFIGURED", "独立知识库服务未配置");
  let url;
  try {
    url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  } catch (error) {
    throw new Error("KNOWLEDGE_SERVICE_BASE_URL 无效", { cause: error });
  }
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("KNOWLEDGE_SERVICE_BASE_URL 只允许 HTTP(S) 且不能包含凭证");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("远程 KNOWLEDGE_SERVICE_BASE_URL 必须使用 HTTPS");
  }
  return url;
}

function createUpstreamHeaders(source = {}) {
  const headers = new Headers();
  forwardedRequestHeaders.forEach((name) => {
    const value = source[name];
    if (value != null && value !== "") headers.set(name, Array.isArray(value) ? value[0] : value);
  });
  return headers;
}

function createUpstreamBody(route, body, headers) {
  if (route.requestBody?.parse === "multipart") return createMultipartBody(body);
  if (!route.body) return undefined;
  headers.set("Content-Type", "application/json");
  return JSON.stringify(body || {});
}

function createMultipartBody(body = {}) {
  const form = new FormData();
  Object.entries(body).forEach(([name, value]) => {
    if (value?.buffer && Buffer.isBuffer(value.buffer)) {
      form.append(name, new Blob([value.buffer], { type: value.mimeType || "application/octet-stream" }), value.fileName || "upload.bin");
    } else if (value != null) {
      form.append(name, String(value));
    }
  });
  return form;
}

function pickResponseHeaders(headers) {
  return Object.fromEntries(forwardedResponseHeaders
    .map((name) => [name, headers.get(name)])
    .filter(([, value]) => value != null));
}

function isJsonContentType(value) {
  const contentType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return contentType === "application/json" || (contentType.startsWith("application/") && contentType.endsWith("+json"));
}

function readTimeout(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 100 || value > 60 * 60 * 1000) throw new Error(`${name} 无效`);
  return value;
}

function isLoopbackHostname(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(value || "").replace(/^\[|\]$/g, "").toLowerCase());
}

export {
  buildKnowledgeServiceUrl,
  createKnowledgeServiceForwarder,
  forwardKnowledgeRequest,
  isKnowledgeServiceConfigured,
  readKnowledgeServiceBaseUrl,
  searchKnowledgeService,
};

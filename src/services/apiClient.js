const API_ACCESS_TOKEN_KEY = "guangfa.api.access-token";
const API_UNAUTHORIZED_EVENT = "guangfa:api-unauthorized";
const DEFAULT_API_TIMEOUT_MS = 60_000;
const DEFAULT_AI_TIMEOUT_MS = 180_000;

const environmentBaseUrl = normalizeBaseUrl(import.meta.env?.VITE_API_BASE_URL || "");
let clientConfig = {
  baseUrl: environmentBaseUrl,
  timeoutMs: normalizeTimeout(import.meta.env?.VITE_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS),
};

class ApiClientError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ApiClientError";
    this.status = Number(options.status || 0);
    this.code = String(options.code || "API_ERROR");
    this.details = options.details ?? null;
    this.requestId = String(options.requestId || "");
    this.response = options.response || null;
  }
}

function configureApiClient(options = {}) {
  clientConfig = {
    baseUrl: options.baseUrl === undefined ? clientConfig.baseUrl : normalizeBaseUrl(options.baseUrl),
    timeoutMs: normalizeTimeout(options.timeoutMs, clientConfig.timeoutMs),
  };
  return { ...clientConfig };
}

function getApiBaseUrl({ absolute = false } = {}) {
  if (!absolute) return clientConfig.baseUrl;
  if (typeof window === "undefined") return clientConfig.baseUrl;
  return new URL(clientConfig.baseUrl || "/", window.location.origin).href.replace(/\/$/, "");
}

function getApiAccessToken() {
  try {
    return window.sessionStorage.getItem(API_ACCESS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setApiAccessToken(value) {
  const token = String(value || "").trim();
  try {
    if (token) window.sessionStorage.setItem(API_ACCESS_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(API_ACCESS_TOKEN_KEY);
  } catch {}
  return token;
}

function clearApiAccessToken() {
  setApiAccessToken("");
}

async function apiRequest(path, options = {}) {
  const {
    auth = true,
    fallbackMessage = "API 请求失败",
    json,
    responseType = "json",
    signal: callerSignal,
    timeoutMs: requestedTimeoutMs,
    ...fetchOptions
  } = options;
  const normalizedPath = normalizeApiPath(path);
  const apiTarget = isApiPath(normalizedPath);
  const timeoutMs = requestedTimeoutMs === undefined
    ? (isAiApiPath(normalizedPath) ? Math.max(clientConfig.timeoutMs, DEFAULT_AI_TIMEOUT_MS) : clientConfig.timeoutMs)
    : requestedTimeoutMs;
  const headers = new Headers(fetchOptions.headers || {});
  const token = auth ? getApiAccessToken() : "";
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (apiTarget && !headers.has("X-Request-ID")) headers.set("X-Request-ID", createRequestId());
  if (json !== undefined) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    fetchOptions.body = JSON.stringify(json);
  }

  const requestControl = createRequestControl(callerSignal, timeoutMs);
  try {
    const response = await fetch(resolveApiUrl(normalizedPath), {
      ...fetchOptions,
      headers,
      signal: requestControl.signal,
    });
    if (!response.ok) {
      const error = await createResponseError(response, fallbackMessage);
      if (response.status === 401) notifyUnauthorized(token, error);
      throw error;
    }
    return await readResponse(response, responseType);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw normalizeRequestFailure(error, requestControl, fallbackMessage);
  } finally {
    requestControl.cleanup();
  }
}

function normalizeApiPath(path) {
  const value = String(path || "");
  if (/^\/api(?=\/|\?|$)/.test(value)) {
    return /^\/api\/v1(?=\/|\?|$)/.test(value)
      ? value
      : value.replace(/^\/api(?=\/|\?|$)/, "/api/v1");
  }
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value) || typeof window === "undefined") return value;
  try {
    const target = new URL(value);
    if (!isConfiguredApiOrigin(target.origin) || !/^\/api(?:\/|$)/.test(target.pathname)) return value;
    if (!/^\/api\/v1(?:\/|$)/.test(target.pathname)) {
      target.pathname = target.pathname.replace(/^\/api(?=\/|$)/, "/api/v1");
    }
    return target.href;
  } catch {
    return value;
  }
}

function isApiPath(path) {
  const value = String(path || "");
  if (/^\/api(?:\/|\?|$)/.test(value)) return true;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value) || typeof window === "undefined") return false;
  try {
    const target = new URL(value);
    return isConfiguredApiOrigin(target.origin) && /^\/api(?:\/|$)/.test(target.pathname);
  } catch {
    return false;
  }
}

function isAiApiPath(path) {
  const value = String(path || "");
  if (/^\/api\/v1\/ai(?:\/|\?|$)/.test(value)) return true;
  try {
    return isApiPath(value) && /^\/api\/v1\/ai(?:\/|$)/.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function isConfiguredApiOrigin(origin) {
  if (typeof window === "undefined") return false;
  try {
    return origin === new URL(clientConfig.baseUrl || "/", window.location.origin).origin;
  } catch {
    return false;
  }
}

function isApiRequestUrl(value) {
  return isApiPath(normalizeApiPath(value));
}

function resolveApiUrl(path) {
  const value = String(path || "");
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  if (!clientConfig.baseUrl) return value;
  return `${clientConfig.baseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}

async function readResponse(response, responseType) {
  if (responseType === "response") return response;
  if (response.status === 204 || response.status === 205) return null;
  if (responseType === "arrayBuffer") return response.arrayBuffer();
  if (responseType === "blob") return response.blob();
  if (responseType === "text") return response.text();
  if (responseType !== "json") {
    throw new TypeError(`不支持的 API 响应类型：${responseType}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new ApiClientError("API 返回了无效的 JSON 数据", {
      status: response.status,
      code: "INVALID_API_RESPONSE",
      requestId: response.headers.get("X-Request-ID") || "",
      response,
      cause,
    });
  }
}

async function createResponseError(response, fallbackMessage) {
  const requestId = response.headers.get("X-Request-ID") || "";
  let payload = null;
  try {
    const contentType = response.headers.get("Content-Type") || "";
    payload = contentType.includes("json") ? await response.json() : await response.text();
  } catch {}
  const envelope = payload && typeof payload === "object" ? payload : {};
  const text = typeof payload === "string" ? payload.trim() : "";
  return new ApiClientError(envelope.message || envelope.error || text || fallbackMessage, {
    status: response.status,
    code: envelope.code || `HTTP_${response.status}`,
    details: envelope.details,
    requestId: envelope.requestId || requestId,
    response,
  });
}

function createRequestControl(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = normalizeTimeout(timeoutMs, 0);
  const timer = timeout > 0
    ? window.setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, timeout)
    : null;
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    callerAborted: () => Boolean(callerSignal?.aborted),
    cleanup() {
      if (timer) window.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function normalizeRequestFailure(error, requestControl, fallbackMessage) {
  if (requestControl.timedOut()) {
    return new ApiClientError("API 请求超时，请稍后重试", {
      code: "REQUEST_TIMEOUT",
      cause: error,
    });
  }
  if (requestControl.callerAborted()) {
    return new ApiClientError("API 请求已取消", {
      code: "REQUEST_ABORTED",
      cause: error,
    });
  }
  return new ApiClientError(fallbackMessage || "无法连接 API 服务", {
    code: "API_UNAVAILABLE",
    cause: error,
  });
}

function notifyUnauthorized(requestToken, error) {
  if (!requestToken || getApiAccessToken() !== requestToken) return;
  clearApiAccessToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail: error }));
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function normalizeTimeout(value, fallback) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? timeout : fallback;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export {
  API_ACCESS_TOKEN_KEY,
  API_UNAUTHORIZED_EVENT,
  ApiClientError,
  apiRequest,
  clearApiAccessToken,
  configureApiClient,
  getApiAccessToken,
  getApiBaseUrl,
  isApiRequestUrl,
  setApiAccessToken,
};

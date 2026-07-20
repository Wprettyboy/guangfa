import { randomUUID } from "node:crypto";
import { createAuthenticator } from "./auth.js";
import { ApiError, normalizeApiError } from "./errors.js";
import { readJsonBody, sendBuffer, sendJson } from "./http.js";
import { buildOpenApiDocument, buildRouteList } from "./openapi.js";
import { createRateLimiter } from "./rate-limit.js";
import { findRoutesByPath, getRoutes } from "./registry.js";
import { normalizeSchema, validateSchema } from "./schema.js";

function createApiMiddleware({
  apiPrefix = "/api",
  auth,
  logger = defaultLogger,
  metaRoles = ["viewer"],
  notFoundPrefixes = [],
  rateLimit,
} = {}) {
  const authenticator = createAuthenticator(auth);
  const limiter = createRateLimiter(rateLimit);

  return async function handleRegisteredApi(request, response, next) {
    let url;
    try {
      url = new URL(request.url || "/", "http://local");
    } catch (error) {
      if (!looksLikeApiRequest(request.url, apiPrefix, notFoundPrefixes)) {
        next?.();
        return;
      }
      const requestId = getRequestId(request);
      prepareResponse(response, requestId);
      sendApiError(response, new ApiError(400, "INVALID_URL", "请求 URL 格式错误", { cause: error }), requestId);
      return;
    }

    if (!isManagedPath(url.pathname, apiPrefix, notFoundPrefixes)) {
      next?.();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const requestId = getRequestId(request);
    const method = String(request.method || "GET").toUpperCase();
    let principal = null;
    let routeId = null;
    let caughtError = null;
    prepareResponse(response, requestId);

    try {
      const metaRoute = getMetaRoute(url.pathname, apiPrefix, metaRoles);
      if (metaRoute) {
        routeId = metaRoute.id;
        assertAllowedMethod(method, ["GET"]);
        principal = authenticateAndAuthorize(authenticator, request, metaRoute);
        limiter.consume({ principal, request, response, route: metaRoute });
        if (metaRoute.id === "api.meta.routes") {
          sendJson(response, 200, buildRouteList(getRoutes(), { pathPrefix: "/api/v1" }), { head: method === "HEAD" });
        } else {
          sendJson(response, 200, buildOpenApiDocument(getRoutes(), {
            auth: authenticator.describe(),
            pathPrefix: "/api/v1",
          }), { head: method === "HEAD" });
        }
        return;
      }

      // Matching stays inside the error boundary because decoding a path parameter can fail.
      const pathMatches = findRoutesByPath(url.pathname);
      if (!pathMatches.length) throw new ApiError(404, "NOT_FOUND", "接口不存在");
      const effectiveMethod = method === "HEAD" ? "GET" : method;
      const match = pathMatches.find((item) => item.route.method === effectiveMethod);
      if (!match) assertAllowedMethod(method, pathMatches.map((item) => item.route.method));

      const { route, params } = match;
      routeId = route.id;
      principal = authenticateAndAuthorize(authenticator, request, route);
      request.principal = principal;
      limiter.consume({ principal, request, response, route });

      validateQuery(route.query, url.searchParams);
      validateHeaders(route.headers, request.headers);
      const body = await readRequestBody(request, route);
      const result = await route.handler({
        body,
        params,
        principal,
        query: url.searchParams,
        request,
        requestId,
        response,
        url,
      });
      if (response.writableEnded) return;
      if (result?.kind === "buffer") {
        sendBuffer(response, result, { head: method === "HEAD" });
        return;
      }
      applyResponseHeaders(response, result?.headers);
      sendJson(response, normalizeSuccessStatus(result?.statusCode), result?.body ?? result, { head: method === "HEAD" });
    } catch (error) {
      caughtError = error;
      const apiError = normalizeApiError(error);
      if (!response.writableEnded && !response.headersSent) sendApiError(response, apiError, requestId);
      logSafely(logger, "error", {
        event: "api_error",
        requestId,
        method,
        path: url.pathname,
        routeId,
        principalId: principal?.id || null,
        statusCode: apiError.statusCode,
        code: apiError.code,
        error: {
          name: error?.name || "Error",
          message: error?.message || String(error),
          stack: error?.stack,
        },
      });
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logSafely(logger, "info", {
        event: "api_request_complete",
        requestId,
        method,
        path: url.pathname,
        routeId,
        principalId: principal?.id || null,
        roles: principal?.roles || [],
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
        failed: Boolean(caughtError),
      });
    }
  };
}

async function readRequestBody(request, route) {
  if (route.body) {
    assertContentType(request, asArray(route.contentTypes || "application/json"));
    const body = await readJsonBody(request, { limitBytes: route.bodyLimitBytes });
    return validateSchema(route.body, body);
  }

  if (route.requestBody) {
    const descriptor = typeof route.requestBody === "object" ? route.requestBody : { schema: route.requestBody };
    const contentTypes = asArray(descriptor.contentTypes || descriptor.contentType || "application/octet-stream");
    assertContentType(request, contentTypes);
    if (descriptor.parse === "json") {
      const body = await readJsonBody(request, { limitBytes: route.bodyLimitBytes });
      return validateSchema(descriptor.schema || "object", body);
    }
  }
  return {};
}

function assertContentType(request, allowedContentTypes) {
  const received = String(request.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  const allowed = allowedContentTypes.map((value) => String(value).toLowerCase());
  if (!received || !allowed.some((expected) => contentTypeMatches(received, expected))) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "请求 Content-Type 不受支持", {
      details: [{ path: "headers.content-type", message: `允许：${allowed.join(", ")}` }],
    });
  }
}

function contentTypeMatches(received, expected) {
  if (expected === "*/*" || received === expected) return true;
  if (expected.endsWith("/*")) return received.startsWith(expected.slice(0, -1));
  return expected === "application/json" && received.startsWith("application/") && received.endsWith("+json");
}

function validateQuery(shape, query) {
  if (!shape) return;
  const issues = [];
  Object.entries(shape).forEach(([rawName, schema]) => {
    const name = rawName.replace(/\?$/, "");
    const normalized = normalizeSchema(schema);
    const required = normalized.required === true || !(rawName.endsWith("?") || normalized.optional);
    const values = query.getAll(name);
    if (!values.length) {
      if (required) issues.push({ path: `query.${name}`, message: "缺少必填值" });
      return;
    }
    values.forEach((value) => {
      issues.push(...validateParameterValue(schema, normalized, value, `query.${name}`));
    });
  });
  if (issues.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败", { details: issues });
  }
}

function validateHeaders(shape, headers = {}) {
  if (!shape) return;
  const values = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value[0] : value]));
  const issues = [];
  Object.entries(shape).forEach(([rawName, schema]) => {
    const name = rawName.replace(/\?$/, "");
    const normalized = normalizeSchema(schema);
    const required = normalized.required === true || !(rawName.endsWith("?") || normalized.optional);
    const value = values.get(name.toLowerCase());
    if (value == null || value === "") {
      if (required && Number(normalized.missingStatusCode) === 428) {
        throw new ApiError(428, "PRECONDITION_REQUIRED", `缺少 ${name} 请求头`);
      }
      if (required) issues.push({ path: `headers.${name.toLowerCase()}`, message: "缺少必填值" });
      return;
    }
    issues.push(...validateParameterValue(schema, normalized, String(value), `headers.${name.toLowerCase()}`));
  });
  if (issues.length) throw new ApiError(400, "VALIDATION_ERROR", "请求头校验失败", { details: issues });
}

function validateParameterValue(schema, normalized, value, path) {
  if (normalized.type !== "string") {
    return queryValueMatches(normalized, value) ? [] : [{ path, message: `应为 ${normalized.type}` }];
  }
  try {
    validateSchema(schema, value, { path });
    return [];
  } catch (error) {
    if (error instanceof ApiError && Array.isArray(error.details)) return error.details;
    throw error;
  }
}

function queryValueMatches(schema, value) {
  if (schema.enum && !schema.enum.map(String).includes(value)) return false;
  if (["string", "any", "array"].includes(schema.type)) return true;
  if (schema.type === "number") return value.trim() !== "" && Number.isFinite(Number(value));
  if (schema.type === "integer") return /^-?\d+$/.test(value);
  if (schema.type === "boolean") return ["true", "false"].includes(value.toLowerCase());
  return false;
}

function authenticateAndAuthorize(authenticator, request, route) {
  const principal = authenticator.authenticate(request, route);
  authenticator.authorize(principal, route);
  return principal;
}

function assertAllowedMethod(method, allowedMethods) {
  const expanded = allowedMethods.includes("GET") ? [...allowedMethods, "HEAD"] : allowedMethods;
  const allowed = [...new Set(expanded)].sort();
  if (allowed.includes(method)) return;
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "请求方法不允许", {
    headers: { Allow: allowed.join(", ") },
  });
}

function applyResponseHeaders(response, headers) {
  Object.entries(headers || {}).forEach(([name, value]) => {
    if (value != null) response.setHeader(name, value);
  });
}

function sendApiError(response, error, requestId) {
  Object.entries(error.headers || {}).forEach(([name, value]) => response.setHeader(name, value));
  sendJson(response, error.statusCode, {
    error: error.message,
    code: error.code,
    message: error.message,
    requestId,
    ...(error.details ? { details: error.details } : {}),
  });
}

function getMetaRoute(pathname, apiPrefix, roles) {
  const prefix = String(apiPrefix).replace(/\/$/, "");
  if (pathname === `${prefix}/_meta/routes`) return { id: "api.meta.routes", roles };
  if (pathname === `${prefix}/_meta/openapi.json`) return { id: "api.meta.openapi", roles };
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function prepareResponse(response, requestId) {
  response.setHeader("X-Request-ID", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  response.setHeader("Cache-Control", "no-store");
}

function getRequestId(request) {
  const candidate = String(request.headers?.["x-request-id"] || "").trim();
  return candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)
    ? candidate
    : randomUUID();
}

function normalizeSuccessStatus(value) {
  const statusCode = Number(value || 200);
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 399 ? statusCode : 200;
}

function isManagedPath(pathname, apiPrefix, additionalPrefixes) {
  return matchesPrefix(pathname, apiPrefix) || additionalPrefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

function looksLikeApiRequest(requestUrl, apiPrefix, additionalPrefixes) {
  const value = String(requestUrl || "");
  return value.startsWith(apiPrefix) || additionalPrefixes.some((prefix) => value.startsWith(prefix));
}

function matchesPrefix(pathname, prefix) {
  const normalized = String(prefix || "").replace(/\/$/, "");
  return Boolean(normalized) && (pathname === normalized || pathname.startsWith(`${normalized}/`));
}

function logSafely(logger, level, record) {
  try {
    logger?.[level]?.(record);
  } catch {
    // Logging must not change the API result.
  }
}

const defaultLogger = {
  info(record) {
    console.info(JSON.stringify(record));
  },
  error(record) {
    console.error(JSON.stringify(record));
  },
};

export { createApiMiddleware };

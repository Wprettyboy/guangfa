import { timingSafeEqual } from "node:crypto";
import { verifyOnlyOfficeJwt } from "../office.js";
import { ApiError } from "./errors.js";

const validRoles = new Set(["viewer", "editor", "admin", "service"]);
const principalIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._@:+|=-]{0,127}$/u;

function createAuthenticator(options = {}) {
  const environment = String(options.environment || process.env.NODE_ENV || "development").toLowerCase();
  const production = environment === "production";
  const mode = String(options.mode || process.env.API_AUTH_MODE || (production ? "required" : "disabled")).toLowerCase();
  if (!new Set(["disabled", "required"]).has(mode)) {
    throw new Error(`不支持的 API_AUTH_MODE：${mode}`);
  }
  if (production && mode !== "required") {
    throw new Error("生产环境必须启用 API 身份认证");
  }

  const { bearerTokens, apiKeys } = mode === "required"
    ? readAuthenticationCredentials({
      bearerTokens: options.bearerTokens,
      apiKeys: options.apiKeys,
      minimumSecretBytes: production ? 32 : 1,
    })
    : { bearerTokens: [], apiKeys: [] };
  if (mode === "required" && bearerTokens.length + apiKeys.length === 0) {
    throw new Error("API 身份认证已启用，但没有配置 Bearer Token 或 API Key");
  }

  const apiKeyHeader = String(options.apiKeyHeader || "x-api-key").toLowerCase();
  const localPrincipal = freezePrincipal({
    id: "local-development",
    roles: ["admin"],
    authentication: "disabled",
  });
  const anonymousPrincipal = freezePrincipal({ id: "anonymous", roles: [], authentication: "anonymous" });
  const publicPrincipal = freezePrincipal({ id: "anonymous", roles: [], authentication: "public" });

  return {
    mode,
    authenticate(request, route) {
      if (route?.auth === false) return publicPrincipal;
      if (mode === "disabled") return localPrincipal;

      const authorization = readHeader(request, "authorization");
      const apiKey = readHeader(request, apiKeyHeader);
      if (authorization && apiKey) {
        throw new ApiError(400, "MULTIPLE_CREDENTIALS", "一次请求只能使用一种认证凭证");
      }
      if (!authorization && !apiKey && route?.auth === "optional") return anonymousPrincipal;

      let credential = null;
      let candidates = null;
      let authentication = null;
      if (authorization) {
        const match = /^Bearer\s+(.+)$/i.exec(authorization);
        if (!match) throw unauthorizedError();
        credential = match[1];
        candidates = bearerTokens;
        authentication = "bearer";
      } else if (apiKey) {
        credential = apiKey;
        candidates = apiKeys;
        authentication = "api-key";
      } else {
        throw unauthorizedError();
      }

      const matched = candidates.find((item) => secretsEqual(item.secret, credential));
      if (!matched) {
        if (
          authentication === "bearer"
          && route?.auth === "optional"
          && hasResourceAccessToken(request)
          && isOnlyOfficeBearer(credential)
        ) {
          return anonymousPrincipal;
        }
        throw unauthorizedError();
      }
      return freezePrincipal({ ...matched.principal, authentication });
    },
    authorize(principal, route) {
      if (route?.auth === false) return;
      if (route?.auth === "optional" && principal?.authentication === "anonymous") return;
      const requiredRoles = Array.isArray(route?.roles) ? route.roles : [];
      if (!requiredRoles.length || requiredRoles.some((role) => principalHasRole(principal, role))) return;
      throw new ApiError(403, "FORBIDDEN", "当前身份没有接口访问权限");
    },
    describe() {
      return { mode, apiKeyHeader };
    },
  };
}

function hasResourceAccessToken(request) {
  try {
    return Boolean(new URL(String(request?.url || ""), "http://local").searchParams.get("accessToken"));
  } catch {
    return false;
  }
}

function isOnlyOfficeBearer(token) {
  try {
    verifyOnlyOfficeJwt(token);
    return true;
  } catch {
    return false;
  }
}

function unauthorizedError() {
  return new ApiError(401, "UNAUTHORIZED", "缺少或使用了无效的 API 认证凭证", {
    headers: { "WWW-Authenticate": 'Bearer realm="api"' },
  });
}

function principalHasRole(principal, requiredRole) {
  const roles = new Set(principal?.roles || []);
  if (roles.has("admin")) return true;
  if (requiredRole === "viewer" && roles.has("editor")) return true;
  return roles.has(requiredRole);
}

function normalizeCredentials(source, secretName, { minimumSecretBytes = 1 } = {}) {
  if (!source) return [];
  const entries = source instanceof Map
    ? [...source.entries()].map(([secret, principal]) => ({ secret, principal }))
    : Array.isArray(source)
      ? source.map((item) => ({
        secret: item?.[secretName] ?? item?.secret,
        principal: item?.principal || item,
      }))
      : Object.entries(source).map(([secret, principal]) => ({ secret, principal }));

  const seen = new Set();
  return entries.map(({ secret, principal }, index) => {
    const normalizedSecret = String(secret || "");
    if (!normalizedSecret) throw new Error(`第 ${index + 1} 个 API 认证凭证为空`);
    if (Buffer.byteLength(normalizedSecret) < minimumSecretBytes) {
      throw new Error(`第 ${index + 1} 个 API 认证凭证至少需要 ${minimumSecretBytes} 字节`);
    }
    if (seen.has(normalizedSecret)) throw new Error("API 认证凭证重复");
    seen.add(normalizedSecret);
    return { secret: normalizedSecret, principal: normalizePrincipal(principal, index) };
  });
}

function normalizePrincipal(value, index) {
  const source = typeof value === "string" ? { id: value } : value || {};
  const id = String(source.id || source.principalId || "").trim();
  if (!id) throw new Error(`第 ${index + 1} 个 API 认证身份缺少 id`);
  if (!principalIdPattern.test(id) || Buffer.byteLength(id, "utf8") > 256) {
    throw new Error(`API 身份 ${id} 的 id 格式无效`);
  }
  const roles = Array.isArray(source.roles) && source.roles.length ? [...new Set(source.roles)] : ["viewer"];
  roles.forEach((role) => {
    if (!validRoles.has(role)) throw new Error(`API 身份 ${id} 使用了无效角色：${role}`);
  });
  return { id, roles };
}

function freezePrincipal(principal) {
  return Object.freeze({ ...principal, roles: Object.freeze([...(principal.roles || [])]) });
}

function readCredentialEnvironment(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} 必须是有效 JSON`, { cause: error });
  }
}

function readAuthenticationCredentials(options = {}) {
  const minimumSecretBytes = options.minimumSecretBytes ?? 1;
  return {
    bearerTokens: normalizeCredentials(
      options.bearerTokens ?? readCredentialEnvironment("API_AUTH_BEARER_TOKENS"),
      "token",
      { minimumSecretBytes },
    ),
    apiKeys: normalizeCredentials(
      options.apiKeys ?? readCredentialEnvironment("API_AUTH_API_KEYS"),
      "key",
      { minimumSecretBytes },
    ),
  };
}

function readHeader(request, name) {
  const value = request?.headers?.[String(name).toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "").trim();
}

function secretsEqual(expected, received) {
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(received));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export { createAuthenticator, readAuthenticationCredentials, validRoles };

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";

const defaultTtlSeconds = 10 * 60;
const defaultMaxTtlSeconds = 30 * 60;
const absoluteMaxTtlSeconds = 60 * 60;
const clockSkewSeconds = 30;
const capabilityQueryName = "accessToken";
const capabilityScopes = Object.freeze({
  knowledgeDocumentFile: "knowledge.documents.file",
  knowledgeImageDocx: "knowledge.images.docx",
  knowledgeImageFile: "knowledge.images.file",
  knowledgeTableDocx: "knowledge.tables.docx",
  solutionPlantumlDocx: "ai.solution.plantumlImage.docx",
  solutionPlantumlFile: "ai.solution.plantumlImage.file",
});

function createCapabilityService(options = {}) {
  const environment = String(options.environment || process.env.API_DEPLOYMENT_MODE || process.env.NODE_ENV || "development").toLowerCase();
  const production = environment === "production"
    || String(process.env.API_DEPLOYMENT_MODE || "").toLowerCase() === "production"
    || String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const configuredSecret = options.secret ?? process.env.API_CAPABILITY_SECRET;
  if (production && !configuredSecret) {
    throw new Error("生产环境必须配置 API_CAPABILITY_SECRET");
  }

  const secret = configuredSecret == null ? randomBytes(32) : toSecretBuffer(configuredSecret);
  if (secret.byteLength < 32) throw new Error("API_CAPABILITY_SECRET 至少需要 32 字节");

  const maxTtlSeconds = readTtl(
    options.maxTtlSeconds ?? process.env.API_CAPABILITY_MAX_TTL_SECONDS,
    defaultMaxTtlSeconds,
    "API_CAPABILITY_MAX_TTL_SECONDS",
  );
  if (maxTtlSeconds > absoluteMaxTtlSeconds) {
    throw new Error(`API_CAPABILITY_MAX_TTL_SECONDS 不能超过 ${absoluteMaxTtlSeconds} 秒`);
  }
  const ttlSeconds = readTtl(
    options.ttlSeconds ?? process.env.API_CAPABILITY_TTL_SECONDS,
    defaultTtlSeconds,
    "API_CAPABILITY_TTL_SECONDS",
  );
  if (ttlSeconds > maxTtlSeconds) {
    throw new Error("API_CAPABILITY_TTL_SECONDS 不能超过 API_CAPABILITY_MAX_TTL_SECONDS");
  }

  const now = typeof options.now === "function"
    ? options.now
    : () => Math.floor(Date.now() / 1000);

  function issue({ scope, resource, ttlSeconds: requestedTtl = ttlSeconds } = {}) {
    const normalizedScope = readClaim(scope, "scope");
    const normalizedResource = readClaim(resource, "resource");
    const lifetime = readTtl(requestedTtl, ttlSeconds, "能力票据 TTL");
    if (lifetime > maxTtlSeconds) throw new Error(`能力票据 TTL 不能超过 ${maxTtlSeconds} 秒`);
    const issuedAt = readCurrentTime(now);
    const encodedPayload = Buffer.from(JSON.stringify({
      scope: normalizedScope,
      resource: normalizedResource,
      iat: issuedAt,
      exp: issuedAt + lifetime,
    })).toString("base64url");
    return `${encodedPayload}.${sign(encodedPayload, secret).toString("base64url")}`;
  }

  function verify(token, { scope, resource } = {}) {
    const expectedScope = readClaim(scope, "scope");
    const expectedResource = readClaim(resource, "resource");
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 8192) throw invalidCapability();
    const [encodedPayload, encodedSignature] = parts;

    const expectedSignature = sign(encodedPayload, secret);
    const receivedSignature = decodeBase64Url(encodedSignature);
    const comparableSignature = Buffer.alloc(expectedSignature.byteLength);
    receivedSignature.copy(comparableSignature, 0, 0, expectedSignature.byteLength);
    const signatureMatches = timingSafeEqual(expectedSignature, comparableSignature)
      && receivedSignature.byteLength === expectedSignature.byteLength
      && receivedSignature.toString("base64url") === encodedSignature;
    if (!signatureMatches) throw invalidCapability();

    const payloadBuffer = decodeBase64Url(encodedPayload);
    if (payloadBuffer.toString("base64url") !== encodedPayload) throw invalidCapability();
    let payload;
    try {
      payload = JSON.parse(payloadBuffer.toString("utf8"));
    } catch (error) {
      throw invalidCapability(error);
    }

    if (!isValidPayload(payload) || payload.exp - payload.iat > maxTtlSeconds) throw invalidCapability();
    const currentTime = readCurrentTime(now);
    if (payload.iat > currentTime + clockSkewSeconds) throw invalidCapability();
    if (payload.exp <= currentTime) {
      throw new ApiError(401, "CAPABILITY_EXPIRED", "资源访问票据已过期");
    }
    if (payload.scope !== expectedScope || payload.resource !== expectedResource) {
      throw new ApiError(403, "CAPABILITY_FORBIDDEN", "资源访问票据与当前资源不匹配");
    }
    return payload;
  }

  function signUrl(value, { scope, resource, ttlSeconds: requestedTtl } = {}) {
    const parsed = parseUrl(value);
    const token = issue({
      scope,
      resource: resource || parsed.pathname,
      ...(requestedTtl == null ? {} : { ttlSeconds: requestedTtl }),
    });
    parsed.searchParams.set(capabilityQueryName, token);
    return isAbsoluteUrl(value)
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  return Object.freeze({ issue, maxTtlSeconds, signUrl, ttlSeconds, verify });
}

let defaultCapabilityService;

function getDefaultCapabilityService() {
  if (!defaultCapabilityService) defaultCapabilityService = createCapabilityService();
  return defaultCapabilityService;
}

function initializeCapabilityService(options = {}) {
  defaultCapabilityService = createCapabilityService(options);
  return defaultCapabilityService;
}

function signCapabilityUrl(value, options) {
  return getDefaultCapabilityService().signUrl(value, options);
}

function verifyCapabilityToken(token, options) {
  return getDefaultCapabilityService().verify(token, options);
}

function assertCapabilityAccess({ principal, accessToken, scope, resource }) {
  if (principal?.authentication && principal.authentication !== "anonymous" && principal.authentication !== "public") {
    return principal;
  }
  if (!accessToken) {
    throw new ApiError(401, "CAPABILITY_REQUIRED", "缺少资源访问票据");
  }
  verifyCapabilityToken(accessToken, { scope, resource });
  return principal;
}

function buildCapabilityResource(...parts) {
  if (!parts.length) throw new Error("能力票据资源不能为空");
  return parts.map((part) => encodeURIComponent(readClaim(part, "resource"))).join(":");
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ""))) return Buffer.alloc(0);
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return Buffer.alloc(0);
  }
}

function isValidPayload(payload) {
  return payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof payload.scope === "string"
    && typeof payload.resource === "string"
    && Number.isSafeInteger(payload.iat)
    && Number.isSafeInteger(payload.exp)
    && payload.iat >= 0
    && payload.exp > payload.iat;
}

function readClaim(value, name) {
  if (!["string", "number"].includes(typeof value)) throw new Error(`能力票据 ${name} 无效`);
  const normalized = String(value ?? "");
  if (!normalized || normalized.length > 2048) throw new Error(`能力票据 ${name} 无效`);
  return normalized;
}

function readCurrentTime(now) {
  const value = Number(now());
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("能力票据时钟无效");
  return value;
}

function readTtl(value, fallback, name) {
  const normalized = value == null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(`${name} 必须是正整数秒数`);
  return normalized;
}

function toSecretBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  return Buffer.from(String(value), "utf8");
}

function parseUrl(value) {
  try {
    return new URL(String(value || ""), "http://capability.local");
  } catch (error) {
    throw new Error("能力票据 URL 无效", { cause: error });
  }
}

function isAbsoluteUrl(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(String(value || ""));
}

function invalidCapability(cause) {
  return new ApiError(401, "INVALID_CAPABILITY", "资源访问票据无效", { cause });
}

export {
  assertCapabilityAccess,
  buildCapabilityResource,
  capabilityQueryName,
  capabilityScopes,
  createCapabilityService,
  initializeCapabilityService,
  signCapabilityUrl,
  verifyCapabilityToken,
};

import { ApiError } from "./errors.js";

function createRateLimiter(options = {}) {
  const environment = String(options.environment || process.env.API_DEPLOYMENT_MODE || process.env.NODE_ENV || "development").toLowerCase();
  const enabled = options.enabled ?? readBoolean(process.env.API_RATE_LIMIT_ENABLED, environment === "production");
  const windowMs = readPositiveInteger(options.windowMs ?? process.env.API_RATE_LIMIT_WINDOW_MS, 60000);
  const maxBuckets = readPositiveInteger(options.maxBuckets ?? process.env.API_RATE_LIMIT_MAX_BUCKETS, 10000);
  const limits = {
    read: readPositiveInteger(options.read ?? process.env.API_RATE_LIMIT_READ, 300),
    write: readPositiveInteger(options.write ?? process.env.API_RATE_LIMIT_WRITE, 120),
    ai: readPositiveInteger(options.ai ?? process.env.API_RATE_LIMIT_AI, 30),
    upload: readPositiveInteger(options.upload ?? process.env.API_RATE_LIMIT_UPLOAD, 20),
  };
  const buckets = new Map();

  return {
    enabled,
    consume({ principal, request, response, route }) {
      if (!enabled || route?.rateLimit === false) return;
      const policy = resolvePolicy(route, limits, windowMs);
      const now = Date.now();
      if (buckets.size >= maxBuckets) pruneBuckets(buckets, now, maxBuckets);
      const identity = resolveIdentity(principal, request);
      const key = `${identity}:${route?.id || "unknown"}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + policy.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const remaining = Math.max(0, policy.max - bucket.count);
      const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("RateLimit-Limit", policy.max);
      response.setHeader("RateLimit-Remaining", remaining);
      response.setHeader("RateLimit-Reset", resetSeconds);
      if (bucket.count > policy.max) {
        throw new ApiError(429, "TOO_MANY_REQUESTS", "请求过于频繁，请稍后重试", {
          headers: { "Retry-After": String(resetSeconds) },
        });
      }
    },
  };
}

function resolveIdentity(principal, request) {
  if (principal?.id && !["anonymous", "public"].includes(principal.authentication)) {
    return `principal:${principal.id}`;
  }
  const trustProxy = String(process.env.API_TRUST_PROXY || "false").toLowerCase() === "true";
  const forwarded = trustProxy ? readHeader(request, "x-forwarded-for").split(",", 1)[0].trim() : "";
  return `network:${forwarded || request.socket?.remoteAddress || "unknown"}`;
}

function readHeader(request, name) {
  const value = request?.headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

function resolvePolicy(route, defaults, defaultWindowMs) {
  if (route?.rateLimit && typeof route.rateLimit === "object") {
    return {
      max: readPositiveInteger(route.rateLimit.max, defaults.write),
      windowMs: readPositiveInteger(route.rateLimit.windowMs, defaultWindowMs),
    };
  }
  const tags = new Set(route?.tags || []);
  if (tags.has("ai")) return { max: defaults.ai, windowMs: defaultWindowMs };
  if (route?.requestBody || Number(route?.bodyLimitBytes) > 10 * 1024 * 1024) {
    return { max: defaults.upload, windowMs: defaultWindowMs };
  }
  if (["GET", "HEAD"].includes(route?.method)) return { max: defaults.read, windowMs: defaultWindowMs };
  return { max: defaults.write, windowMs: defaultWindowMs };
}

function pruneBuckets(buckets, now, maxBuckets) {
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
  if (buckets.size < maxBuckets) return;
  const removeCount = Math.max(1, Math.ceil(maxBuckets / 10));
  [...buckets.entries()]
    .sort((left, right) => left[1].resetAt - right[1].resetAt)
    .slice(0, removeCount)
    .forEach(([key]) => buckets.delete(key));
}

function readPositiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export { createRateLimiter };

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApiGateway } from "../server/api/gateway.js";
import { createRateLimiter } from "../server/api/rate-limit.js";

test("the gateway exposes a canonical v1 API and keeps the legacy path compatible", async (context) => {
  const api = await startGateway();
  context.after(api.close);

  const canonical = await fetch(`${api.url}/api/v1/_meta/openapi.json`);
  assert.equal(canonical.status, 200);
  const document = await canonical.json();
  assert.ok(Object.keys(document.paths).length > 0);
  assert.ok(Object.keys(document.paths).every((pathname) => pathname.startsWith("/api/v1/")));

  const legacy = await fetch(`${api.url}/api/_meta/routes`);
  assert.equal(legacy.status, 200);
  assert.match(legacy.headers.get("link"), /<\/api\/v1\/_meta\/routes>/);
});

test("the gateway validates CORS origins and preflight headers", async (context) => {
  const api = await startGateway({
    deploymentMode: "production",
    allowedOrigins: ["https://office.example.test"],
  });
  context.after(api.close);

  const forbidden = await fetch(`${api.url}/api/v1/_meta/routes`, {
    headers: { Origin: "https://attacker.example.test" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "ORIGIN_FORBIDDEN");

  const preflight = await fetch(`${api.url}/api/v1/templates`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://office.example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,if-match",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://office.example.test");
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
  assert.match(preflight.headers.get("access-control-allow-headers"), /If-Match/);
});

test("the in-process limiter isolates principals and returns retry metadata", () => {
  const limiter = createRateLimiter({ enabled: true, read: 2, windowMs: 60000 });
  const headers = new Map();
  const response = { setHeader: (name, value) => headers.set(name, String(value)) };
  const request = { socket: { remoteAddress: "127.0.0.1" } };
  const route = { id: "test.read", method: "GET", tags: [] };

  limiter.consume({ principal: { id: "alice" }, request, response, route });
  limiter.consume({ principal: { id: "alice" }, request, response, route });
  assert.throws(
    () => limiter.consume({ principal: { id: "alice" }, request, response, route }),
    (error) => error.statusCode === 429 && Boolean(error.headers["Retry-After"]),
  );
  assert.doesNotThrow(() => limiter.consume({ principal: { id: "bob" }, request, response, route }));
  assert.equal(headers.get("RateLimit-Limit"), "2");
});

test("anonymous rate limits are isolated by client address", () => {
  const limiter = createRateLimiter({ enabled: true, read: 1, windowMs: 60000 });
  const response = { setHeader() {} };
  const route = { id: "test.public-read", method: "GET", tags: [] };
  const principal = { id: "anonymous", roles: [], authentication: "anonymous" };

  limiter.consume({ principal, request: { headers: {}, socket: { remoteAddress: "192.0.2.1" } }, response, route });
  assert.throws(
    () => limiter.consume({ principal, request: { headers: {}, socket: { remoteAddress: "192.0.2.1" } }, response, route }),
    (error) => error.statusCode === 429,
  );
  assert.doesNotThrow(() => limiter.consume({
    principal,
    request: { headers: {}, socket: { remoteAddress: "192.0.2.2" } },
    response,
    route,
  }));
});

async function startGateway(options = {}) {
  const gateway = createApiGateway({
    deploymentMode: "development",
    api: {
      auth: { mode: "disabled", environment: "development" },
      logger: { info() {}, error() {} },
      rateLimit: { enabled: false },
    },
    ...options,
  });
  const server = createServer((request, response) => gateway(request, response, () => {
    response.statusCode = 599;
    response.end();
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

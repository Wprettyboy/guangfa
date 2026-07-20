import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  assertCapabilityAccess,
  buildCapabilityResource,
  capabilityScopes,
  createCapabilityService,
  signCapabilityUrl,
} from "../server/api/capability.js";
import { defineRoute } from "../server/api/registry.js";
import { createApiMiddleware } from "../server/api/router.js";
import { signOnlyOfficeJwt } from "../server/office.js";

const secret = "capability-test-secret-is-at-least-32-bytes";

test("capability tokens contain bounded signed claims and canonical URLs", () => {
  const now = 1_700_000_000;
  const service = createCapabilityService({ secret, now: () => now, ttlSeconds: 60, maxTtlSeconds: 120 });
  const scope = capabilityScopes.knowledgeImageFile;
  const resource = buildCapabilityResource("knowledge-image", "doc/一", 2, "file");
  const token = service.issue({ scope, resource });
  const payload = service.verify(token, { scope, resource });

  assert.deepEqual(payload, { scope, resource, iat: now, exp: now + 60 });
  const url = service.signUrl("/api/v1/knowledge-images/doc/2/file?size=full", { scope, resource });
  const parsed = new URL(url, "http://local");
  assert.equal(parsed.pathname, "/api/v1/knowledge-images/doc/2/file");
  assert.equal(parsed.searchParams.get("size"), "full");
  assert.equal(service.verify(parsed.searchParams.get("accessToken"), { scope, resource }).exp, now + 60);
  assert.equal(url.includes("Bearer"), false);
  assert.equal(buildCapabilityResource("knowledge-image", "doc-a", 0, "file"), "knowledge-image:doc-a:0:file");
});

test("capability verification rejects expiry, tampering, excessive TTL and cross-resource reuse", () => {
  let now = 1_700_000_000;
  const service = createCapabilityService({ secret, now: () => now, ttlSeconds: 60, maxTtlSeconds: 120 });
  const scope = capabilityScopes.knowledgeImageFile;
  const resource = buildCapabilityResource("knowledge-image", "doc-a", 1, "file");
  const token = service.issue({ scope, resource });

  assert.throws(
    () => service.verify(token, { scope, resource: buildCapabilityResource("knowledge-image", "doc-b", 1, "file") }),
    (error) => error.code === "CAPABILITY_FORBIDDEN",
  );
  assert.throws(
    () => service.verify(token, { scope: capabilityScopes.knowledgeImageDocx, resource }),
    (error) => error.code === "CAPABILITY_FORBIDDEN",
  );

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => service.verify(tampered, { scope, resource }), (error) => error.code === "INVALID_CAPABILITY");
  assert.throws(() => service.issue({ scope, resource, ttlSeconds: 121 }), /不能超过 120 秒/);

  const longerIssuer = createCapabilityService({ secret, now: () => now, ttlSeconds: 150, maxTtlSeconds: 180 });
  const excessiveToken = longerIssuer.issue({ scope, resource });
  assert.throws(() => service.verify(excessiveToken, { scope, resource }), (error) => error.code === "INVALID_CAPABILITY");

  now += 60;
  assert.throws(() => service.verify(token, { scope, resource }), (error) => error.code === "CAPABILITY_EXPIRED");
});

test("production capability configuration fails closed", () => {
  assert.throws(() => createCapabilityService({ environment: "production", secret: "" }), /必须配置/);
  assert.throws(() => createCapabilityService({ environment: "production", secret: "too-short" }), /至少需要 32 字节/);
  assert.throws(() => createCapabilityService({ secret, maxTtlSeconds: 3601 }), /不能超过 3600 秒/);
});

test("optional authentication accepts either an authorized principal or an exact capability", async (context) => {
  const prefix = `/api/__capability-test-${process.pid}`;
  defineRoute({
    id: `capability.test.asset.${process.pid}`,
    method: "GET",
    path: `${prefix}/:assetId`,
    auth: "optional",
    roles: ["viewer"],
    query: { "accessToken?": { type: "string", maxLength: 4096 } },
    handler: ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get("accessToken"),
        scope: "capability.test.asset",
        resource: buildCapabilityResource("test-asset", params.assetId),
      });
      return { assetId: params.assetId, authentication: principal.authentication };
    },
  });

  const api = await startApi({
    auth: {
      mode: "required",
      bearerTokens: {
        "viewer-token": { id: "reader", roles: ["viewer"] },
        "service-token": { id: "service", roles: ["service"] },
      },
    },
  });
  context.after(api.close);

  const missing = await fetch(`${api.url}${prefix}/asset-a`);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "CAPABILITY_REQUIRED");

  const signedPath = signCapabilityUrl(`${prefix}/asset-a`, {
    scope: "capability.test.asset",
    resource: buildCapabilityResource("test-asset", "asset-a"),
  });
  const anonymous = await fetch(`${api.url}${signedPath}`);
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { assetId: "asset-a", authentication: "anonymous" });

  const bearer = await fetch(`${api.url}${prefix}/asset-a`, {
    headers: { Authorization: "Bearer viewer-token" },
  });
  assert.equal(bearer.status, 200);
  assert.equal((await bearer.json()).authentication, "bearer");

  const unauthorizedBearer = await fetch(`${api.url}${signedPath}`, {
    headers: { Authorization: "Bearer service-token" },
  });
  assert.equal(unauthorizedBearer.status, 403);
  assert.equal((await unauthorizedBearer.json()).code, "FORBIDDEN");

  const malformedBearer = await fetch(`${api.url}${signedPath}`, {
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert.equal(malformedBearer.status, 401);
  assert.equal((await malformedBearer.json()).code, "UNAUTHORIZED");

  const previousOnlyOfficeSecret = process.env.ONLYOFFICE_JWT_SECRET;
  process.env.ONLYOFFICE_JWT_SECRET = "onlyoffice-outbox-test-secret-longer-than-32-bytes";
  try {
    const outboxToken = signOnlyOfficeJwt({ payload: { url: signedPath } }, 300);
    const documentServer = await fetch(`${api.url}${signedPath}`, {
      headers: { Authorization: `Bearer ${outboxToken}` },
    });
    assert.equal(documentServer.status, 200);
    assert.equal((await documentServer.json()).authentication, "anonymous");
  } finally {
    if (previousOnlyOfficeSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousOnlyOfficeSecret;
  }

  const crossResource = await fetch(`${api.url}${signedPath.replace("asset-a?", "asset-b?")}`);
  assert.equal(crossResource.status, 403);
  assert.equal((await crossResource.json()).code, "CAPABILITY_FORBIDDEN");
});

async function startApi(options = {}) {
  const middleware = createApiMiddleware({ logger: { info() {}, error() {} }, ...options });
  const server = createServer((request, response) => middleware(request, response));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

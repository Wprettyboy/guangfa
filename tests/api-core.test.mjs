import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { createAuthenticator } from "../server/api/auth.js";
import { readJsonBody } from "../server/api/http.js";
import { buildOpenApiDocument } from "../server/api/openapi.js";
import { defineRoute } from "../server/api/registry.js";
import { createApiMiddleware } from "../server/api/router.js";

const testPrefix = "/api/core-contract-test";
const routes = registerTestRoutes();

test("JSON readers preserve UTF-8 split across chunks and enforce byte limits", async () => {
  const encoded = Buffer.from(JSON.stringify({ value: "汉字" }));
  const firstChineseByte = encoded.indexOf(Buffer.from("汉"));
  const request = Readable.from([
    encoded.subarray(0, firstChineseByte + 1),
    encoded.subarray(firstChineseByte + 1),
  ]);
  request.headers = {};

  assert.deepEqual(await readJsonBody(request), { value: "汉字" });

  const oversized = Readable.from([Buffer.from("123"), Buffer.from("456")]);
  oversized.headers = {};
  await assert.rejects(
    readJsonBody(oversized, { limitBytes: 5 }),
    (error) => error.statusCode === 413 && error.code === "PAYLOAD_TOO_LARGE",
  );

  const invalidUtf8 = Readable.from([Buffer.from([0xc3, 0x28])]);
  invalidUtf8.headers = {};
  await assert.rejects(
    readJsonBody(invalidUtf8),
    (error) => error.statusCode === 400 && error.code === "INVALID_JSON",
  );
});

test("the API router returns stable protocol errors and security headers", async (context) => {
  const logs = { info: [], error: [] };
  const api = await startApi({
    logger: {
      info: (record) => logs.info.push(record),
      error: (record) => logs.error.push(record),
    },
  });
  context.after(api.close);

  const unsupported = await fetch(`${api.url}${testPrefix}/echo`, {
    method: "POST",
    body: JSON.stringify({ name: "test" }),
  });
  assert.equal(unsupported.status, 415);
  assertErrorEnvelope(await unsupported.json(), "UNSUPPORTED_MEDIA_TYPE");

  const invalid = await fetch(`${api.url}${testPrefix}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": "contract-request-1" },
    body: JSON.stringify({ name: 42 }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("x-request-id"), "contract-request-1");
  assert.equal(invalid.headers.get("x-content-type-options"), "nosniff");
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const invalidBody = await invalid.json();
  assertErrorEnvelope(invalidBody, "VALIDATION_ERROR");
  assert.equal(invalidBody.details[0].path, "$.name");

  const tooLarge = await fetch(`${api.url}${testPrefix}/small`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "more than twelve bytes" }),
  });
  assert.equal(tooLarge.status, 413);
  assertErrorEnvelope(await tooLarge.json(), "PAYLOAD_TOO_LARGE");

  const wrongMethod = await fetch(`${api.url}${testPrefix}/items/one`, { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");
  assertErrorEnvelope(await wrongMethod.json(), "METHOD_NOT_ALLOWED");

  const malformedPath = await fetch(`${api.url}${testPrefix}/items/%`);
  assert.equal(malformedPath.status, 400);
  assertErrorEnvelope(await malformedPath.json(), "INVALID_PATH_ENCODING");

  const missing = await fetch(`${api.url}/api/not-registered`);
  assert.equal(missing.status, 404);
  assertErrorEnvelope(await missing.json(), "NOT_FOUND");

  const internal = await fetch(`${api.url}${testPrefix}/internal-error`);
  const internalBody = await internal.json();
  assert.equal(internal.status, 500);
  assertErrorEnvelope(internalBody, "INTERNAL_ERROR");
  assert.equal(JSON.stringify(internalBody).includes("private\\secret"), false);
  assert.ok(logs.error.some((record) => record.error.message.includes("private\\secret")));
  assert.ok(logs.info.every((record) => Number.isFinite(record.durationMs)));
});

test("disabled development authentication attaches a local admin principal", async (context) => {
  const api = await startApi();
  context.after(api.close);
  const response = await fetch(`${api.url}${testPrefix}/items/abc`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "abc",
    principalId: "local-development",
    roles: ["admin"],
  });
});

test("required authentication supports Bearer and API keys with role enforcement", async (context) => {
  const api = await startApi({
    auth: {
      mode: "required",
      bearerTokens: {
        "viewer-token": { id: "reader", roles: ["viewer"] },
        "editor-token": { id: "writer", roles: ["editor"] },
      },
      apiKeys: {
        "service-key": { id: "onlyoffice", roles: ["service"] },
      },
    },
  });
  context.after(api.close);

  const missing = await fetch(`${api.url}${testPrefix}/items/abc`);
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate"), /^Bearer/);
  assertErrorEnvelope(await missing.json(), "UNAUTHORIZED");

  const viewerWrite = await fetch(`${api.url}${testPrefix}/echo`, {
    method: "POST",
    headers: {
      Authorization: "Bearer viewer-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "blocked" }),
  });
  assert.equal(viewerWrite.status, 403);
  assertErrorEnvelope(await viewerWrite.json(), "FORBIDDEN");

  const editorRead = await fetch(`${api.url}${testPrefix}/items/abc`, {
    headers: { Authorization: "Bearer editor-token" },
  });
  assert.equal(editorRead.status, 200);
  assert.equal((await editorRead.json()).principalId, "writer");

  const service = await fetch(`${api.url}${testPrefix}/service`, {
    headers: { "X-API-Key": "service-key" },
  });
  assert.equal(service.status, 200);
  assert.deepEqual(await service.json(), { principalId: "onlyoffice", authentication: "api-key" });
});

test("production authentication fails closed without configured credentials", () => {
  assert.throws(
    () => createAuthenticator({ mode: "required", environment: "production" }),
    /没有配置 Bearer Token 或 API Key/,
  );
  assert.throws(
    () => createAuthenticator({ mode: "disabled", environment: "production" }),
    /生产环境必须启用/,
  );
  assert.throws(
    () => createAuthenticator({
      mode: "required",
      environment: "production",
      bearerTokens: { short: { id: "admin", roles: ["admin"] } },
    }),
    /至少需要 32 字节/,
  );
  assert.throws(
    () => createAuthenticator({
      mode: "required",
      bearerTokens: { "valid-test-token": { id: "invalid/id", roles: ["viewer"] } },
    }),
    /id 格式无效/,
  );
});

test("the runtime request schema is also emitted by OpenAPI", () => {
  const document = buildOpenApiDocument([routes.echo], { auth: { mode: "required", apiKeyHeader: "x-api-key" } });
  const operation = document.paths[`${testPrefix.replace(/^\/api/, "/api/v1")}/echo`].post;
  const schema = operation.requestBody.content["application/json"].schema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["name"]);
  assert.equal(schema.properties.count.type, "integer");
  assert.deepEqual(operation["x-required-roles"], ["editor"]);
  assert.deepEqual(operation.security, [{ bearerAuth: [] }, { apiKeyAuth: [] }]);
  assert.ok(operation.responses["415"]);
});

test("the route registry rejects duplicate method/path pairs", () => {
  defineRoute({
    id: "core.contract.duplicate.first",
    method: "GET",
    path: `${testPrefix}/duplicates/:firstId`,
    handler: () => ({}),
  });
  assert.throws(() => defineRoute({
    id: "core.contract.duplicate.second",
    method: "GET",
    path: `${testPrefix}/duplicates/:secondId`,
    handler: () => ({}),
  }), /method\/path 重复/);
});

function registerTestRoutes() {
  const echo = defineRoute({
    id: "core.contract.echo",
    method: "POST",
    path: `${testPrefix}/echo`,
    body: { name: "string", count: "integer?" },
    handler: ({ body, principal, requestId }) => ({ ...body, principalId: principal.id, requestId }),
  });
  defineRoute({
    id: "core.contract.small",
    method: "POST",
    path: `${testPrefix}/small`,
    bodyLimitBytes: 12,
    body: { value: "string" },
    handler: ({ body }) => body,
  });
  defineRoute({
    id: "core.contract.item",
    method: "GET",
    path: `${testPrefix}/items/:itemId`,
    handler: ({ params, principal }) => ({ id: params.itemId, principalId: principal.id, roles: principal.roles }),
  });
  defineRoute({
    id: "core.contract.service",
    method: "GET",
    path: `${testPrefix}/service`,
    roles: ["service"],
    handler: ({ principal }) => ({ principalId: principal.id, authentication: principal.authentication }),
  });
  defineRoute({
    id: "core.contract.internal",
    method: "GET",
    path: `${testPrefix}/internal-error`,
    handler: () => { throw new Error("C:\\private\\secret.txt"); },
  });
  return { echo };
}

async function startApi(options = {}) {
  const middleware = createApiMiddleware({ logger: { info() {}, error() {} }, ...options });
  const server = createServer((request, response) => middleware(request, response, () => {
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

function assertErrorEnvelope(body, code) {
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  assert.equal(body.message, body.error);
  assert.match(body.requestId, /^[A-Za-z0-9._:-]+$/);
}

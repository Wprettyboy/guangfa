import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ensureApiRoutesRegistered } from "../server/api/index.js";
import { buildOpenApiDocument } from "../server/api/openapi.js";
import { getRoutes } from "../server/api/registry.js";
import { createApiMiddleware } from "../server/api/router.js";

ensureApiRoutesRegistered();
const routes = getRoutes();
const routesById = new Map(routes.map((route) => [route.id, route]));
const openApi = buildOpenApiDocument(routes, { auth: { mode: "required" } });
const operationsById = new Map(Object.values(openApi.paths).flatMap((path) =>
  Object.values(path).map((operation) => [operation.operationId, operation])));

test("business routes declare the intended production access policy", () => {
  assert.deepEqual(
    routes.filter((route) => route.auth === false).map((route) => route.id).sort(),
    ["office.documents.callback"],
  );
  assert.deepEqual(
    routes.filter((route) => route.auth === "optional").map((route) => route.id).sort(),
    [
      "ai.solution.plantumlImage.docx",
      "ai.solution.plantumlImage.file",
      "knowledge.documents.file",
      "knowledge.images.docx",
      "knowledge.images.file",
      "knowledge.tables.docx",
      "office.documents.file",
    ],
  );

  for (const id of [
    "settings.model.read",
    "settings.model.save",
    "settings.model.test",
    "office.outlineProbe.save",
    "office.outlineProbe.latest",
  ]) {
    assert.deepEqual(routesById.get(id)?.roles, ["admin"], id);
  }

  for (const route of routes.filter((item) => item.tags.includes("ai") || item.id === "plantuml.render")) {
    assert.deepEqual(route.roles, ["editor"], route.id);
  }

  for (const id of [
    "knowledge.bases.search",
    "knowledge.tables.search",
    "knowledge.images.search",
  ]) {
    assert.deepEqual(routesById.get(id)?.roles, ["viewer"], id);
  }
});

test("OpenAPI request schemas match the JSON and raw DOCX protocols", () => {
  const templates = operationsById.get("templates.replaceAll");
  assert.equal(templates.requestBody.content["application/json"].schema.type, "array");
  assert.equal(templates.requestBody.content["application/json"].schema.items.type, "object");

  const draft = operationsById.get("draft.write");
  assert.equal(draft.requestBody.content["application/json"].schema.type, "object");
  assert.equal(draft.requestBody.content["application/json"].schema.properties, undefined);

  const fill = operationsById.get("ai.fill.field").requestBody.content["application/json"].schema;
  assert.deepEqual(fill.required, ["field"]);
  assert.equal(fill.properties.materials.type, "array");
  assert.equal(fill.properties.fields, undefined);

  const formatOutline = operationsById.get("ai.format.outline.plan").requestBody.content["application/json"].schema;
  assert.deepEqual(formatOutline.required, ["candidates"]);
  assert.equal(formatOutline.properties.onlyOfficeOutline.type, "array");
  assert.equal(formatOutline.properties.auditRules.type, "array");

  const officeUpload = operationsById.get("office.documents.create").requestBody.content;
  assert.deepEqual(Object.keys(officeUpload).sort(), [
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  assert.equal(officeUpload["application/vnd.openxmlformats-officedocument.wordprocessingml.document"].schema.format, "binary");

  const callback = operationsById.get("office.documents.callback");
  const callbackSchema = callback.requestBody.content["application/json"].schema;
  assert.deepEqual(callbackSchema.required, ["status", "key"]);
  assert.deepEqual(callback.security, []);
  assert.equal(callback["x-required-roles"], undefined);

  const signedAsset = operationsById.get("knowledge.images.file");
  assert.deepEqual(signedAsset.security, [
    { bearerAuth: [] },
    { apiKeyAuth: [] },
    { resourceTokenAuth: [] },
  ]);
  assert.equal(openApi.components.securitySchemes.resourceTokenAuth.name, "accessToken");
});

test("OpenAPI advertises concrete MIME types for generated binary files", () => {
  assert.ok(operationsById.get("ai.solution.plantumlImage.file").responses["200"].content["image/png"]);
  for (const id of [
    "ai.solution.plantumlImage.docx",
    "knowledge.tables.docx",
    "knowledge.images.docx",
    "office.documents.file",
    "office.downloadUrl",
  ]) {
    assert.ok(
      operationsById.get(id).responses["200"].content[
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ],
      id,
    );
  }
  assert.ok(operationsById.get("knowledge.images.file").responses["200"].content["image/*"]);
});

test("state-changing contracts expose concurrency and idempotency outcomes", () => {
  for (const id of [
    "template.types.create",
    "template.types.update",
    "template.types.delete",
    "templates.replaceAll",
  ]) {
    const operation = operationsById.get(id);
    const ifMatch = operation.parameters.find((parameter) => parameter.in === "header" && parameter.name === "If-Match");
    assert.equal(ifMatch?.required, true, id);
    assert.equal(ifMatch?.schema.type, "string", id);
    assert.ok(operation.responses["412"], id);
    assert.ok(operation.responses["428"], id);
  }

  const knowledgeUpload = operationsById.get("knowledge.documents.create");
  const idempotencyKey = knowledgeUpload.parameters.find((parameter) =>
    parameter.in === "header" && parameter.name === "Idempotency-Key");
  assert.equal(idempotencyKey?.required, true);
  assert.equal(idempotencyKey?.schema.type, "string");
  assert.equal(idempotencyKey?.schema.maxLength, 128);
  assert.equal(idempotencyKey?.schema.pattern, "^[\\x21-\\x7E]+$");
  assert.ok(knowledgeUpload.responses["200"]);
  assert.ok(knowledgeUpload.responses["201"]);
  assert.ok(knowledgeUpload.responses["409"]);

  const templateList = operationsById.get("templates.list");
  assert.equal(templateList.responses["200"].headers.ETag.schema.type, "string");
  const draftRead = operationsById.get("draft.read");
  assert.equal(draftRead.responses["200"].content["application/json"].schema.nullable, true);
});

test("state-changing request headers are enforced before business handlers run", async (context) => {
  const api = await startApi();
  context.after(api.close);

  const missingRevision = await fetch(`${api.url}/api/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  assert.equal(missingRevision.status, 428);
  assert.equal((await missingRevision.json()).code, "PRECONDITION_REQUIRED");

  const missingIdempotencyKey = await fetch(`${api.url}/api/knowledge-bases/missing/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(missingIdempotencyKey.status, 400);
  assert.equal((await missingIdempotencyKey.json()).code, "VALIDATION_ERROR");

  const oversizedIdempotencyKey = await fetch(`${api.url}/api/knowledge-bases/missing/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "x".repeat(129),
    },
    body: "{}",
  });
  assert.equal(oversizedIdempotencyKey.status, 400);
  assert.equal((await oversizedIdempotencyKey.json()).code, "VALIDATION_ERROR");
});

async function startApi() {
  const middleware = createApiMiddleware({ logger: { info() {}, error() {} } });
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

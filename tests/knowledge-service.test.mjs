import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "guangfa-knowledge-service-"));
const dataDir = path.join(root, "knowledge");
const databasePath = path.join(root, "knowledge.sqlite");
const projectOneKey = "project-one-api-key-that-is-at-least-32-bytes";
const projectTwoKey = "project-two-api-key-that-is-at-least-32-bytes";

Object.assign(process.env, {
  API_AUTH_MODE: "required",
  API_AUTH_API_KEYS: JSON.stringify([
    { key: projectOneKey, id: "project-one-client", roles: ["editor"], projectIds: ["project-one"] },
    { key: projectTwoKey, id: "project-two-client", roles: ["viewer"], projectIds: ["project-two"] },
  ]),
  API_CAPABILITY_SECRET: "knowledge-capability-secret-that-is-at-least-32-bytes",
  KNOWLEDGE_DATABASE_PATH: databasePath,
  KNOWLEDGE_DATA_DIR: dataDir,
  KNOWLEDGE_TENANT_MODE: "required",
  RETRIEVAL_DISABLED: "1",
});

const { startKnowledgeHttpServer } = await import("../server/knowledge-http-server.js");
const { closeKnowledgeDatabase } = await import("../server/knowledge/db.js");

test("standalone Knowledge API isolates storage, tenants and multipart uploads", async (context) => {
  const server = await startKnowledgeHttpServer({ host: "127.0.0.1", port: 0 });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeKnowledgeDatabase();
    await rm(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const projectOneHeaders = { "X-API-Key": projectOneKey };

  assert.equal((await fetch(`${baseUrl}/readyz`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/v1/knowledge-bases`)).status, 401);

  const forbiddenCreate = await fetch(`${baseUrl}/api/v1/knowledge-bases`, {
    method: "POST",
    headers: { ...projectOneHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "越权知识库", scope: "project", projectId: "project-two" }),
  });
  assert.equal(forbiddenCreate.status, 403);

  const created = await fetch(`${baseUrl}/api/v1/knowledge-bases`, {
    method: "POST",
    headers: { ...projectOneHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "项目一知识库", scope: "project" }),
  });
  assert.equal(created.status, 200);
  const knowledgeBase = await created.json();
  assert.equal(knowledgeBase.projectId, "project-one");

  const form = new FormData();
  form.append("name", "服务化测试资料");
  form.append("file", new Blob(["服务化知识库唯一标识 KS-2026-001"], { type: "text/plain" }), "service.txt");
  const upload = await fetch(`${baseUrl}/api/v1/knowledge-bases/${knowledgeBase.id}/documents/upload`, {
    method: "POST",
    headers: { ...projectOneHeaders, "Idempotency-Key": "knowledge-service-upload-1" },
    body: form,
  });
  assert.equal(upload.status, 202);
  const document = await upload.json();
  const completed = await waitForDocument(baseUrl, document.id, projectOneHeaders);
  assert.equal(completed.status, "关键词可用");
  assert.equal(completed.fileName, "service.txt");

  const otherProjectStatus = await fetch(`${baseUrl}/api/v1/knowledge-documents/${document.id}/status`, {
    headers: { "X-API-Key": projectTwoKey },
  });
  assert.equal(otherProjectStatus.status, 403);

  const openApi = await fetch(`${baseUrl}/api/v1/_meta/openapi.json`, { headers: projectOneHeaders });
  const operations = await openApi.json();
  assert.ok(operations.paths[`/api/v1/knowledge-bases/{kbId}/documents/upload`]);
  assert.ok(operations.paths[`/api/v1/knowledge-documents/{documentId}/status`]);
});

async function waitForDocument(baseUrl, documentId, headers) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/knowledge-documents/${documentId}/status`, { headers });
    assert.equal(response.status, 200);
    const document = await response.json();
    if (!document.processingStage && !["解析中", "索引中"].includes(document.status)) return document;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("standalone Knowledge API document did not reach a terminal state");
}

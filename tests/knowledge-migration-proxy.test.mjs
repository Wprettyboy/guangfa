import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { defineRoute } from "../server/api/registry.js";
import { createApiMiddleware } from "../server/api/router.js";
import {
  forwardKnowledgeRequest,
  searchKnowledgeService,
} from "../server/knowledge/service-client.js";
import { migrateKnowledgeToService } from "../scripts/migrate-knowledge-to-service.mjs";

test("knowledge migration copies rows, embeddings and files while rebasing paths", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "guangfa-knowledge-migration-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourceDatabasePath = path.join(root, "source.sqlite");
  const targetDatabasePath = path.join(root, "target.sqlite");
  const sourceKnowledgeDir = path.join(root, "source-knowledge");
  const targetKnowledgeDir = path.join(root, "target-knowledge");
  process.env.KNOWLEDGE_DATABASE_PATH = targetDatabasePath;
  process.env.KNOWLEDGE_DATA_DIR = targetKnowledgeDir;

  const { closeKnowledgeDatabase, getKnowledgeDatabase } = await import("../server/knowledge/db.js");
  const { createKnowledgeEmbeddingCache } = await import("../server/knowledge/embedding-cache.js");
  const target = await getKnowledgeDatabase();
  createKnowledgeEmbeddingCache(target);
  await closeKnowledgeDatabase();
  await copyFile(targetDatabasePath, sourceDatabasePath);

  const sourceFile = path.join(sourceKnowledgeDir, "files", "DOC-1", "source.txt");
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, "迁移测试唯一标识 MIGRATION-2026-001", "utf8");
  const source = new DatabaseSync(sourceDatabasePath);
  source.exec("PRAGMA foreign_keys = ON");
  source.exec("DELETE FROM knowledge_bases");
  source.prepare(`INSERT INTO knowledge_bases (id, name, scope, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("KB-1", "迁移库", "project", "default-project", 1, 1);
  source.prepare(`
    INSERT INTO knowledge_documents (
      id, kb_id, name, file_name, file_ext, mime_type, file_size, file_hash, file_path,
      status, index_mode, page_count, paragraph_count, chunk_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "DOC-1", "KB-1", "迁移资料", "source.txt", "txt", "text/plain", "40", "hash-1",
    "C:\\legacy\\data\\knowledge\\files\\DOC-1\\source.txt",
    "已索引", "dense-sparse-fts", 1, 1, 1, 1, 1,
  );
  source.prepare(`
    INSERT INTO knowledge_chunks (id, kb_id, document_id, chunk_index, page_number, text, source_text, block_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("CHUNK-1", "KB-1", "DOC-1", 1, 1, "迁移测试唯一标识 MIGRATION-2026-001", "迁移测试唯一标识 MIGRATION-2026-001", "text", 1);
  source.prepare(`
    INSERT INTO knowledge_chunk_embeddings (text_hash, model, dense_json, sparse_json, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("embedding-1", "BAAI/bge-m3", JSON.stringify(new Array(1024).fill(0.01)), JSON.stringify({ 101: 0.5 }), 1, 1);
  source.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('knowledge_test_marker', '1')").run();
  source.close();

  const result = await migrateKnowledgeToService({ sourceDatabasePath, targetDatabasePath, sourceKnowledgeDir, targetKnowledgeDir });
  assert.equal(result.counts.knowledge_bases, 1);
  assert.equal(result.counts.knowledge_documents, 1);
  assert.equal(result.counts.knowledge_chunks, 1);
  assert.equal(result.counts.knowledge_chunk_embeddings, 1);
  assert.equal(result.referencedFiles, 1);
  assert.equal(result.reindexKbId, "KB-1");
  assert.equal(await readFile(path.join(targetKnowledgeDir, "files", "DOC-1", "source.txt"), "utf8"), "迁移测试唯一标识 MIGRATION-2026-001");

  const migrated = new DatabaseSync(targetDatabasePath, { readOnly: true });
  assert.equal(migrated.prepare("SELECT file_path AS filePath FROM knowledge_documents WHERE id = 'DOC-1'").get().filePath, path.join(targetKnowledgeDir, "files", "DOC-1", "source.txt"));
  assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key = 'knowledge_test_marker'").get().value, "1");
  assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key = 'knowledge_index_v4'").get(), undefined);
  migrated.close();
});

test("API authentication and authorization run before a knowledge route is forwarded", async (context) => {
  let forwarded = 0;
  let localCalls = 0;
  defineRoute({
    id: "knowledge.proxy.auth-order",
    method: "GET",
    path: "/api/knowledge-proxy-auth-order",
    tags: ["knowledge"],
    roles: ["viewer"],
    handler: () => {
      localCalls += 1;
      return { local: true };
    },
  });
  const middleware = createApiMiddleware({
    notFoundPrefixes: ["/api/knowledge-proxy-auth-order"],
    auth: {
      environment: "development",
      mode: "required",
      bearerTokens: { "proxy-viewer-token": { id: "proxy-viewer", roles: ["viewer"] } },
    },
    rateLimit: { enabled: false },
    logger: { info() {}, error() {} },
    forwardRoute: async (routeContext) => {
      assert.deepEqual(routeContext.route.tags, ["knowledge"]);
      forwarded += 1;
      return { handled: true, result: { body: { forwarded: true } } };
    },
  });
  const server = createServer((request, response) => middleware(request, response, () => response.end()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/knowledge-proxy-auth-order`;

  assert.equal((await fetch(url)).status, 401);
  assert.equal(forwarded, 0);
  const allowed = await fetch(url, { headers: { Authorization: "Bearer proxy-viewer-token" } });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { forwarded: true });
  assert.equal(forwarded, 1);
  assert.equal(localCalls, 0);
});

test("knowledge service client forwards JSON, multipart, binary and upstream errors", async (context) => {
  const received = [];
  const upstream = createServer(async (request, response) => {
    if (!request.url.startsWith("/api/v1/knowledge-images/")) {
      assert.equal(request.headers["x-api-key"], "standalone-service-key");
    }
    if (request.url === "/api/v1/knowledge-bases/search") {
      const body = JSON.parse((await readRequestBuffer(request)).toString("utf8"));
      received.push({ kind: "search", body });
      return sendJson(response, 200, { items: [{ id: "CHUNK-1" }], diagnostics: { indexVersion: 4 } });
    }
    if (request.url === "/api/v1/knowledge-bases/KB-1/documents/upload") {
      const body = await readRequestBuffer(request);
      const form = await new Response(body, { headers: { "Content-Type": request.headers["content-type"] } }).formData();
      const file = form.get("file");
      received.push({ kind: "upload", name: form.get("name"), fileName: file.name, text: await file.text(), idempotencyKey: request.headers["idempotency-key"] });
      return sendJson(response, 202, { id: "DOC-1" });
    }
    if (request.url === "/api/v1/knowledge-document-images/IMG-1/file") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "private, max-age=300");
      return response.end(Buffer.from([1, 2, 3]));
    }
    if (request.url === "/api/v1/knowledge-images/DOC-1/1/file?accessToken=signed-capability") {
      assert.equal(request.headers["x-api-key"], undefined);
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/png");
      return response.end(Buffer.from([4, 5, 6]));
    }
    if (request.url === "/api/v1/knowledge-documents/missing/status") {
      return sendJson(response, 404, { code: "NOT_FOUND", message: "资料不存在" });
    }
    return sendJson(response, 500, { code: "UNEXPECTED", message: "unexpected" });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => upstream.close(resolve)));
  const previous = {
    baseUrl: process.env.KNOWLEDGE_SERVICE_BASE_URL,
    apiKey: process.env.KNOWLEDGE_SERVICE_API_KEY,
  };
  process.env.KNOWLEDGE_SERVICE_BASE_URL = `http://127.0.0.1:${upstream.address().port}/api/v1`;
  process.env.KNOWLEDGE_SERVICE_API_KEY = "standalone-service-key";
  context.after(() => {
    restoreEnvironment("KNOWLEDGE_SERVICE_BASE_URL", previous.baseUrl);
    restoreEnvironment("KNOWLEDGE_SERVICE_API_KEY", previous.apiKey);
  });

  assert.deepEqual(await searchKnowledgeService({ query: "唯一标识", kbIds: ["KB-1"] }), [{ id: "CHUNK-1" }]);
  const upload = await forwardKnowledgeRequest({
    route: { method: "POST", requestBody: { parse: "multipart" } },
    body: { name: "测试资料", file: { buffer: Buffer.from("文件正文"), fileName: "source.txt", mimeType: "text/plain" } },
    request: { method: "POST", headers: { "idempotency-key": "stable-upload-key" } },
    url: new URL("http://local/api/knowledge-bases/KB-1/documents/upload"),
  });
  assert.equal(upload.statusCode, 202);
  assert.deepEqual(upload.body, { id: "DOC-1" });

  const binary = await forwardKnowledgeRequest({
    route: { method: "GET" }, body: {}, request: { method: "GET", headers: {} },
    url: new URL("http://local/api/knowledge-document-images/IMG-1/file"),
  });
  assert.equal(binary.kind, "buffer");
  assert.equal(binary.contentType, "image/png");
  assert.deepEqual(binary.buffer, Buffer.from([1, 2, 3]));
  assert.equal(binary.headers["cache-control"], "private, max-age=300");

  const capabilityBinary = await forwardKnowledgeRequest({
    route: { method: "GET", auth: "optional" }, body: {},
    principal: { authentication: "anonymous" },
    request: { method: "GET", headers: {} },
    url: new URL("http://local/api/knowledge-images/DOC-1/1/file?accessToken=signed-capability"),
  });
  assert.deepEqual(capabilityBinary.buffer, Buffer.from([4, 5, 6]));

  await assert.rejects(
    forwardKnowledgeRequest({
      route: { method: "GET" }, body: {}, request: { method: "GET", headers: {} },
      url: new URL("http://local/api/knowledge-documents/missing/status"),
    }),
    (error) => error.statusCode === 404 && error.code === "NOT_FOUND" && error.message === "资料不存在",
  );
  assert.deepEqual(received, [
    { kind: "search", body: { query: "唯一标识", kbIds: ["KB-1"] } },
    { kind: "upload", name: "测试资料", fileName: "source.txt", text: "文件正文", idempotencyKey: "stable-upload-key" },
  ]);
});

function readRequestBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

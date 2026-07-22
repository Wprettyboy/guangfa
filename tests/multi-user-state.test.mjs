import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const originalCwd = process.cwd();
const originalEmbeddingEnvironment = {
  baseUrl: process.env.EMBEDDING_BASE_URL,
  model: process.env.EMBEDDING_MODEL,
};
const testRoot = await mkdtemp(path.join(tmpdir(), "guangfa-multi-user-"));
process.chdir(testRoot);
delete process.env.EMBEDDING_BASE_URL;
delete process.env.EMBEDDING_MODEL;

const { assertDraftActorId, readDraft, writeDraft } = await import("../server/draft.js");
const {
  createTemplateType,
  getTemplateDatabase,
  readTemplateLibrarySnapshot,
  readTemplateTypesSnapshot,
  replaceTemplateLibrary,
} = await import("../server/template-db.js");
const {
  addKnowledgeDocument,
  createKnowledgeBase,
  deleteKnowledgeDocument,
  readKnowledgeDocumentPdf,
  searchKnowledgeBase,
} = await import("../server/knowledge/documents.js");

after(async () => {
  const database = await getTemplateDatabase();
  database.close();
  process.chdir(originalCwd);
  restoreEnvironment("EMBEDDING_BASE_URL", originalEmbeddingEnvironment.baseUrl);
  restoreEnvironment("EMBEDDING_MODEL", originalEmbeddingEnvironment.model);
  await rm(testRoot, { recursive: true, force: true });
});

test("drafts are atomic and isolated by authenticated principal", async () => {
  const alice = { id: "alice@example.com", authentication: "bearer" };
  const bob = { id: "bob@example.com", authentication: "bearer" };

  await writeDraft({ owner: "legacy" });
  await Promise.all([
    writeDraft({ owner: "alice" }, alice),
    writeDraft({ owner: "bob" }, bob),
  ]);

  assert.deepEqual(await readDraft(), { owner: "legacy" });
  assert.deepEqual(await readDraft(alice), { owner: "alice" });
  assert.deepEqual(await readDraft(bob), { owner: "bob" });
  assert.equal(await readDraft({ id: "carol", authentication: "api-key" }), null);
  assert.throws(() => assertDraftActorId("../alice"), /身份标识格式无效/);
  assert.throws(() => assertDraftActorId(`a${"x".repeat(128)}`), /身份标识格式无效/);

  await Promise.all(Array.from({ length: 12 }, (_, index) => writeDraft({ index }, alice)));
  const finalDraft = await readDraft(alice);
  assert.equal(Number.isInteger(finalDraft.index), true);
  const actorFiles = await readdir(path.join(testRoot, "data", "drafts", "by-actor"));
  assert.equal(actorFiles.some((name) => name.endsWith(".tmp")), false);
});

test("shared template writes require and atomically advance a strong revision", async () => {
  const initial = await readTemplateLibrarySnapshot();
  await assert.rejects(
    replaceTemplateLibrary([template("T-MISSING", "missing.docx")], { requirePrecondition: true }),
    (error) => error.statusCode === 428,
  );
  await assert.rejects(
    replaceTemplateLibrary([template("T-WILDCARD", "wildcard.docx")], { expectedRevision: "*", requirePrecondition: true }),
    (error) => error.statusCode === 400,
  );

  const first = await replaceTemplateLibrary([template("T-ONE", "one.docx")], {
    expectedRevision: initial.etag,
    requirePrecondition: true,
  });
  assert.notEqual(first.etag, initial.etag);
  await assert.rejects(
    replaceTemplateLibrary([template("T-STALE", "stale.docx")], {
      expectedRevision: initial.etag,
      requirePrecondition: true,
    }),
    (error) => error.statusCode === 412,
  );
  assert.deepEqual((await readTemplateLibrarySnapshot()).body.map((item) => item.id), ["T-ONE"]);

  const sharedRevision = (await readTemplateLibrarySnapshot()).etag;
  const writes = await Promise.allSettled([
    replaceTemplateLibrary([template("T-TWO", "two.docx")], { expectedRevision: sharedRevision, requirePrecondition: true }),
    replaceTemplateLibrary([template("T-THREE", "three.docx")], { expectedRevision: sharedRevision, requirePrecondition: true }),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.filter((result) => result.status === "rejected" && result.reason.statusCode === 412).length, 1);

  const types = await readTemplateTypesSnapshot();
  const createdType = await createTemplateType({ name: "并发测试类" }, {
    expectedRevision: types.etag,
    requirePrecondition: true,
  });
  assert.equal(createdType.body.name, "并发测试类");
  await assert.rejects(
    replaceTemplateLibrary([], { expectedRevision: types.etag, requirePrecondition: true }),
    (error) => error.statusCode === 412,
  );
});

test("knowledge uploads are idempotent and deleted documents cannot appear in search", async () => {
  const knowledgeBase = await createKnowledgeBase({ name: "并发知识库", scope: "project", projectId: "P-TEST" });
  const payload = textPayload("identity.txt", "生产级接口并发控制测试唯一词，必须只入库一次。");
  const alice = { id: "alice@example.com", authentication: "bearer" };
  const bob = { id: "bob@example.com", authentication: "bearer" };

  const first = await addKnowledgeDocument(knowledgeBase.id, payload, { idempotencyKey: "upload-identity-1", principal: alice });
  const replay = await addKnowledgeDocument(knowledgeBase.id, payload, { idempotencyKey: "upload-identity-1", principal: alice });
  const contentReplay = await addKnowledgeDocument(knowledgeBase.id, payload);
  assert.equal(first.idempotentReplay, false);
  assert.equal(first.pageSource, "plain-text");
  assert.equal(await readKnowledgeDocumentPdf(first.id), null);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(contentReplay.idempotentReplay, true);
  assert.equal(replay.id, first.id);
  assert.equal(contentReplay.id, first.id);

  await assert.rejects(
    addKnowledgeDocument(knowledgeBase.id, textPayload("identity.txt", "不同内容"), {
      idempotencyKey: "upload-identity-1",
      principal: alice,
    }),
    (error) => error.statusCode === 409,
  );
  const bobUpload = await addKnowledgeDocument(
    knowledgeBase.id,
    textPayload("bob.txt", "Bob 使用相同客户端键提交的独立内容。"),
    { idempotencyKey: "upload-identity-1", principal: bob },
  );
  const bobReplay = await addKnowledgeDocument(
    knowledgeBase.id,
    textPayload("bob.txt", "Bob 使用相同客户端键提交的独立内容。"),
    { idempotencyKey: "upload-identity-1", principal: bob },
  );
  assert.notEqual(bobUpload.id, first.id);
  assert.equal(bobReplay.id, bobUpload.id);
  assert.equal(bobReplay.idempotentReplay, true);
  await assert.rejects(
    addKnowledgeDocument(knowledgeBase.id, payload, { idempotencyKey: "contains space" }),
    (error) => error.statusCode === 400,
  );

  const parallelPayload = textPayload("parallel.txt", "并发上传资料的另一个唯一内容。");
  const parallel = await Promise.all([
    addKnowledgeDocument(knowledgeBase.id, parallelPayload, { idempotencyKey: "upload-parallel-1", principal: alice }),
    addKnowledgeDocument(knowledgeBase.id, parallelPayload, { idempotencyKey: "upload-parallel-1", principal: alice }),
  ]);
  assert.equal(new Set(parallel.map((document) => document.id)).size, 1);
  assert.equal(parallel.filter((document) => document.idempotentReplay === false).length, 1);

  const database = await getTemplateDatabase();
  const recoveryPayload = textPayload("recovery.txt", "进程中断后的知识库资料应在重试时恢复处理。");
  const abandoned = await addKnowledgeDocument(knowledgeBase.id, recoveryPayload, {
    idempotencyKey: "upload-recovery-1",
    principal: alice,
  });
  database.prepare(`
    UPDATE knowledge_documents
    SET status = '解析中', updated_at = ?
    WHERE id = ?
  `).run(Date.now() - 60_000, abandoned.id);
  const recovered = await addKnowledgeDocument(knowledgeBase.id, recoveryPayload, {
    idempotencyKey: "upload-recovery-1",
    principal: alice,
  });
  assert.equal(recovered.idempotentReplay, false);
  assert.notEqual(recovered.id, abandoned.id);
  assert.notEqual(recovered.status, "解析中");
  assert.equal(database.prepare("SELECT 1 FROM knowledge_documents WHERE id = ?").get(abandoned.id), undefined);

  const beforeDelete = await searchKnowledgeBase({
    query: "生产级接口并发控制测试唯一词",
    projectId: "P-TEST",
    kbIds: [knowledgeBase.id],
    topK: 8,
  });
  assert.equal(beforeDelete.some((item) => item.documentId === first.id), true);
  await deleteKnowledgeDocument(knowledgeBase.id, first.id);
  const afterDelete = await searchKnowledgeBase({
    query: "生产级接口并发控制测试唯一词",
    projectId: "P-TEST",
    kbIds: [knowledgeBase.id],
    topK: 8,
  });
  assert.equal(afterDelete.some((item) => item.documentId === first.id), false);

  const mappings = database.prepare(`
    SELECT scoped_key AS scopedKey, document_id AS documentId
    FROM knowledge_upload_idempotency
  `).all();
  assert.equal(new Set(mappings.map((mapping) => mapping.scopedKey)).size, mappings.length);
  assert.equal(mappings.some((mapping) => mapping.documentId === first.id), false);
  assert.equal(mappings.some((mapping) => mapping.documentId === bobUpload.id), true);
  assert.equal(mappings.every((mapping) => !mapping.scopedKey.includes("upload-")), true);
});

function template(id, fileName) {
  return {
    id,
    name: id,
    fileName,
    category: "方案类",
    savedAtMs: Date.now(),
    fields: [],
    placeholderVariables: [],
    placeholderAnchors: [],
    complexFillFields: [],
    complexFillAnchors: [],
  };
}

function textPayload(fileName, text) {
  return {
    name: fileName,
    fileName,
    fileType: "text/plain",
    size: `${Buffer.byteLength(text, "utf8")} B`,
    fileBase64: Buffer.from(text, "utf8").toString("base64"),
  };
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

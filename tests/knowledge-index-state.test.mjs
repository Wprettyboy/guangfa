import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { healVectorDegradedDocuments } from "../server/knowledge/indexer.js";

function createDocumentsDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      status TEXT NOT NULL,
      index_mode TEXT NOT NULL,
      chunk_count INTEGER DEFAULT 0,
      image_failed_count INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      updated_at INTEGER DEFAULT 0,
      deleted_at INTEGER
    );
  `);
  const insert = database.prepare(`
    INSERT INTO knowledge_documents (id, kb_id, status, index_mode, chunk_count, image_failed_count, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  return { database, insert };
}

// node:sqlite 返回的行是 null 原型对象，deepStrictEqual 会因原型不同而失败，这里摊平成普通对象。
function readDocument(database, id) {
  const row = database.prepare(`
    SELECT status, index_mode AS indexMode, error FROM knowledge_documents WHERE id = ?
  `).get(id);
  return { ...row };
}

test("index rebuild never rewrites the state of unrelated documents", () => {
  const { database, insert } = createDocumentsDatabase();
  insert.run("DOC-partial", "KB-1", "部分可用", "dense-sparse-fts", 12, 3, "图片 3 张解析失败");
  insert.run("DOC-legacy", "KB-1", "关键词可用", "keyword", 8, 0, "旧资料缺少原文件页码，请重新上传入库以启用原文页码。");
  insert.run("DOC-other-kb", "KB-2", "关键词可用", "keyword", 5, 0, "向量索引不可用：connect ECONNREFUSED");

  // 只恢复本知识库中因向量索引不可用而降级的资料。
  assert.equal(healVectorDegradedDocuments(database, "KB-2"), 1);

  assert.deepEqual(readDocument(database, "DOC-partial"), {
    status: "部分可用", indexMode: "dense-sparse-fts", error: "图片 3 张解析失败",
  });
  assert.deepEqual(readDocument(database, "DOC-legacy"), {
    status: "关键词可用", indexMode: "keyword", error: "旧资料缺少原文件页码，请重新上传入库以启用原文页码。",
  });
  assert.deepEqual(readDocument(database, "DOC-other-kb"), {
    status: "已索引", indexMode: "dense-sparse-fts", error: "",
  });
  database.close();
});

test("healing strips only the vector index warning and keeps other warnings", () => {
  const { database, insert } = createDocumentsDatabase();
  insert.run("DOC-a", "KB-1", "关键词可用", "keyword", 4, 0, "向量索引不可用：timeout；标题物理页仅映射 2/9 个章节");
  insert.run("DOC-b", "KB-1", "关键词可用", "keyword", 4, 2, "未配置 embedding，当前资料仅支持关键词/全文检索。");

  assert.equal(healVectorDegradedDocuments(database, "KB-1"), 2);
  assert.deepEqual(readDocument(database, "DOC-a"), {
    status: "已索引", indexMode: "dense-sparse-fts", error: "标题物理页仅映射 2/9 个章节",
  });
  // 图片仍有失败时不能谎报为已索引。
  assert.deepEqual(readDocument(database, "DOC-b"), {
    status: "部分可用", indexMode: "dense-sparse-fts", error: "",
  });
  database.close();
});

test("healing leaves documents that were never vector-degraded untouched", () => {
  const { database, insert } = createDocumentsDatabase();
  insert.run("DOC-failed", "KB-1", "解析失败", "keyword", 0, 0, "资料解析失败");
  insert.run("DOC-empty", "KB-1", "关键词可用", "keyword", 0, 0, "向量索引不可用：timeout");

  assert.equal(healVectorDegradedDocuments(database, "KB-1"), 0);
  assert.equal(readDocument(database, "DOC-failed").status, "解析失败");
  assert.equal(readDocument(database, "DOC-empty").status, "关键词可用");
  database.close();
});

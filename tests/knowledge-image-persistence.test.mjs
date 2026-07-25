import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getKnowledgeDatabase } from "../server/knowledge/db.js";
import { writeParsedDocument } from "../server/knowledge/documents.js";

test("image captions and exact PDF locators persist with their retrieval chunks", async (context) => {
  const database = await getKnowledgeDatabase();
  const kbId = database.prepare("SELECT id FROM knowledge_bases WHERE deleted_at IS NULL LIMIT 1").get().id;
  const documentId = `DOC-IMAGE-TEST-${randomUUID()}`;
  const now = Date.now();
  database.prepare(`
    INSERT INTO knowledge_documents (
      id, kb_id, name, file_name, file_ext, status, index_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pdf', '解析中', 'keyword', ?, ?)
  `).run(documentId, kbId, "图片持久化测试", "image-test.pdf", now, now);
  context.after(() => database.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(documentId));

  const sourceAssetId = `${documentId}-I000001`;
  writeParsedDocument(database, {
    documentId,
    kbId,
    fileExt: "pdf",
    pages: [{ page: 3, text: "图片说明" }],
    paragraphs: [],
    chunks: [{
      id: `${documentId}-C0001`,
      chunkIndex: 1,
      page: 3,
      paragraphStart: null,
      paragraphEnd: null,
      text: "图片说明",
      sourceText: "图片说明",
      blockType: "image",
      bboxJson: "[1,2,3,4]",
      locatorGrade: "exact",
      sourceAssetId,
    }],
    images: [{
      imageIndex: 0,
      imagePath: "images/flow.png",
      imageHash: "abc",
      pageIndex: 2,
      bbox: [1, 2, 3, 4],
      status: "captioned",
      caption: "图片说明",
      metadata: { kind: "流程图" },
      model: "gemini-test",
      promptVersion: "knowledge-image-v1",
    }],
    now,
  });

  const image = database.prepare(`
    SELECT id, page_number AS page, bbox_json AS bboxJson, caption, status
    FROM knowledge_document_images WHERE document_id = ?
  `).get(documentId);
  const chunk = database.prepare("SELECT source_asset_id AS sourceAssetId FROM knowledge_chunks WHERE document_id = ?").get(documentId);
  assert.deepEqual({ ...image }, { id: sourceAssetId, page: 3, bboxJson: "[1,2,3,4]", caption: "图片说明", status: "captioned" });
  assert.equal(chunk.sourceAssetId, sourceAssetId);
});

test("Word image records preserve anchors without inventing PDF pages", async (context) => {
  const database = await getKnowledgeDatabase();
  const kbId = database.prepare("SELECT id FROM knowledge_bases WHERE deleted_at IS NULL LIMIT 1").get().id;
  const documentId = `DOC-IMAGE-TEST-${randomUUID()}`;
  const now = Date.now();
  database.prepare(`
    INSERT INTO knowledge_documents (
      id, kb_id, name, file_name, file_ext, status, index_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'docx', '解析中', 'keyword', ?, ?)
  `).run(documentId, kbId, "Word 图片持久化测试", "image-test.docx", now, now);
  context.after(() => database.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(documentId));

  writeParsedDocument(database, {
    documentId,
    kbId,
    fileExt: "docx",
    pages: [{ page: 1, text: "图片说明" }],
    paragraphs: [],
    chunks: [],
    images: [{
      imageIndex: 4,
      imagePath: "images/word.png",
      pageIndex: 7,
      bbox: [10, 20, 30, 40],
      anchor: "heading-2/image-1",
      status: "failed",
      error: "模型超时",
    }],
    now,
  });

  const image = database.prepare(`
    SELECT page_number AS page, bbox_json AS bboxJson, anchor, status, error
    FROM knowledge_document_images WHERE document_id = ?
  `).get(documentId);
  assert.deepEqual({ ...image }, {
    page: null,
    bboxJson: "",
    anchor: "heading-2/image-1",
    status: "failed",
    error: "模型超时",
  });
});

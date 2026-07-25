import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyKnowledgeContextBudget, estimateKnowledgeTokens } from "../server/knowledge/context-budget.js";

test("token estimation counts CJK directly and bounds Latin runs", () => {
  assert.equal(estimateKnowledgeTokens("资格要求"), 4);
  assert.equal(estimateKnowledgeTokens("ISO27001"), 2);
  assert.ok(estimateKnowledgeTokens("资格 ISO27001。") >= 5);
});

test("context budget preserves every source locator while bounding LLM text", () => {
  const database = createDatabase();
  try {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `C${index + 1}`,
      documentId: "DOC-1",
      page: index + 1,
      locator: { type: "pdf", page: index + 1, bbox: [1, 2, 3, 4] },
      sourceText: "资".repeat(1_200),
      text: "资".repeat(1_200),
    }));
    const result = applyKnowledgeContextBudget(database, items);
    assert.equal(result.items.length, 8);
    assert.ok(result.contextTokensEstimated <= 6_000);
    assert.ok(result.items.reduce((sum, item) => sum + item.text.length, 0) <= 12_000);
    assert.equal(result.contextTruncated, true);
    assert.equal(result.items.every((item) => item.sourceText.length === 1_200), true);
    assert.deepEqual(result.items[7].locator, items[7].locator);
  } finally {
    database.close();
  }
});

test("parent expansion is added by score order and dropped whole when over budget", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO knowledge_chunks VALUES
      ('P1', 'DOC-1', 1, '大章节', 'section-parent', ''),
      ('C1', 'DOC-1', 2, '命中一', 'paragraph', 'P1'),
      ('C1-S', 'DOC-1', 3, '${"扩".repeat(1700)}', 'paragraph', 'P1'),
      ('P2', 'DOC-1', 4, '小章节', 'section-parent', ''),
      ('C2', 'DOC-1', 5, '命中二', 'paragraph', 'P2'),
      ('C2-S', 'DOC-1', 6, '相邻证据', 'paragraph', 'P2');
  `);
  try {
    const result = applyKnowledgeContextBudget(database, [
      { id: "C1", documentId: "DOC-1", sourceText: "命中一", text: "命中一", parentChunkId: "P1", headingPath: "大章节" },
      { id: "C2", documentId: "DOC-1", sourceText: "命中二", text: "命中二", parentChunkId: "P2", headingPath: "小章节" },
    ]);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].text, "命中一");
    assert.match(result.items[1].text, /相邻证据/);
    assert.equal(result.droppedExpansionCount, 1);
    assert.ok(result.contextTokensEstimated <= 6_000);
  } finally {
    database.close();
  }
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      chunk_index INTEGER,
      source_text TEXT,
      block_type TEXT,
      parent_chunk_id TEXT
    );
  `);
  return database;
}

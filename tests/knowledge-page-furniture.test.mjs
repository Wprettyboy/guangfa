import assert from "node:assert/strict";
import test from "node:test";
import { buildStructuredKnowledgeChunks, isNonContentStructuralBlock } from "../server/knowledge/chunker.js";

test("page furniture blocks never become retrieval chunks", () => {
  const blocks = [
    { type: "title", text: "4 系统功能需求说明", level: 1, pageIndex: 2, bbox: [77, 145, 300, 164] },
    { type: "page_header", text: "某某科技有限公司", pageIndex: 2, bbox: [77, 40, 300, 60] },
    { type: "text", text: "系统应支持客户档案的批量导入与校验。", pageIndex: 2, bbox: [77, 180, 520, 210] },
    { type: "page_number", text: "3", pageIndex: 2, bbox: [510, 928, 526, 941] },
    { type: "page_footer", text: "内部资料，请勿外传", pageIndex: 2, bbox: [77, 950, 300, 970] },
  ];
  const chunks = buildStructuredKnowledgeChunks({
    documentId: "DOC-1", kbId: "KB-1", documentName: "需求.pdf", scope: "project",
    projectId: "default-project", blocks, fileExt: "pdf", createdAt: 1,
  });
  assert.deepEqual(chunks.map((chunk) => chunk.sourceText), [
    "4 系统功能需求说明",
    "系统应支持客户档案的批量导入与校验。",
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.blockType), ["section-parent", "text"]);
});

test("only explicit page furniture is excluded, unknown block types survive", () => {
  assert.equal(isNonContentStructuralBlock({ type: "page_number" }), true);
  assert.equal(isNonContentStructuralBlock({ type: "Page_Footer" }), true);
  assert.equal(isNonContentStructuralBlock({ type: "text" }), false);
  assert.equal(isNonContentStructuralBlock({ type: "equation" }), false);
  assert.equal(isNonContentStructuralBlock({ type: "list" }), false);
  assert.equal(isNonContentStructuralBlock({ type: "" }), false);
  assert.equal(isNonContentStructuralBlock({}), false);
});

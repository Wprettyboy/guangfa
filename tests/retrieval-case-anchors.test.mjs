import assert from "node:assert/strict";
import test from "node:test";
import {
  computeChunkAnchor,
  normalizeAnchorText,
  resolveChunkAnchor,
  resolveDocumentName,
  resolveKnowledgeBaseAnchor,
} from "../scripts/lib/retrieval-case-anchors.mjs";

function chunk(overrides = {}) {
  return {
    id: "DOC-1-C0001",
    documentId: "DOC-1",
    documentName: "需求.pdf",
    blockType: "text",
    page: 3,
    isTable: 0,
    text: "企业核心信息：客户名称、统一社会信用代码（税号）、企业规模、所属行业。",
    ...overrides,
  };
}

test("an anchor resolves to the single chunk holding the anchored content", () => {
  const target = chunk();
  const chunks = [chunk({ id: "DOC-1-C0000", text: "配送地址信息：常用收货地址。" }), target];
  const anchor = { sha256: computeChunkAnchor(target), documentName: "需求.pdf", blockType: "text" };
  assert.equal(resolveChunkAnchor(anchor, chunks), "DOC-1-C0001");
});

test("resolution survives re-ingestion that changes chunk ids and whitespace", () => {
  const original = chunk();
  const anchor = { sha256: computeChunkAnchor(original), documentName: "需求.pdf" };
  // 同一份文件重新入库：id 换了，正文换行与空格也变了，但字符内容一致。
  const reingested = [chunk({
    id: "DOC-9999999999999-abcdef12-C0007",
    documentId: "DOC-9999999999999-abcdef12",
    text: "企业核心信息：客户名称、统一社会信用代码（税号）、\n企业规模、  所属行业。",
  })];
  assert.equal(resolveChunkAnchor(anchor, reingested), "DOC-9999999999999-abcdef12-C0007");
});

test("a missing anchor fails loudly instead of resolving to something similar", () => {
  const chunks = [chunk({ text: "企业核心信息：客户名称、统一社会信用代码（税号）、企业规模。" })];
  const anchor = { sha256: computeChunkAnchor(chunk()), documentName: "需求.pdf" };
  assert.throws(() => resolveChunkAnchor(anchor, chunks, "case sem-01 anchor 1"), (error) => {
    assert.match(error.message, /case sem-01 anchor 1 matched no chunk/);
    assert.match(error.message, /re-ingest the document or regenerate the anchor/);
    return true;
  });
  // 内容近似但不相同的子块绝不能被当作命中。
  assert.equal(chunks.length, 1);
});

test("an ambiguous anchor fails and names every candidate", () => {
  // 表格父块与其行分组可能携带完全相同的正文。
  const shared = "角色泳道 | 第一阶段 | 第二阶段";
  const chunks = [
    chunk({ id: "DOC-1-C0003", blockType: "table-parent", isTable: 1, text: shared }),
    chunk({ id: "DOC-1-C0004", blockType: "table-row-group", isTable: 1, text: shared }),
  ];
  const anchor = { sha256: computeChunkAnchor(chunks[0]), documentName: "需求.pdf" };
  assert.throws(() => resolveChunkAnchor(anchor, chunks, "case sem-03 anchor 1"), (error) => {
    assert.match(error.message, /case sem-03 anchor 1 matched 2 chunks/);
    assert.match(error.message, /Add a distinguishing constraint/);
    assert.match(error.message, /DOC-1-C0003/);
    assert.match(error.message, /DOC-1-C0004/);
    return true;
  });
});

test("a block constraint disambiguates chunks that share identical content", () => {
  const shared = "角色泳道 | 第一阶段 | 第二阶段";
  const chunks = [
    chunk({ id: "DOC-1-C0003", blockType: "table-parent", isTable: 1, text: shared }),
    chunk({ id: "DOC-1-C0004", blockType: "table-row-group", isTable: 1, text: shared }),
  ];
  const sha256 = computeChunkAnchor(chunks[0]);
  assert.equal(resolveChunkAnchor({ sha256, blockType: "table-row-group" }, chunks), "DOC-1-C0004");
  assert.equal(resolveChunkAnchor({ sha256, blockType: "table-parent" }, chunks), "DOC-1-C0003");
});

test("every constraint is matched exactly, never approximately", () => {
  const target = chunk({ page: 4, isTable: 1, blockType: "table-row-group" });
  const chunks = [target];
  const sha256 = computeChunkAnchor(target);
  assert.equal(resolveChunkAnchor({ sha256, page: 4, isTable: true, documentName: "需求.pdf" }, chunks), "DOC-1-C0001");
  // 约束不符即为未命中，不做就近匹配。
  assert.throws(() => resolveChunkAnchor({ sha256, page: 5 }, chunks), /matched no chunk/);
  assert.throws(() => resolveChunkAnchor({ sha256, isTable: false }, chunks), /matched no chunk/);
  assert.throws(() => resolveChunkAnchor({ sha256, documentName: "别的.pdf" }, chunks), /matched no chunk/);
});

test("malformed anchors are rejected before any matching happens", () => {
  const chunks = [chunk()];
  assert.throws(() => resolveChunkAnchor({ sha256: "not-a-hash" }, chunks), /requires a lowercase hex sha256/);
  assert.throws(() => resolveChunkAnchor({}, chunks), /requires a lowercase hex sha256/);
  assert.throws(
    () => resolveChunkAnchor({ sha256: computeChunkAnchor(chunk()), headingPath: "1.1" }, chunks),
    /unsupported constraint\(s\): headingPath/,
  );
});

test("anchor text normalization ignores whitespace but not characters", () => {
  assert.equal(normalizeAnchorText(" a\n b\tc "), "abc");
  assert.equal(normalizeAnchorText(null), "");
  assert.notEqual(normalizeAnchorText("abc"), normalizeAnchorText("abd"));
  assert.equal(computeChunkAnchor({ text: "a b" }), computeChunkAnchor({ text: "ab" }));
});

function base(overrides = {}) {
  return { id: "KB-1", name: "合同审核", scope: "project", projectId: "default-project", ...overrides };
}

test("a knowledge base anchor resolves by name plus scope and project", () => {
  const bases = [base(), base({ id: "KB-2", name: "XX单" })];
  assert.equal(resolveKnowledgeBaseAnchor({ name: "合同审核", scope: "project", projectId: "default-project" }, bases), "KB-1");
  assert.equal(resolveKnowledgeBaseAnchor({ name: "XX单" }, bases), "KB-2");
});

test("a knowledge base anchor survives a rebuild that changes the id", () => {
  const anchor = { name: "合同审核", scope: "project", projectId: "default-project" };
  const rebuilt = [base({ id: "KB-9999999999999-zzzzz" })];
  assert.equal(resolveKnowledgeBaseAnchor(anchor, rebuilt), "KB-9999999999999-zzzzz");
});

test("a knowledge base anchor fails on zero and on multiple matches", () => {
  const bases = [base()];
  assert.throws(
    () => resolveKnowledgeBaseAnchor({ name: "不存在的库" }, bases, "case sem-01 kbAnchor 1"),
    /case sem-01 kbAnchor 1 matched no knowledge base/,
  );
  // 同名但分属不同 scope/project：必须报歧义而不是任选一个。
  const ambiguous = [base(), base({ id: "KB-2", scope: "global", projectId: "" })];
  assert.throws(() => resolveKnowledgeBaseAnchor({ name: "合同审核" }, ambiguous, "case sem-01 kbAnchor 1"), (error) => {
    assert.match(error.message, /matched 2 knowledge bases/);
    assert.match(error.message, /Add a distinguishing constraint/);
    assert.match(error.message, /KB-1/);
    assert.match(error.message, /KB-2/);
    return true;
  });
  // 补上 scope 后即可唯一确定。
  assert.equal(resolveKnowledgeBaseAnchor({ name: "合同审核", scope: "global" }, ambiguous), "KB-2");
});

test("knowledge base constraints are exact and the shape is validated", () => {
  const bases = [base()];
  assert.throws(() => resolveKnowledgeBaseAnchor({ name: "合同审核", scope: "global" }, bases), /matched no knowledge base/);
  assert.throws(() => resolveKnowledgeBaseAnchor({ name: "合同审核", projectId: "other" }, bases), /matched no knowledge base/);
  assert.throws(() => resolveKnowledgeBaseAnchor({ name: "" }, bases), /requires a name/);
  assert.throws(() => resolveKnowledgeBaseAnchor({ name: "合同审核", description: "x" }, bases), /unsupported constraint\(s\): description/);
});

test("document names resolve to exactly one document id", () => {
  const chunks = [
    chunk({ id: "DOC-1-C0001", documentId: "DOC-1", documentName: "测试.pdf" }),
    chunk({ id: "DOC-1-C0002", documentId: "DOC-1", documentName: "测试.pdf" }),
    chunk({ id: "DOC-2-C0001", documentId: "DOC-2", documentName: "其他.pdf" }),
  ];
  assert.equal(resolveDocumentName("测试.pdf", chunks), "DOC-1");
  assert.throws(() => resolveDocumentName("缺失.pdf", chunks), /matched no document/);
  const duplicated = [...chunks, chunk({ id: "DOC-3-C0001", documentId: "DOC-3", documentName: "测试.pdf" })];
  assert.throws(() => resolveDocumentName("测试.pdf", duplicated), /matched 2 documents/);
});

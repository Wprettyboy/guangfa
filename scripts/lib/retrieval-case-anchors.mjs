import { createHash } from "node:crypto";

// 评测用例过去直接写死 chunk id，而 id 里带着入库时间戳（DOC-<ms>-<rand>-C0001），
// 同一份文件重新入库就会换一批 id，用例随之失效且看起来像检索质量下降。
// 这里改用“内容锚点”：对权威子块正文做归一化后取 SHA-256，再配合文档与块约束定位。
//
// 归一化只做 NFKC 与去除全部空白：重新解析同一份文件时换行与空格可能变化，
// 但字符内容不变。刻意不做任何模糊匹配或降级回退——锚点要么精确命中一个子块，
// 要么直接报错，绝不允许静默匹配到"看起来差不多"的子块。
function normalizeAnchorText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function computeChunkAnchor(chunk) {
  return createHash("sha256").update(normalizeAnchorText(chunk?.text)).digest("hex");
}

// 约束一律精确相等。父块与行分组块可能携带完全相同的正文（例如表格父块与其行分组），
// 此时内容哈希会同时命中多个子块，必须由 blockType 之类的约束区分。
const anchorConstraints = {
  documentName: (chunk, value) => String(chunk.documentName || "") === String(value),
  blockType: (chunk, value) => String(chunk.blockType || "") === String(value),
  isTable: (chunk, value) => Boolean(chunk.isTable) === Boolean(value),
  page: (chunk, value) => Number(chunk.page) === Number(value),
};

function describeAnchor(anchor) {
  const constraints = Object.keys(anchorConstraints)
    .filter((key) => anchor[key] !== undefined)
    .map((key) => `${key}=${JSON.stringify(anchor[key])}`);
  return `sha256=${anchor.sha256}${constraints.length ? ` (${constraints.join(", ")})` : ""}`;
}

function describeChunk(chunk) {
  return `${chunk.id} [documentName=${JSON.stringify(chunk.documentName || "")}, blockType=${JSON.stringify(chunk.blockType || "")}, page=${chunk.page}, isTable=${Boolean(chunk.isTable)}]`;
}

function assertAnchorShape(anchor, label) {
  if (!anchor || typeof anchor !== "object") throw new Error(`${label} must be an object`);
  if (!/^[0-9a-f]{64}$/.test(String(anchor.sha256 || ""))) {
    throw new Error(`${label} requires a lowercase hex sha256, received ${JSON.stringify(anchor.sha256)}`);
  }
  const unknown = Object.keys(anchor).filter((key) => key !== "sha256" && !(key in anchorConstraints));
  if (unknown.length > 0) {
    throw new Error(`${label} carries unsupported constraint(s): ${unknown.join(", ")}. Supported: ${Object.keys(anchorConstraints).join(", ")}`);
  }
}

// 命中 0 个或多个都视为用例失效，直接抛错并把候选块打印出来，
// 让维护者知道该补哪个约束或该重新生成锚点，而不是悄悄放过。
function resolveChunkAnchor(anchor, chunks, label = "anchor") {
  assertAnchorShape(anchor, label);
  const matches = (chunks || []).filter((chunk) => {
    if (computeChunkAnchor(chunk) !== anchor.sha256) return false;
    return Object.entries(anchorConstraints)
      .every(([key, matcher]) => anchor[key] === undefined || matcher(chunk, anchor[key]));
  });
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new Error(`${label} matched no chunk: ${describeAnchor(anchor)}. The anchored content is absent from the index; re-ingest the document or regenerate the anchor.`);
  }
  throw new Error(`${label} matched ${matches.length} chunks: ${describeAnchor(anchor)}. Add a distinguishing constraint. Candidates: ${matches.map(describeChunk).join(" | ")}`);
}

// 知识库 id 同样带时间戳（KB-<ms>-<rand>），重建知识库就会失效。
// knowledge_bases 上有 UNIQUE(name, scope, project_id)，因此这三者是天然的稳定键。
const knowledgeBaseConstraints = {
  scope: (base, value) => String(base.scope || "") === String(value),
  projectId: (base, value) => String(base.projectId ?? "") === String(value ?? ""),
};

function resolveKnowledgeBaseAnchor(anchor, bases, label = "knowledge base anchor") {
  if (!anchor || typeof anchor !== "object") throw new Error(`${label} must be an object`);
  const name = String(anchor.name ?? "");
  if (!name) throw new Error(`${label} requires a name, received ${JSON.stringify(anchor.name)}`);
  const unknown = Object.keys(anchor).filter((key) => key !== "name" && !(key in knowledgeBaseConstraints));
  if (unknown.length > 0) {
    throw new Error(`${label} carries unsupported constraint(s): ${unknown.join(", ")}. Supported: name, ${Object.keys(knowledgeBaseConstraints).join(", ")}`);
  }
  const matches = (bases || []).filter((base) => {
    if (String(base.name || "") !== name) return false;
    return Object.entries(knowledgeBaseConstraints)
      .every(([key, matcher]) => anchor[key] === undefined || matcher(base, anchor[key]));
  });
  if (matches.length === 1) return matches[0].id;
  const described = `name=${JSON.stringify(name)}${Object.keys(knowledgeBaseConstraints).filter((k) => anchor[k] !== undefined).map((k) => `, ${k}=${JSON.stringify(anchor[k])}`).join("")}`;
  if (matches.length === 0) throw new Error(`${label} matched no knowledge base: ${described}.`);
  throw new Error(`${label} matched ${matches.length} knowledge bases: ${described}. Add a distinguishing constraint. Candidates: ${matches.map((base) => `${base.id} [scope=${JSON.stringify(base.scope || "")}, projectId=${JSON.stringify(base.projectId ?? "")}]`).join(" | ")}`);
}

// 过滤器里的 documentIds 同样带时间戳，用文件名定位并要求唯一。
function resolveDocumentName(documentName, chunks, label = "documentName") {
  const ids = [...new Set((chunks || [])
    .filter((chunk) => String(chunk.documentName || "") === String(documentName))
    .map((chunk) => chunk.documentId))];
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new Error(`${label} matched no document: ${JSON.stringify(documentName)}`);
  throw new Error(`${label} matched ${ids.length} documents: ${JSON.stringify(documentName)} -> ${ids.join(", ")}. Document names must be unique to be used as a case constraint.`);
}

export {
  computeChunkAnchor,
  normalizeAnchorText,
  resolveChunkAnchor,
  resolveDocumentName,
  resolveKnowledgeBaseAnchor,
};

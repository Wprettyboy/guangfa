import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getEmbeddingConfig } from "../embedding.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const zvecDir = path.join(knowledgeDir, "zvec");
const knowledgeZvecCollectionPath = path.join(zvecDir, "chunks_v3");
const vectorFieldName = "embedding";
const textFieldName = "text";
const outputFields = ["kbId", "scope", "projectId", "documentId", "documentName", "chunkIndex", "page", "paragraphStart", "paragraphEnd", "text", "createdAt"];

function createKnowledgeZvecSchema(zvec, dimension = getEmbeddingConfig().dimension) {
  return new zvec.ZVecCollectionSchema({
    name: "knowledge_chunks",
    vectors: {
      name: vectorFieldName,
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: zvec.ZVecIndexType.FLAT,
        metricType: zvec.ZVecMetricType.COSINE,
      },
    },
    fields: [
      { name: "kbId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "scope", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "projectId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "documentId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "documentName", dataType: zvec.ZVecDataType.STRING },
      { name: "chunkIndex", dataType: zvec.ZVecDataType.INT32 },
      { name: "page", dataType: zvec.ZVecDataType.STRING, nullable: true },
      { name: "paragraphStart", dataType: zvec.ZVecDataType.INT32, nullable: true },
      { name: "paragraphEnd", dataType: zvec.ZVecDataType.INT32, nullable: true },
      { name: textFieldName, dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.FTS } },
      { name: "createdAt", dataType: zvec.ZVecDataType.STRING },
    ],
  });
}

function createKnowledgeZvecFields(chunk) {
  return {
    kbId: chunk.kbId,
    scope: chunk.scope,
    projectId: chunk.projectId,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    chunkIndex: chunk.chunkIndex,
    page: chunk.page ? String(chunk.page) : "",
    paragraphStart: Number(chunk.paragraphStart || 0) || null,
    paragraphEnd: Number(chunk.paragraphEnd || 0) || null,
    text: chunk.text,
    createdAt: String(chunk.createdAt || ""),
  };
}

async function insertKnowledgeZvecChunks(chunks, embeddings) {
  if (!chunks.length) return [];
  const collection = await openKnowledgeZvecCollection({ create: true, readOnly: false });
  try {
    const statuses = collection.insertSync(
      chunks.map((chunk, index) => ({
        id: chunk.id,
        vectors: { [vectorFieldName]: embeddings[index] },
        fields: createKnowledgeZvecFields(chunk),
      })),
    );
    const failures = statuses.filter((status) => status && status.ok === false);
    if (failures.length > 0) {
      throw new Error(`zvec insert failed: ${JSON.stringify(failures.slice(0, 3))}`);
    }
    return statuses;
  } finally {
    collection.closeSync();
  }
}

async function deleteKnowledgeZvecChunks({ chunkIds = [], documentId = "", kbId = "" } = {}) {
  const collection = await openKnowledgeZvecCollection({ create: false, readOnly: false });
  if (!collection) return;
  try {
    if (chunkIds.length > 0) {
      try {
        collection.deleteSync(chunkIds);
      } catch {
        // The filter cleanup below is the authoritative cleanup path for stale rows.
      }
    }
    const filter = buildKnowledgeFilter({ kbId, documentId });
    if (filter) {
      collection.deleteByFilterSync(filter);
    }
  } finally {
    collection.closeSync();
  }
}

async function searchKnowledgeZvec({ query, embedding, topK, allowedKbIds, liveChunkIds }) {
  const collection = await openKnowledgeZvecCollection({ create: false, readOnly: true });
  if (!collection || !query || !allowedKbIds?.size) return [];
  const zvec = await import("@zvec/zvec");
  try {
    return queryKnowledgeZvecCollection(collection, zvec, { query, embedding, topK, allowedKbIds, liveChunkIds });
  } finally {
    collection.closeSync();
  }
}

function queryKnowledgeZvecCollection(collection, zvec, { query, embedding, topK, allowedKbIds, liveChunkIds }) {
  const filter = buildKnowledgeKbFilter(allowedKbIds);
  if (!filter) return [];
  const candidateCount = Math.max(topK * 8, 30);
  const queries = [];
  if (Array.isArray(embedding) && embedding.length > 0) {
    queries.push({ fieldName: vectorFieldName, vector: embedding, numCandidates: candidateCount });
  }
  if (String(query || "").trim()) {
    queries.push({
      fieldName: textFieldName,
      fts: { matchString: String(query).trim().slice(0, 240) },
      numCandidates: candidateCount,
      params: { indexType: zvec.ZVecIndexType.FTS, defaultOperator: "OR" },
    });
  }
  if (queries.length === 0) return [];

  const requestTopK = Math.max(topK * 4, 20);
  let rows = [];
  if (queries.length >= 2) {
    rows = collection.multiQuerySync({
      queries,
      filter,
      topk: requestTopK,
      includeVector: false,
      outputFields,
      rerank: { type: "rrf", rankConstant: 60 },
    });
  } else {
    const { numCandidates, ...query } = queries[0];
    rows = collection.querySync({
      ...query,
      filter,
      topk: requestTopK,
      includeVector: false,
      outputFields,
    });
  }
  const mode = queries.length >= 2 ? "hybrid" : queries[0].vector ? "vector" : "fts";
  return rows
    .map((row) => normalizeZvecResult(row, mode))
    .filter((item) => item && (!liveChunkIds?.size || liveChunkIds.has(item.id)))
    .slice(0, topK);
}

function normalizeZvecResult(row, mode) {
  const fields = row?.fields || {};
  if (!fields.kbId) return null;
  return {
    id: row.id,
    score: row.score || 0,
    mode,
    kbId: fields.kbId,
    scope: fields.scope,
    projectId: fields.projectId,
    documentId: fields.documentId,
    documentName: fields.documentName,
    chunkIndex: fields.chunkIndex,
    page: fields.page,
    paragraphStart: fields.paragraphStart,
    paragraphEnd: fields.paragraphEnd,
    text: fields.text,
    createdAt: fields.createdAt,
  };
}

function buildKnowledgeKbFilter(allowedKbIds) {
  const ids = [...(allowedKbIds || [])].filter(Boolean);
  if (ids.length === 0) return "";
  return `kbId IN (${ids.map(quoteFilterString).join(", ")})`;
}

function buildKnowledgeFilter({ kbId = "", documentId = "" } = {}) {
  return [
    kbId ? `kbId = ${quoteFilterString(kbId)}` : "",
    documentId ? `documentId = ${quoteFilterString(documentId)}` : "",
  ].filter(Boolean).join(" AND ");
}

function quoteFilterString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function openKnowledgeZvecCollection({ create, readOnly }) {
  if (!existsSync(knowledgeZvecCollectionPath) && !create) return null;
  await mkdir(zvecDir, { recursive: true });
  const zvec = await import("@zvec/zvec");
  if (existsSync(knowledgeZvecCollectionPath)) {
    return zvec.ZVecOpen(knowledgeZvecCollectionPath, { readOnly });
  }
  return zvec.ZVecCreateAndOpen(knowledgeZvecCollectionPath, createKnowledgeZvecSchema(zvec), { readOnly });
}

export {
  buildKnowledgeKbFilter,
  createKnowledgeZvecFields,
  createKnowledgeZvecSchema,
  deleteKnowledgeZvecChunks,
  insertKnowledgeZvecChunks,
  knowledgeZvecCollectionPath,
  queryKnowledgeZvecCollection,
  searchKnowledgeZvec,
  vectorFieldName,
};

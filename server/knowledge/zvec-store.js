import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEmbeddingConfig } from "../embedding.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const zvecDir = path.join(knowledgeDir, "zvec");
const knowledgeZvecCollectionPath = path.join(zvecDir, "chunks_v3");
const generationsDir = path.join(zvecDir, "generations");
const activeManifestPath = path.join(zvecDir, "active-v4.json");
const v4IndexVersion = 4;
const denseVectorFieldName = "denseEmbedding";
const sparseVectorFieldName = "sparseEmbedding";
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
    paragraphStart: Number(chunk.paragraphStart || 0) || 0,
    paragraphEnd: Number(chunk.paragraphEnd || 0) || 0,
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

function createKnowledgeZvecV4Schema(zvec, dimension = 1024) {
  return new zvec.ZVecCollectionSchema({
    name: "knowledge_chunks_v4",
    vectors: [
      {
        name: denseVectorFieldName,
        dataType: zvec.ZVecDataType.VECTOR_FP32,
        dimension,
        indexParams: { indexType: zvec.ZVecIndexType.FLAT, metricType: zvec.ZVecMetricType.COSINE },
      },
      {
        name: sparseVectorFieldName,
        dataType: zvec.ZVecDataType.SPARSE_VECTOR_FP32,
        indexParams: { indexType: zvec.ZVecIndexType.FLAT, metricType: zvec.ZVecMetricType.IP },
      },
    ],
    fields: [
      { name: "kbId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "scope", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "projectId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "documentId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "documentName", dataType: zvec.ZVecDataType.STRING },
      { name: "chunkIndex", dataType: zvec.ZVecDataType.INT32 },
      { name: "page", dataType: zvec.ZVecDataType.INT32, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "isTable", dataType: zvec.ZVecDataType.BOOL, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "hasStar", dataType: zvec.ZVecDataType.BOOL, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "blockType", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "headingPath", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "text", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.FTS } },
      { name: "createdAt", dataType: zvec.ZVecDataType.STRING },
    ],
  });
}

function createKnowledgeZvecV4Document(chunk, embedding) {
  return {
    id: chunk.id,
    vectors: {
      [denseVectorFieldName]: embedding.denseEmbedding,
      [sparseVectorFieldName]: embedding.sparseEmbedding,
    },
    fields: {
      kbId: String(chunk.kbId || ""),
      scope: chunk.scope === "global" ? "global" : "project",
      projectId: String(chunk.projectId || ""),
      documentId: String(chunk.documentId || ""),
      documentName: String(chunk.documentName || ""),
      chunkIndex: Number(chunk.chunkIndex || 0),
      page: Number(chunk.page || 0),
      isTable: Boolean(chunk.isTable),
      hasStar: Boolean(chunk.hasStar),
      blockType: String(chunk.blockType || ""),
      headingPath: String(chunk.headingPath || ""),
      text: String(chunk.text || ""),
      createdAt: String(chunk.createdAt || ""),
    },
  };
}

async function createKnowledgeZvecGeneration(generationName) {
  const generationPath = resolveGenerationPath(generationName);
  if (existsSync(generationPath)) throw new Error(`ZVec generation already exists: ${generationName}`);
  await mkdir(generationsDir, { recursive: true });
  const zvec = await import("@zvec/zvec");
  return {
    collection: zvec.ZVecCreateAndOpen(generationPath, createKnowledgeZvecV4Schema(zvec)),
    generationPath,
  };
}

async function openKnowledgeZvecGeneration(generationName, { readOnly = true } = {}) {
  const generationPath = resolveGenerationPath(generationName);
  if (!existsSync(generationPath)) return null;
  const zvec = await import("@zvec/zvec");
  return zvec.ZVecOpen(generationPath, { readOnly });
}

async function openActiveKnowledgeZvec({ readOnly = true } = {}) {
  const manifest = await readActiveKnowledgeZvecManifest();
  if (!manifest) return { collection: null, manifest: null };
  const collection = await openKnowledgeZvecGeneration(manifest.generation, { readOnly });
  if (!collection) {
    const error = new Error("Active ZVec generation is missing");
    error.code = "index_version_mismatch";
    throw error;
  }
  return { collection, manifest };
}

async function readActiveKnowledgeZvecManifest() {
  const raw = await readFile(activeManifestPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!raw) return null;
  const manifest = JSON.parse(raw);
  if (manifest?.indexVersion !== v4IndexVersion || !isGenerationName(manifest?.generation)) {
    const error = new Error("Active ZVec manifest is invalid");
    error.code = "index_version_mismatch";
    throw error;
  }
  return manifest;
}

async function publishActiveKnowledgeZvecManifest(manifest) {
  if (manifest?.indexVersion !== v4IndexVersion || !isGenerationName(manifest?.generation)) {
    throw new TypeError("Cannot publish an invalid ZVec manifest");
  }
  await mkdir(zvecDir, { recursive: true });
  const temporaryPath = `${activeManifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    await renameWithRetry(temporaryPath, activeManifestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeKnowledgeZvecGeneration(generationName) {
  await rm(resolveGenerationPath(generationName), { recursive: true, force: true });
}

async function pruneKnowledgeZvecGenerations(activeGeneration, keepPrevious = 1) {
  const names = await readdir(generationsDir).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const candidates = names.filter(isGenerationName).sort().reverse();
  const keep = new Set([activeGeneration, ...candidates.filter((name) => name !== activeGeneration).slice(0, keepPrevious)]);
  await Promise.all(candidates.filter((name) => !keep.has(name)).map(removeKnowledgeZvecGeneration));
}

async function renameWithRetry(source, destination) {
  const delays = [100, 250, 500, 1_000, 2_000];
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= delays.length || !["EBUSY", "EPERM", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastError;
}

function resolveGenerationPath(generationName) {
  if (!isGenerationName(generationName)) throw new TypeError("Invalid ZVec generation name");
  return path.join(generationsDir, generationName);
}

function isGenerationName(value) {
  return /^chunks-v4-[0-9]{8}T[0-9]{6}-[a-z0-9]{6,12}$/.test(String(value || ""));
}

export {
  activeManifestPath,
  buildKnowledgeKbFilter,
  createKnowledgeZvecFields,
  createKnowledgeZvecSchema,
  createKnowledgeZvecGeneration,
  createKnowledgeZvecV4Document,
  createKnowledgeZvecV4Schema,
  deleteKnowledgeZvecChunks,
  denseVectorFieldName,
  generationsDir,
  insertKnowledgeZvecChunks,
  knowledgeZvecCollectionPath,
  openActiveKnowledgeZvec,
  openKnowledgeZvecGeneration,
  pruneKnowledgeZvecGenerations,
  publishActiveKnowledgeZvecManifest,
  queryKnowledgeZvecCollection,
  readActiveKnowledgeZvecManifest,
  removeKnowledgeZvecGeneration,
  searchKnowledgeZvec,
  sparseVectorFieldName,
  v4IndexVersion,
  vectorFieldName,
};

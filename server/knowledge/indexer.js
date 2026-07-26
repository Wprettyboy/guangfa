import { randomUUID } from "node:crypto";
import { encodeRetrieval } from "../retrieval/model-client.js";
import { filterRetrievalKnowledgeChunks } from "./chunker.js";
import { createKnowledgeEmbeddingCache } from "./embedding-cache.js";
import {
  createKnowledgeZvecGeneration,
  createKnowledgeZvecV4Document,
  denseVectorFieldName,
  openKnowledgeZvecGeneration,
  pruneKnowledgeZvecGenerations,
  publishActiveKnowledgeZvecManifest,
  removeKnowledgeZvecGeneration,
  sparseVectorFieldName,
  v4IndexVersion,
} from "./zvec-store.js";

let writeQueue = Promise.resolve();

function enqueueKnowledgeIndexWrite(operation) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  return result;
}

function readKnowledgeIndexChunks(database) {
  const chunks = database.prepare(`
    SELECT c.id, c.kb_id AS kbId, b.scope, b.project_id AS projectId,
      c.document_id AS documentId, d.file_name AS documentName,
      c.chunk_index AS chunkIndex, c.page_number AS page, c.text,
      c.block_type AS blockType, c.heading_path AS headingPath,
      c.parent_chunk_id AS parentChunkId, c.is_table AS isTable,
      c.has_star AS hasStar, c.created_at AS createdAt
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    JOIN knowledge_bases b ON b.id = c.kb_id AND b.deleted_at IS NULL
    ORDER BY c.document_id, c.chunk_index
  `).all();
  return filterRetrievalKnowledgeChunks(chunks);
}

async function rebuildKnowledgeIndexV4(database, options = {}) {
  return enqueueKnowledgeIndexWrite(async () => {
    const startedAt = Date.now();
    const chunks = readKnowledgeIndexChunks(database);
    const embeddingCache = options.embeddingCache === null
      ? null
      : options.embeddingCache || createKnowledgeEmbeddingCache(database);
    const manifest = await buildKnowledgeIndexGeneration(chunks, { ...options, embeddingCache });
    updateKnowledgeIndexState(database, manifest);
    await pruneKnowledgeZvecGenerations(manifest.generation, 1);
    if (embeddingCache) embeddingCache.prune(chunks.map((chunk) => embeddingCache.hash(chunk.text)));
    console.log(`[knowledge] V4 索引重建完成：${manifest.chunkCount} 个子块（新编码 ${manifest.encodedChunkCount}、缓存复用 ${manifest.cachedChunkCount}），耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return manifest;
  });
}

async function buildKnowledgeIndexGeneration(chunks, {
  encode = encodeRetrieval,
  batchSize = 8,
  now = new Date(),
  publish = true,
  embeddingCache = null,
} = {}) {
  const generation = createGenerationName(now);
  const { collection } = await createKnowledgeZvecGeneration(generation);
  const sparseCounts = [];
  let closed = false;
  try {
    const resolved = await resolveChunkEmbeddings(chunks, { encode, batchSize, embeddingCache });
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const documents = batch.map((chunk, index) => {
        const embedding = resolved.embeddings[start + index];
        sparseCounts.push(Object.keys(embedding.sparseEmbedding).length);
        return createKnowledgeZvecV4Document(chunk, embedding);
      });
      assertStatuses(collection.insertSync(documents));
    }
    collection.optimizeSync();
    await validateWritableGeneration(collection, chunks, encode);
    collection.closeSync();
    closed = true;
    await validateReopenedGeneration(generation, chunks);

    const manifest = {
      indexVersion: v4IndexVersion,
      generation,
      generationPath: `generations/${generation}`,
      builtAt: now.toISOString(),
      chunkCount: chunks.length,
      denseModel: "BAAI/bge-m3",
      sparseModel: "BAAI/bge-m3",
      sparseMinWeight: 0.01,
      sparseMaxTerms: 192,
      sparseTerms: summarizeSparseCounts(sparseCounts),
      encodedChunkCount: resolved.encodedCount,
      cachedChunkCount: resolved.cachedCount,
    };
    if (publish) await publishActiveKnowledgeZvecManifest(manifest);
    return manifest;
  } catch (error) {
    if (!closed) {
      try { collection.closeSync(); } catch {}
    }
    await removeKnowledgeZvecGeneration(generation).catch(() => {});
    throw error;
  }
}

async function resolveChunkEmbeddings(chunks, { encode, batchSize, embeddingCache }) {
  if (!embeddingCache) {
    const embeddings = [];
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      embeddings.push(...await encodeIndexBatch(batch.map((chunk) => chunk.text), encode));
    }
    return { embeddings, encodedCount: chunks.length, cachedCount: 0 };
  }
  const hashes = chunks.map((chunk) => embeddingCache.hash(chunk.text));
  const cached = embeddingCache.load(hashes);
  const embeddings = new Array(chunks.length);
  const missing = [];
  chunks.forEach((chunk, index) => {
    const hit = cached.get(hashes[index]);
    if (hit) embeddings[index] = hit;
    else missing.push(index);
  });
  for (let start = 0; start < missing.length; start += batchSize) {
    const batchIndexes = missing.slice(start, start + batchSize);
    const encoded = await encodeIndexBatch(batchIndexes.map((index) => chunks[index].text), encode);
    const entries = batchIndexes.map((chunkIndex, position) => {
      embeddings[chunkIndex] = encoded[position];
      return { hash: hashes[chunkIndex], ...encoded[position] };
    });
    embeddingCache.save(entries);
  }
  return { embeddings, encodedCount: missing.length, cachedCount: chunks.length - missing.length };
}

async function encodeIndexBatch(texts, encode) {
  try {
    return await encode(texts, { indexing: true });
  } catch (error) {
    if (error?.code !== "retrieval_oom" || texts.length < 2) throw error;
    const middle = Math.ceil(texts.length / 2);
    const left = await encode(texts.slice(0, middle), { indexing: true });
    const right = await encode(texts.slice(middle), { indexing: true });
    return [...left, ...right];
  }
}

async function validateWritableGeneration(collection, chunks, encode) {
  if (!chunks.length) return;
  const first = chunks[0];
  const fetched = collection.fetchSync({ ids: [first.id], includeVector: false });
  if (!fetched[first.id]) throw new Error("ZVec generation fetch validation failed");
  const [embedding] = await encode([first.text], { indexing: true });
  const filter = `kbId = ${quoteFilterString(first.kbId)}`;
  const queries = [
    { fieldName: denseVectorFieldName, vector: embedding.denseEmbedding, numCandidates: 60 },
    { fieldName: sparseVectorFieldName, vector: embedding.sparseEmbedding, numCandidates: 60 },
    { fieldName: "text", fts: { matchString: first.text.slice(0, 120) }, numCandidates: 60 },
  ];
  for (const query of queries) {
    const rows = collection.querySync({ ...query, filter, topk: 1, outputFields: ["kbId", "documentId", "page"] });
    if (!rows.length || rows[0].fields.kbId !== first.kbId) throw new Error(`ZVec ${query.fieldName} validation failed`);
  }
}

async function validateReopenedGeneration(generation, chunks) {
  const collection = await openKnowledgeZvecGeneration(generation, { readOnly: true });
  if (!collection) throw new Error("ZVec generation reopen validation failed");
  try {
    if (!chunks.length) return;
    const fetched = collection.fetchSync({ ids: [chunks[0].id], includeVector: false });
    if (!fetched[chunks[0].id]) throw new Error("ZVec reopened generation is missing data");
  } finally {
    collection.closeSync();
  }
}

// 只记录索引状态本身。文档状态由各自的处理链路负责：跨文档批量改写会把别的资料的
// “部分可用”“标题物理页映射失败”等真实状态和告警静默清掉。
function updateKnowledgeIndexState(database, manifest) {
  database.prepare(`
    INSERT INTO schema_meta (key, value) VALUES ('knowledge_index_v4', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(manifest));
}

// 重建成功后，只把“因为向量索引不可用而降级”的资料恢复回可检索状态，并且只摘掉
// 对应的那条告警，保留同一条 error 里的其它告警（例如标题物理页映射不全）。
const vectorIndexWarningPattern = /^(?:向量索引不可用：|未配置 embedding)/;

function healVectorDegradedDocuments(database, kbId) {
  const rows = database.prepare(`
    SELECT id, COALESCE(error, '') AS error, image_failed_count AS imageFailedCount
    FROM knowledge_documents
    WHERE kb_id = ? AND deleted_at IS NULL AND chunk_count > 0 AND status = '关键词可用'
  `).all(kbId);
  if (rows.length === 0) return 0;
  const update = database.prepare(`
    UPDATE knowledge_documents
    SET status = ?, index_mode = 'dense-sparse-fts', error = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `);
  const now = Date.now();
  rows.forEach((row) => {
    const remaining = row.error
      .split("；")
      .map((segment) => segment.trim())
      .filter((segment) => segment && !vectorIndexWarningPattern.test(segment))
      .join("；");
    update.run(row.imageFailedCount > 0 ? "部分可用" : "已索引", remaining, now, row.id);
  });
  return rows.length;
}

function createGenerationName(now) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return `chunks-v4-${timestamp}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function summarizeSparseCounts(values) {
  if (!values.length) return { average: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted.at(-1),
  };
}

function assertStatuses(statuses) {
  const rows = Array.isArray(statuses) ? statuses : [statuses];
  const failures = rows.filter((status) => !status?.ok);
  if (rows.length === 0 || failures.length) throw new Error(`ZVec write failed: ${JSON.stringify(failures.slice(0, 3))}`);
}

function quoteFilterString(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export {
  buildKnowledgeIndexGeneration,
  createGenerationName,
  encodeIndexBatch,
  enqueueKnowledgeIndexWrite,
  healVectorDegradedDocuments,
  readKnowledgeIndexChunks,
  rebuildKnowledgeIndexV4,
  summarizeSparseCounts,
};

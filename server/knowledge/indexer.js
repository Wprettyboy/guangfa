import { randomUUID } from "node:crypto";
import { encodeRetrieval } from "../retrieval/model-client.js";
import { filterRetrievalKnowledgeChunks } from "./chunker.js";
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
    const chunks = readKnowledgeIndexChunks(database);
    const manifest = await buildKnowledgeIndexGeneration(chunks, options);
    updateKnowledgeIndexState(database, manifest);
    await pruneKnowledgeZvecGenerations(manifest.generation, 1);
    return manifest;
  });
}

async function buildKnowledgeIndexGeneration(chunks, {
  encode = encodeRetrieval,
  batchSize = 8,
  now = new Date(),
  publish = true,
} = {}) {
  const generation = createGenerationName(now);
  const { collection } = await createKnowledgeZvecGeneration(generation);
  const sparseCounts = [];
  let closed = false;
  try {
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const embeddings = await encodeIndexBatch(batch.map((chunk) => chunk.text), encode);
      const documents = batch.map((chunk, index) => {
        sparseCounts.push(Object.keys(embeddings[index].sparseEmbedding).length);
        return createKnowledgeZvecV4Document(chunk, embeddings[index]);
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

function updateKnowledgeIndexState(database, manifest) {
  database.prepare(`
    INSERT INTO schema_meta (key, value) VALUES ('knowledge_index_v4', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(manifest));
  database.prepare(`
    UPDATE knowledge_documents
    SET status = CASE WHEN chunk_count > 0 THEN '已索引' ELSE status END,
        index_mode = CASE WHEN chunk_count > 0 THEN 'dense-sparse-fts' ELSE index_mode END,
        error = CASE WHEN chunk_count > 0 THEN '' ELSE error END,
        updated_at = ?
    WHERE deleted_at IS NULL
  `).run(Date.now());
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
  readKnowledgeIndexChunks,
  rebuildKnowledgeIndexV4,
  summarizeSparseCounts,
};

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const { createKnowledgeEmbeddingCache, hashKnowledgeEmbeddingText } = await import("../server/knowledge/embedding-cache.js");
const { denseDimension } = await import("../server/retrieval/model-client.js");

function denseVector(seed) {
  return Array.from({ length: denseDimension }, (_, index) => ((index + 1) * seed % 97) / 97);
}

test("embedding cache saves, reloads and prunes entries by text hash", () => {
  const database = new DatabaseSync(":memory:");
  const cache = createKnowledgeEmbeddingCache(database);
  const hashA = cache.hash("资质要求：ISO27001");
  const hashB = cache.hash("商务要求：近三年业绩");
  assert.equal(hashA, hashKnowledgeEmbeddingText("BAAI/bge-m3", "资质要求：ISO27001"));
  assert.notEqual(hashA, hashB);
  assert.notEqual(hashA, hashKnowledgeEmbeddingText("other-model", "资质要求：ISO27001"));

  cache.save([
    { hash: hashA, denseEmbedding: denseVector(1), sparseEmbedding: { 101: 0.8, 205: 0.2 } },
    { hash: hashB, denseEmbedding: denseVector(2), sparseEmbedding: { 300: 0.5 } },
  ]);
  const loaded = cache.load([hashA, hashB, cache.hash("未入库文本")]);
  assert.equal(loaded.size, 2);
  assert.equal(loaded.get(hashA).denseEmbedding.length, denseDimension);
  assert.deepEqual(loaded.get(hashB).sparseEmbedding, { 300: 0.5 });

  assert.equal(cache.prune([hashA]), 1);
  assert.equal(cache.load([hashA]).size, 1);
  assert.equal(cache.load([hashB]).size, 0);
});

test("embedding cache rejects invalid rows instead of returning corrupt embeddings", () => {
  const database = new DatabaseSync(":memory:");
  const cache = createKnowledgeEmbeddingCache(database);
  const validHash = cache.hash("valid");
  cache.save([
    { hash: validHash, denseEmbedding: denseVector(3), sparseEmbedding: { 7: 0.4 } },
    { hash: cache.hash("bad-dense"), denseEmbedding: [1, 2, 3], sparseEmbedding: { 7: 0.4 } },
    { hash: cache.hash("bad-sparse"), denseEmbedding: denseVector(4), sparseEmbedding: {} },
  ]);
  assert.equal(cache.load([cache.hash("bad-dense"), cache.hash("bad-sparse")]).size, 0);

  database.prepare("UPDATE knowledge_chunk_embeddings SET dense_json = ? WHERE text_hash = ?").run("not-json", validHash);
  assert.equal(cache.load([validHash]).size, 0);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM knowledge_chunk_embeddings").get().count,
    0,
  );
});

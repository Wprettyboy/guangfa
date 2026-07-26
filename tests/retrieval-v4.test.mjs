import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const originalCwd = process.cwd();
const testRoot = await mkdtemp(path.join(tmpdir(), "guangfa-retrieval-v4-"));
process.chdir(testRoot);

const { CircuitBreaker } = await import("../server/retrieval/circuit-breaker.js");
const { validateEncodeResponse, validateRerankResponse } = await import("../server/retrieval/model-client.js");
const { buildKnowledgeIndexGeneration, encodeIndexBatch } = await import("../server/knowledge/indexer.js");
const { reciprocalRankFusion, searchKnowledgeV4 } = await import("../server/knowledge/search.js");
const { applyKnowledgeSearchFilters, normalizeKnowledgeSearchFilters } = await import("../server/knowledge/search-filters.js");
const { activeManifestPath, readActiveKnowledgeZvecManifest } = await import("../server/knowledge/zvec-store.js");

after(async () => {
  process.chdir(originalCwd);
  await rm(testRoot, { recursive: true, force: true });
});

test("retrieval model protocol validates dense, sparse and reranker payloads", () => {
  const encoded = validateEncodeResponse({
    data: [{ dense_embedding: denseVector(1), sparse_embedding: { "101": 0.5, "2054": 0.12 } }],
  }, 1);
  assert.equal(encoded[0].denseEmbedding.length, 1024);
  assert.deepEqual(encoded[0].sparseEmbedding, { 101: 0.5, 2054: 0.12 });
  assert.deepEqual(validateRerankResponse({ data: [{ index: 1, score: 0.2 }, { index: 0, score: 0.8 }] }, 2), [0.8, 0.2]);
  assert.throws(() => validateEncodeResponse({ data: [{ dense_embedding: [1], sparse_embedding: {} }] }, 1), /1024/);
  assert.throws(() => validateEncodeResponse({ data: [{ dense_embedding: denseVector(1), sparse_embedding: { bad: 1 } }] }, 1), /invalid token/);
});

test("circuit breaker opens after consecutive failures and permits one half-open probe", async () => {
  let now = 1_000;
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetMs: 30_000, now: () => now });
  const fail = () => breaker.run(async () => {
    const error = new Error("timeout");
    error.circuitFailure = true;
    throw error;
  }, "encode_circuit_open");
  await assert.rejects(fail);
  await assert.rejects(fail);
  await assert.rejects(fail);
  await assert.rejects(fail, (error) => error.code === "encode_circuit_open");
  now += 30_000;
  assert.equal(await breaker.run(async () => "ok", "encode_circuit_open"), "ok");
  assert.equal(breaker.state(), "closed");
});

test("index OOM halves one batch before failing closed", async () => {
  const calls = [];
  const rows = await encodeIndexBatch(["a", "b", "c", "d"], async (texts) => {
    calls.push(texts.length);
    if (texts.length === 4) {
      const error = new Error("oom");
      error.code = "retrieval_oom";
      throw error;
    }
    return texts.map((_, index) => embedding(index + texts.length));
  });
  assert.deepEqual(calls, [4, 2, 2]);
  assert.equal(rows.length, 4);
});

test("structured filters are exact and RRF uses ranks instead of raw scores", () => {
  const filters = normalizeKnowledgeSearchFilters({ documentIds: ["DOC-1"], pageFrom: 2, pageTo: 2, isTable: true, hasStar: false });
  const rows = applyKnowledgeSearchFilters([
    chunk("C-1", "one", 1),
    chunk("C-2", "two", 2),
    { ...chunk("C-3", "three", 2), documentId: "DOC-2" },
  ], filters);
  assert.deepEqual(rows.map((item) => item.id), ["C-2"]);
  const fused = reciprocalRankFusion({
    dense: [{ id: "A", text: "a", channelScore: 0.1 }, { id: "B", text: "b", channelScore: 100 }],
    sparse: [{ id: "A", text: "a", channelScore: 0.01 }],
    fts: [],
  });
  assert.equal(fused[0].id, "A");
  assert.equal(fused[0].matchedChannels.length, 2);
});

test("index generation reuses cached embeddings and only encodes new chunks", async () => {
  const chunks = [
    chunk("C-10", "cached qualification text", 1),
    chunk("C-11", "cached business text", 2),
    chunk("C-12", "fresh technical text", 1),
  ];
  const store = new Map();
  const fakeCache = {
    hash: (text) => `hash:${text}`,
    load: (hashes) => new Map([...new Set(hashes)].filter((hash) => store.has(hash)).map((hash) => [hash, store.get(hash)])),
    save: (entries) => entries.forEach((entry) => store.set(entry.hash, {
      denseEmbedding: entry.denseEmbedding,
      sparseEmbedding: entry.sparseEmbedding,
    })),
    prune: () => 0,
  };
  store.set("hash:cached qualification text", embedding(11));
  store.set("hash:cached business text", embedding(12));

  const encodedTexts = [];
  const encode = async (texts) => {
    encodedTexts.push(...texts);
    return texts.map((_, index) => embedding(index + 30));
  };
  const manifest = await buildKnowledgeIndexGeneration(chunks, {
    encode,
    embeddingCache: fakeCache,
    now: new Date("2026-07-26T10:00:00Z"),
    publish: false,
  });
  assert.equal(manifest.chunkCount, 3);
  assert.equal(manifest.encodedChunkCount, 1);
  assert.equal(manifest.cachedChunkCount, 2);
  assert.deepEqual(encodedTexts.filter((text) => text !== chunks[0].text), ["fresh technical text"]);
  assert.equal(store.has("hash:fresh technical text"), true);
});

test("immutable generation publishes only after close and reopen validation", async () => {
  const chunks = [
    chunk("C-1", "ISO27001 qualification requirement", 1),
    chunk("C-2", "GB/T 19001 quality requirement", 2),
  ];
  const encode = async (texts) => texts.map((_, index) => embedding(index + 1));
  const first = await buildKnowledgeIndexGeneration(chunks, { encode, now: new Date("2026-07-25T12:00:00Z") });
  assert.equal(first.indexVersion, 4);
  assert.equal(first.chunkCount, 2);
  assert.equal((await readActiveKnowledgeZvecManifest()).generation, first.generation);
  const before = await readFile(activeManifestPath, "utf8");

  const second = await buildKnowledgeIndexGeneration(chunks, { encode, now: new Date("2026-07-25T12:00:01Z") });
  assert.notEqual(second.generation, first.generation);
  assert.equal((await readActiveKnowledgeZvecManifest()).generation, second.generation);
  const activeBeforeFailure = await readFile(activeManifestPath, "utf8");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (String(url).endsWith("/retrieval/encode")) {
        return Response.json({ data: body.input.map((_, index) => ({
          dense_embedding: denseVector(index + 1),
          sparse_embedding: { "101": 0.8, "201": 0.2 },
        })) });
      }
      if (String(url).endsWith("/rerank")) {
        return Response.json({ data: body.documents.map((_, index) => ({ index, score: 1 - index / 10 })) });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const result = await searchKnowledgeV4({
      query: "qualification",
      allowedKbIds: new Set(["KB-1"]),
      eligibleChunks: chunks,
      liveChunkIds: new Set(chunks.map((item) => item.id)),
      filters: { pageFrom: 1, pageTo: 1, isTable: false, hasStar: true },
      topK: 5,
    });
    assert.deepEqual(result.items.map((item) => item.id), ["C-1"]);
    assert.equal(result.diagnostics.reranker, "applied");
    assert.equal(result.diagnostics.candidateCount, 1);
    assert.equal(result.items[0].page, 1);

    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (String(url).endsWith("/retrieval/encode")) {
        return Response.json({ data: body.input.map(() => ({ dense_embedding: denseVector(1), sparse_embedding: { "101": 0.8 } })) });
      }
      return Response.json({ detail: "reranker unavailable" }, { status: 503 });
    };
    const degraded = await searchKnowledgeV4({
      query: "qualification",
      allowedKbIds: new Set(["KB-1"]),
      eligibleChunks: chunks,
      liveChunkIds: new Set(chunks.map((item) => item.id)),
      topK: 2,
    });
    assert.equal(degraded.diagnostics.reranker, "degraded");
    assert.equal(degraded.diagnostics.degradedReasons.includes("reranker_timeout"), true);
    assert.equal(degraded.items.every((item) => item.rerankScore == null), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  await assert.rejects(
    buildKnowledgeIndexGeneration(chunks, {
      encode: async () => { throw new Error("model unavailable"); },
      now: new Date("2026-07-25T12:00:02Z"),
    }),
    /model unavailable/,
  );
  assert.notEqual(activeBeforeFailure, before);
  assert.equal(await readFile(activeManifestPath, "utf8"), activeBeforeFailure);
});

function chunk(id, text, page) {
  return {
    id,
    kbId: "KB-1",
    scope: "project",
    projectId: "P-1",
    documentId: "DOC-1",
    documentName: "requirements.pdf",
    chunkIndex: page,
    page,
    isTable: page === 2,
    hasStar: page === 1,
    blockType: page === 2 ? "table-row-group" : "paragraph",
    headingPath: "Chapter 1",
    text,
    createdAt: 1,
  };
}

function embedding(seed) {
  return { denseEmbedding: denseVector(seed), sparseEmbedding: { [100 + seed]: 0.8, [200 + seed]: 0.2 } };
}

function denseVector(seed) {
  const vector = Array.from({ length: 1024 }, (_, index) => ((index + 1) * seed % 97) / 97);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

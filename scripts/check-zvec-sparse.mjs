import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as zvec from "@zvec/zvec";

const options = readOptions(process.argv.slice(2));
const collectionDir = path.join(os.tmpdir(), `guangfa-zvec-sparse-${process.pid}-${Date.now()}`);
const schema = createSchema();
const queryTimes = [];

try {
  const collection = zvec.ZVecCreateAndOpen(collectionDir, schema);
  const insertedAt = performance.now();
  for (let start = 0; start < options.rows; start += options.batchSize) {
    const size = Math.min(options.batchSize, options.rows - start);
    assertStatuses(collection.insertSync(Array.from({ length: size }, (_, index) => createDocument(start + index, options.terms))));
  }
  const insertMs = performance.now() - insertedAt;

  const upserted = createDocument(0, options.terms);
  upserted.fields.headingPath = "updated-heading";
  assert.equal(collection.upsertSync(upserted).ok, true);

  const updated = Array.from({ length: 100 }, (_, index) => {
    const document = createDocument(index, options.terms);
    document.vectors.sparseEmbedding[249_999] = 1 + index / 100;
    return document;
  });
  assertStatuses(collection.updateSync(updated));

  const queryVector = createSparseVector(77, options.terms);
  for (let index = 0; index < options.queries; index += 1) {
    const startedAt = performance.now();
    const rows = collection.querySync({
      fieldName: "sparseEmbedding",
      vector: queryVector,
      filter: 'kbId = "kb-b" AND page >= 1 AND page <= 500 AND isTable = true AND hasStar = true',
      topk: 20,
      outputFields: ["kbId", "page", "isTable", "hasStar", "text"],
    });
    queryTimes.push(performance.now() - startedAt);
    assert.equal(rows.length, 20);
    assert(rows.every((row) => row.fields.kbId === "kb-b" && row.fields.isTable && row.fields.hasStar));
  }

  const hybrid = collection.multiQuerySync({
    queries: [
      { fieldName: "denseEmbedding", vector: createDenseVector(77), numCandidates: 60 },
      { fieldName: "sparseEmbedding", vector: queryVector, numCandidates: 60 },
      { fieldName: "text", fts: { matchString: "ISO27001" }, numCandidates: 60, params: { indexType: zvec.ZVecIndexType.FTS } },
    ],
    filter: 'kbId = "kb-b"',
    topk: 20,
    outputFields: ["kbId", "text"],
    rerank: { type: "rrf", rankConstant: 60 },
  });
  assert.equal(hybrid.length, 20);
  assert(hybrid.every((row) => row.fields.kbId === "kb-b"));

  const deleteIds = Array.from({ length: 100 }, (_, index) => `chunk-${options.rows - index - 1}`);
  assertStatuses(collection.deleteSync(deleteIds));
  collection.optimizeSync();
  collection.closeSync();

  const reopened = zvec.ZVecOpen(collectionDir, { readOnly: true });
  const fetched = reopened.fetchSync({ ids: ["chunk-0", deleteIds[0]], includeVector: false });
  assert(fetched["chunk-0"]);
  assert.equal(fetched[deleteIds[0]], undefined);
  const reopenedRows = reopened.querySync({
    fieldName: "sparseEmbedding",
    vector: queryVector,
    filter: 'kbId = "kb-b"',
    topk: 20,
    outputFields: ["kbId"],
  });
  assert.equal(reopenedRows.length, 20);
  reopened.closeSync();

  queryTimes.sort((left, right) => left - right);
  const report = {
    rows: options.rows,
    sparseTerms: options.terms,
    batchSize: options.batchSize,
    insertMs: Math.round(insertMs),
    queryP50Ms: percentile(queryTimes, 0.5),
    queryP95Ms: percentile(queryTimes, 0.95),
    diskMiB: round(directorySize(collectionDir) / 1024 / 1024),
    rssMiB: round(process.memoryUsage().rss / 1024 / 1024),
    hybridResults: hybrid.length,
    reopenedResults: reopenedRows.length,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("zvec sparse stability check passed");
} finally {
  fs.rmSync(collectionDir, { recursive: true, force: true });
}

function createSchema() {
  return new zvec.ZVecCollectionSchema({
    name: "knowledge_sparse_stability",
    vectors: [
      {
        name: "denseEmbedding",
        dataType: zvec.ZVecDataType.VECTOR_FP32,
        dimension: 8,
        indexParams: { indexType: zvec.ZVecIndexType.FLAT, metricType: zvec.ZVecMetricType.COSINE },
      },
      {
        name: "sparseEmbedding",
        dataType: zvec.ZVecDataType.SPARSE_VECTOR_FP32,
        indexParams: { indexType: zvec.ZVecIndexType.FLAT, metricType: zvec.ZVecMetricType.IP },
      },
    ],
    fields: [
      { name: "kbId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "documentId", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "page", dataType: zvec.ZVecDataType.INT32, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "isTable", dataType: zvec.ZVecDataType.BOOL, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "hasStar", dataType: zvec.ZVecDataType.BOOL, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "headingPath", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.INVERT } },
      { name: "text", dataType: zvec.ZVecDataType.STRING, indexParams: { indexType: zvec.ZVecIndexType.FTS } },
    ],
  });
}

function createDocument(index, terms) {
  const filterMatch = index % 2 === 1;
  return {
    id: `chunk-${index}`,
    vectors: {
      denseEmbedding: createDenseVector(index),
      sparseEmbedding: createSparseVector(index, terms),
    },
    fields: {
      kbId: filterMatch ? "kb-b" : "kb-a",
      documentId: `doc-${index % 40}`,
      page: index % 500 + 1,
      isTable: filterMatch,
      hasStar: filterMatch,
      headingPath: `chapter-${index % 25}`,
      text: `${filterMatch ? "ISO27001" : "GB/T19001"} qualification requirement ${index}`,
    },
  };
}

function createDenseVector(index) {
  const vector = Array.from({ length: 8 }, (_, offset) => ((index + 1) * (offset + 3) % 29) / 29);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function createSparseVector(index, terms) {
  const vector = {};
  for (let offset = 0; offset < terms; offset += 1) {
    vector[(index * 131 + offset * 977) % 250_000] = (offset % 17 + 1) / 17;
  }
  return vector;
}

function assertStatuses(statuses) {
  const rows = Array.isArray(statuses) ? statuses : [statuses];
  assert(rows.length > 0);
  assert(rows.every((status) => status?.ok), JSON.stringify(rows.filter((status) => !status?.ok).slice(0, 3)));
}

function readOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--")) throw new Error(`Unknown argument: ${args[index]}`);
    values.set(args[index].slice(2), args[index + 1]);
  }
  return {
    rows: positiveInteger(values.get("rows"), 10_000),
    terms: positiveInteger(values.get("terms"), 192),
    batchSize: positiveInteger(values.get("batch"), 250),
    queries: positiveInteger(values.get("queries"), 100),
  };
}

function positiveInteger(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return round(values[index] || 0);
}

function directorySize(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? directorySize(entryPath) : fs.statSync(entryPath).size);
  }, 0);
}

function round(value) {
  return Number(value.toFixed(2));
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as zvec from "@zvec/zvec";
import {
  buildKnowledgeKbFilter,
  createKnowledgeZvecFields,
  createKnowledgeZvecSchema,
  queryKnowledgeZvecCollection,
  vectorFieldName,
} from "../server/knowledge/zvec-store.js";

const dir = path.join(os.tmpdir(), `guangfa-zvec-hybrid-${Date.now()}`);
const schema = createKnowledgeZvecSchema(zvec, 3);
const collection = zvec.ZVecCreateAndOpen(dir, schema);

const chunks = [
  {
    id: "chunk-a",
    kbId: "kb-a",
    scope: "project",
    projectId: "default-project",
    documentId: "doc-a",
    documentName: "项目资料A",
    chunkIndex: 1,
    page: "",
    text: "alpha 项目名称 合同工期 九十日历天",
    createdAt: new Date().toISOString(),
  },
  {
    id: "chunk-b",
    kbId: "kb-b",
    scope: "project",
    projectId: "default-project",
    documentId: "doc-b",
    documentName: "项目资料B",
    chunkIndex: 1,
    page: "",
    text: "charlie 付款方式 进度款 质保金",
    createdAt: new Date().toISOString(),
  },
];

collection.insertSync(chunks.map((chunk, index) => ({
  id: chunk.id,
  vectors: { [vectorFieldName]: index === 0 ? [1, 0, 0] : [0, 1, 0] },
  fields: createKnowledgeZvecFields(chunk),
})));

const filter = buildKnowledgeKbFilter(new Set(["kb-b"]));
assert.equal(filter, 'kbId IN ("kb-b")');

const rows = queryKnowledgeZvecCollection(collection, zvec, {
  query: "charlie",
  embedding: [1, 0, 0],
  topK: 5,
  allowedKbIds: new Set(["kb-b"]),
  liveChunkIds: new Set(["chunk-b"]),
});

assert.equal(rows.length, 1, "hybrid query should return the selected knowledge base row");
assert.equal(rows[0].id, "chunk-b", "scalar filter should exclude vector-nearer rows from other knowledge bases");
assert.equal(rows[0].mode, "hybrid");

const staleRows = queryKnowledgeZvecCollection(collection, zvec, {
  query: "charlie",
  embedding: [0, 1, 0],
  topK: 5,
  allowedKbIds: new Set(["kb-b"]),
  liveChunkIds: new Set(),
});
assert.equal(staleRows.length, 1, "empty live chunk set means no stale-index filter is requested");

const ftsOnlyRows = queryKnowledgeZvecCollection(collection, zvec, {
  query: "charlie",
  embedding: null,
  topK: 5,
  allowedKbIds: new Set(["kb-b"]),
  liveChunkIds: new Set(["chunk-b"]),
});
assert.equal(ftsOnlyRows.length, 1, "fts-only query should still work when embedding is unavailable");
assert.equal(ftsOnlyRows[0].mode, "fts");

collection.closeSync();
fs.rmSync(dir, { recursive: true, force: true });
console.log("knowledge hybrid check passed");

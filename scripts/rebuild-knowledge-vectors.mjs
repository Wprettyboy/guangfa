import fs from "node:fs";
import path from "node:path";
import { createEmbeddings, getEmbeddingConfig } from "../server/embedding.js";
import * as zvec from "@zvec/zvec";

const root = path.resolve(import.meta.dirname, "..");
const metadataPath = path.join(root, "data", "knowledge", "library.json");
const collectionPath = path.join(root, "data", "knowledge", "zvec", "chunks");
const vectorFieldName = "embedding";

const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const chunks = metadata.chunks;
const docsById = new Map(metadata.documents.map((document) => [document.id, document]));

fs.rmSync(collectionPath, { recursive: true, force: true });
fs.mkdirSync(path.dirname(collectionPath), { recursive: true });

const schema = new zvec.ZVecCollectionSchema({
  name: "knowledge_chunks",
  vectors: {
    name: vectorFieldName,
    dataType: zvec.ZVecDataType.VECTOR_FP32,
    dimension: getEmbeddingConfig().dimension,
    indexParams: {
      indexType: zvec.ZVecIndexType.FLAT,
      metricType: zvec.ZVecMetricType.COSINE,
    },
  },
  fields: [
    { name: "kbId", dataType: zvec.ZVecDataType.STRING },
    { name: "scope", dataType: zvec.ZVecDataType.STRING },
    { name: "projectId", dataType: zvec.ZVecDataType.STRING },
    { name: "documentId", dataType: zvec.ZVecDataType.STRING },
    { name: "documentName", dataType: zvec.ZVecDataType.STRING },
    { name: "chunkIndex", dataType: zvec.ZVecDataType.INT32 },
    { name: "page", dataType: zvec.ZVecDataType.STRING, nullable: true },
    { name: "text", dataType: zvec.ZVecDataType.STRING },
    { name: "createdAt", dataType: zvec.ZVecDataType.STRING },
  ],
});

const collection = zvec.ZVecCreateAndOpen(collectionPath, schema);
const batchSize = 24;
let inserted = 0;

for (let index = 0; index < chunks.length; index += batchSize) {
  const batch = chunks.slice(index, index + batchSize);
  const embeddings = await createEmbeddings(batch.map((chunk) => chunk.text));
  const statuses = collection.insertSync(
    batch.map((chunk, batchIndex) => ({
      id: chunk.id,
      vectors: { [vectorFieldName]: embeddings[batchIndex] },
      fields: {
        kbId: chunk.kbId,
        scope: chunk.scope,
        projectId: chunk.projectId,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        chunkIndex: chunk.chunkIndex,
        page: chunk.page || "",
        text: chunk.text,
        createdAt: chunk.createdAt,
      },
    })),
  );
  const failures = statuses.filter((status) => status && status.ok === false);
  if (failures.length) {
    throw new Error(`zvec insert failed: ${JSON.stringify(failures.slice(0, 3))}`);
  }
  inserted += batch.length;
  process.stdout.write(`\rinserted ${inserted}/${chunks.length}`);
}

const first = chunks[0];
const fetched = collection.fetchSync({ ids: [first.id], includeVector: false });
if (!fetched[first.id]) {
  throw new Error("zvec fetch check failed after rebuild");
}

const probe = collection.querySync({
  fieldName: vectorFieldName,
  vector: (await createEmbeddings(["合同解除后违约责任如何承担"]))[0],
  topk: 3,
  includeVector: false,
});
if (probe.length === 0) {
  throw new Error("zvec query check failed after rebuild");
}

const now = new Date().toISOString();
metadata.documents.forEach((document) => {
  if (docsById.has(document.id)) {
    document.status = "已索引";
    document.indexMode = "vector";
    document.error = "";
    document.updatedAt = now;
  }
});
metadata.knowledgeBases.forEach((kb) => {
  if (chunks.some((chunk) => chunk.kbId === kb.id)) kb.updatedAt = now;
});
fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
collection.closeSync();
console.log(`\nrebuilt vectors=${inserted} probe=${probe.length}`);

import fs from "node:fs";
import path from "node:path";
import { createEmbeddings, getEmbeddingConfig } from "../server/embedding.js";
import { createKnowledgeZvecFields, createKnowledgeZvecSchema, knowledgeZvecCollectionPath, vectorFieldName } from "../server/knowledge/zvec-store.js";
import * as zvec from "@zvec/zvec";

const root = path.resolve(import.meta.dirname, "..");
const metadataPath = path.join(root, "data", "knowledge", "library.json");
const collectionPath = knowledgeZvecCollectionPath;

const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const chunks = metadata.chunks;
const docsById = new Map(metadata.documents.map((document) => [document.id, document]));

fs.rmSync(collectionPath, { recursive: true, force: true });
fs.mkdirSync(path.dirname(collectionPath), { recursive: true });

const schema = createKnowledgeZvecSchema(zvec, getEmbeddingConfig().dimension);

const collection = zvec.ZVecCreateAndOpen(collectionPath, schema);
const batchSize = 24;
let inserted = 0;
let probeCount = 0;

for (let index = 0; index < chunks.length; index += batchSize) {
  const batch = chunks.slice(index, index + batchSize);
  const embeddings = await createEmbeddings(batch.map((chunk) => chunk.text));
  const statuses = collection.insertSync(
    batch.map((chunk, batchIndex) => ({
      id: chunk.id,
      vectors: { [vectorFieldName]: embeddings[batchIndex] },
      fields: createKnowledgeZvecFields(chunk),
    })),
  );
  const failures = statuses.filter((status) => status && status.ok === false);
  if (failures.length) {
    throw new Error(`zvec insert failed: ${JSON.stringify(failures.slice(0, 3))}`);
  }
  inserted += batch.length;
  process.stdout.write(`\rinserted ${inserted}/${chunks.length}`);
}

if (chunks.length > 0) {
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
  probeCount = probe.length;
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
console.log(`\nrebuilt vectors=${inserted} probe=${probeCount}`);

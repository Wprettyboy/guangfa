import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { searchKnowledgeBase } from "../server/knowledge-base.js";

const metadata = JSON.parse(await readFile(new URL("../data/knowledge/library.json", import.meta.url), "utf8"));
const chunkedKb = metadata.knowledgeBases.find((kb) => metadata.chunks.some((chunk) => chunk.kbId === kb.id));

if (!chunkedKb) {
  console.log("knowledge selection check skipped: no indexed chunks");
  process.exit(0);
}

const probeChunk = metadata.chunks.find((chunk) => chunk.kbId === chunkedKb.id);
const query = probeChunk.text.slice(0, 40) || "项目名称";
const projectId = chunkedKb.projectId || "default-project";

const selectedRows = await searchKnowledgeBase({
  query,
  projectId,
  kbIds: [chunkedKb.id],
  includeGlobal: false,
  topK: 10,
});
assert(selectedRows.every((row) => row.kbId === chunkedKb.id), "selected kb search leaked other knowledge bases");

const globalKb = metadata.knowledgeBases.find((kb) => kb.scope === "global");
if (globalKb) {
  const globalOnlyRows = await searchKnowledgeBase({
    query,
    projectId,
    kbIds: [],
    globalKbIds: [globalKb.id],
    includeGlobal: false,
    topK: 10,
  });
  assert(globalOnlyRows.every((row) => row.kbId === globalKb.id), "global-only search leaked project knowledge bases");
}

console.log("knowledge selection check passed");

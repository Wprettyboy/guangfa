import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getKnowledgeDatabase } from "../server/knowledge/db.js";
import { readKnowledgeIndexChunks } from "../server/knowledge/indexer.js";
import { searchKnowledgeV4 } from "../server/knowledge/search.js";
import { resolveChunkAnchor, resolveDocumentName, resolveKnowledgeBaseAnchor } from "./lib/retrieval-case-anchors.mjs";

const options = readOptions(process.argv.slice(2));
const database = await getKnowledgeDatabase();

try {
  const chunks = readKnowledgeIndexChunks(database);
  assert(chunks.length > 0, "No retrieval chunks are available for evaluation");
  const cases = options.casesPath
    ? normalizeCases(JSON.parse(await readFile(options.casesPath, "utf8")), chunks, readKnowledgeBases(database))
    : buildDerivedCases(chunks, options.caseCount);
  const evaluation = await evaluateCases(cases, chunks);
  console.log(JSON.stringify(evaluation, null, 2));
  assert(evaluation.recallAt20 >= options.minRecallAt20, `Recall@20 ${evaluation.recallAt20} is below ${options.minRecallAt20}`);
  assert(evaluation.top5HitRate >= options.minTop5HitRate, `Top-5 hit rate ${evaluation.top5HitRate} is below ${options.minTop5HitRate}`);
  assert(evaluation.rerankerAppliedCount > 0, "Reranker was not applied to any evaluation case");

  if (options.stressRounds > 0) {
    const stress = await runAlternatingGpuStress(options.stressRounds);
    console.log(JSON.stringify(stress, null, 2));
    assert.equal(stress.retrievalOomDelta, 0, "Retrieval service reported an OOM during stress testing");
  }
  console.log("knowledge retrieval evaluation passed");
} finally {
  database.close();
}

async function evaluateCases(cases, chunks) {
  const allChunkIds = new Set(chunks.map((chunk) => chunk.id));
  const rows = [];
  const degradedReasons = new Set();
  for (const testCase of cases) {
    const allowedKbIds = testCase.kbIds.length ? testCase.kbIds : [...new Set(chunks.map((chunk) => chunk.kbId))];
    const allowedSet = new Set(allowedKbIds);
    const eligibleChunks = chunks.filter((chunk) => allowedSet.has(chunk.kbId));
    const result = await searchKnowledgeV4({
      query: testCase.query,
      allowedKbIds,
      eligibleChunks,
      liveChunkIds: allChunkIds,
      filters: testCase.filters,
      topK: 20,
    });
    result.diagnostics.degradedReasons.forEach((reason) => degradedReasons.add(reason));
    const rankedIds = result.items.map((item) => item.id);
    const expected = new Set(testCase.expectedChunkIds);
    const recalled = rankedIds.filter((id) => expected.has(id)).length / expected.size;
    rows.push({
      id: testCase.id,
      recallAt20: round(recalled),
      top5Hit: rankedIds.slice(0, 5).some((id) => expected.has(id)),
      firstRelevantRank: rankedIds.findIndex((id) => expected.has(id)) + 1 || null,
      candidateCount: result.diagnostics.candidateCount,
      reranker: result.diagnostics.reranker,
      elapsedMs: result.diagnostics.elapsedMs,
    });
  }
  return {
    mode: options.casesPath ? "curated" : "derived-exact-evidence",
    caseCount: rows.length,
    recallAt20: round(rows.reduce((sum, row) => sum + row.recallAt20, 0) / rows.length),
    top5HitRate: round(rows.filter((row) => row.top5Hit).length / rows.length),
    rerankerAppliedCount: rows.filter((row) => row.reranker === "applied").length,
    degradedReasons: [...degradedReasons],
    cases: rows,
  };
}

function readKnowledgeBases(database) {
  return database.prepare(`
    SELECT id, name, scope, project_id AS projectId
    FROM knowledge_bases
    WHERE deleted_at IS NULL
  `).all();
}

function buildDerivedCases(chunks, count) {
  const candidates = chunks.filter((chunk) => String(chunk.sourceText || chunk.text || "").replace(/\s+/g, "").length >= 36);
  const byDocument = Map.groupBy(candidates, (chunk) => chunk.documentId);
  const selected = [];
  let offset = 0;
  while (selected.length < Math.min(count, candidates.length)) {
    let added = false;
    for (const rows of byDocument.values()) {
      if (rows[offset] && selected.length < count) {
        selected.push(rows[offset]);
        added = true;
      }
    }
    if (!added) break;
    offset += 1;
  }
  return selected.map((chunk, index) => ({
    id: `derived-${index + 1}`,
    query: buildExactEvidenceQuery(chunk),
    expectedChunkIds: [chunk.id],
    kbIds: [chunk.kbId],
    filters: {},
  }));
}

function buildExactEvidenceQuery(chunk) {
  const source = String(chunk.sourceText || chunk.text || "")
    .replace(/^路径:[^\n]*\n/, "")
    .replace(/\s+/g, " ")
    .trim();
  const start = Math.max(0, Math.floor((source.length - 80) / 2));
  return source.slice(start, start + 80).trim();
}

// 用例文件只接受内容锚点。chunk id 带入库时间戳，重新入库即失效，
// 因此不再支持直接写 id，避免用例悄悄退回到易碎的写法。
function normalizeCases(value, chunks, bases) {
  const rows = Array.isArray(value) ? value : value?.cases;
  assert(Array.isArray(rows) && rows.length > 0, "Evaluation cases must be a non-empty array");
  return rows.map((item, index) => {
    const id = String(item?.id || `case-${index + 1}`);
    const query = String(item?.query || "").trim();
    const anchors = Array.isArray(item?.expectedAnchors) ? item.expectedAnchors : [];
    assert(item?.expectedChunkIds === undefined, `Evaluation case ${id} uses expectedChunkIds; chunk ids embed an ingestion timestamp, use expectedAnchors instead`);
    assert(query && anchors.length > 0, `Evaluation case ${id} requires query and expectedAnchors`);
    const expectedChunkIds = uniqueStrings(anchors.map((anchor, position) =>
      resolveChunkAnchor(anchor, chunks, `Evaluation case ${id} anchor ${position + 1}`)));
    assert(expectedChunkIds.length === anchors.length, `Evaluation case ${id} has anchors resolving to the same chunk`);
    return { id, query, expectedChunkIds, kbIds: resolveCaseKbIds(item, bases, id), filters: normalizeCaseFilters(item.filters, chunks, id) };
  });
}

// 知识库 id 带时间戳，用例改写成 kbAnchors。留空表示不限定知识库（跨库检索）。
function resolveCaseKbIds(item, bases, caseId) {
  assert(item?.kbIds === undefined, `Evaluation case ${caseId} uses kbIds; knowledge base ids embed a creation timestamp, use kbAnchors instead`);
  if (item?.kbAnchors === undefined) return [];
  assert(Array.isArray(item.kbAnchors), `Evaluation case ${caseId} requires kbAnchors to be an array`);
  const kbIds = uniqueStrings(item.kbAnchors.map((anchor, position) =>
    resolveKnowledgeBaseAnchor(anchor, bases, `Evaluation case ${caseId} kbAnchor ${position + 1}`)));
  assert(kbIds.length === item.kbAnchors.length, `Evaluation case ${caseId} has kbAnchors resolving to the same knowledge base`);
  return kbIds;
}

// documentIds 同样带时间戳，用例改写 documentNames，这里解析成当前库里的 id。
function normalizeCaseFilters(rawFilters, chunks, caseId) {
  const filters = rawFilters && typeof rawFilters === "object" ? { ...rawFilters } : {};
  assert(filters.documentIds === undefined, `Evaluation case ${caseId} uses filters.documentIds; use filters.documentNames instead`);
  if (filters.documentNames === undefined) return filters;
  const names = uniqueStrings(filters.documentNames);
  assert(names.length > 0, `Evaluation case ${caseId} has an empty filters.documentNames`);
  delete filters.documentNames;
  filters.documentIds = names.map((name) => resolveDocumentName(name, chunks, `Evaluation case ${caseId} filters.documentNames`));
  return filters;
}

async function runAlternatingGpuStress(rounds) {
  const before = await readServiceHealth();
  const vlmModel = (await requestJson("http://127.0.0.1:30000/v1/models")).data?.[0]?.id;
  assert(vlmModel, "MinerU VLM model is unavailable");
  const elapsed = [];
  for (let round = 1; round <= rounds; round += 1) {
    const startedAt = performance.now();
    await requestJson("http://127.0.0.1:30000/v1/chat/completions", {
      method: "POST",
      body: {
        model: vlmModel,
        messages: [{ role: "user", content: `只输出数字${round}` }],
        max_completion_tokens: 4,
      },
      timeoutMs: 60_000,
    });
    const encoded = await requestJson("http://127.0.0.1:8000/v1/retrieval/encode", {
      method: "POST",
      body: { input: [`第${round}轮 招标采购 ISO27001 5000万`], deadline_ms: 60_000 },
      timeoutMs: 65_000,
    });
    assert.equal(encoded.data?.[0]?.dense_embedding?.length, 1024, `Encode failed in round ${round}`);
    const reranked = await requestJson("http://127.0.0.1:8000/v1/rerank", {
      method: "POST",
      body: { query: "供应商资质", documents: ["供应商应具有有效资质证书", "项目付款按月结算"], deadline_ms: 30_000 },
      timeoutMs: 35_000,
    });
    assert.equal(reranked.data?.length, 2, `Rerank failed in round ${round}`);
    await assertServicesHealthy();
    elapsed.push(performance.now() - startedAt);
  }
  const after = await readServiceHealth();
  return {
    rounds,
    averageRoundMs: Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length),
    maxRoundMs: Math.round(Math.max(...elapsed)),
    retrievalOomDelta: Number(after.retrieval.metrics?.oom_count || 0) - Number(before.retrieval.metrics?.oom_count || 0),
    retrievalMemory: after.retrieval.memory,
    mineruApiStatus: after.mineruApi.status,
    mineruVlmStatus: after.mineruVlm.status,
  };
}

async function assertServicesHealthy() {
  const health = await readServiceHealth();
  assert.equal(health.retrieval.status, "healthy");
  assert.equal(health.mineruApi.status, "healthy");
  assert.equal(health.mineruVlm.status, "healthy");
}

async function readServiceHealth() {
  const [retrieval, mineruApi, mineruVlm] = await Promise.all([
    requestJson("http://127.0.0.1:8000/health"),
    requestJson("http://127.0.0.1:8010/health"),
    requestJson("http://127.0.0.1:30000/health"),
  ]);
  return { retrieval, mineruApi, mineruVlm };
}

async function requestJson(url, { method = "GET", body, timeoutMs = 10_000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function readOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    assert(args[index]?.startsWith("--") && args[index + 1] != null, `Invalid argument: ${args[index] || ""}`);
    values.set(args[index].slice(2), args[index + 1]);
  }
  return {
    casesPath: values.get("cases") || "",
    caseCount: positiveInteger(values.get("case-count"), 20),
    stressRounds: nonNegativeInteger(values.get("stress-rounds"), 0),
    minRecallAt20: ratio(values.get("min-recall-at-20"), 0.95),
    minTop5HitRate: ratio(values.get("min-top5-hit-rate"), 0.9),
  };
}

function positiveInteger(value, fallback) {
  const result = value == null ? fallback : Number(value);
  assert(Number.isSafeInteger(result) && result > 0, `Expected a positive integer, received ${value}`);
  return result;
}

function nonNegativeInteger(value, fallback) {
  const result = value == null ? fallback : Number(value);
  assert(Number.isSafeInteger(result) && result >= 0, `Expected a non-negative integer, received ${value}`);
  return result;
}

function ratio(value, fallback) {
  const result = value == null ? fallback : Number(value);
  assert(Number.isFinite(result) && result >= 0 && result <= 1, `Expected a ratio, received ${value}`);
  return result;
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function round(value) {
  return Number(value.toFixed(4));
}

import { performance } from "node:perf_hooks";
import { encodeRetrieval, rerankRetrieval } from "../retrieval/model-client.js";
import { rankKeywordChunks } from "./text-ranking.js";
import {
  applyKnowledgeSearchFilters,
  buildKnowledgeZvecFilter,
  describeKnowledgeFilters,
  normalizeKnowledgeSearchFilters,
} from "./search-filters.js";
import { queryActiveKnowledgeZvecChannels } from "./zvec-store.js";

const channelTopK = 60;
const candidateTopK = 20;
const rankConstant = 60;

async function searchKnowledgeV4({ query, allowedKbIds, eligibleChunks, liveChunkIds, filters: rawFilters, topK = 8 } = {}) {
  const startedAt = performance.now();
  const filters = normalizeKnowledgeSearchFilters(rawFilters);
  const diagnostics = createDiagnostics(filters);
  const zvecFilter = buildKnowledgeZvecFilter(allowedKbIds, filters);
  if (!query || !zvecFilter) return finish([], diagnostics, startedAt);

  let encoded = null;
  try {
    [encoded] = await encodeRetrieval([query]);
  } catch (error) {
    addDegradedReason(diagnostics, normalizeDegradedReason(error, "encode_timeout"));
  }

  let retrieval;
  try {
    retrieval = await queryActiveKnowledgeZvecChannels({
      query,
      denseEmbedding: encoded?.denseEmbedding,
      sparseEmbedding: encoded?.sparseEmbedding,
      filter: zvecFilter,
      topK: channelTopK,
      liveChunkIds,
    });
    if (!retrieval.manifest) {
      const error = new Error("V4 index manifest is missing");
      error.code = "index_version_mismatch";
      throw error;
    }
  } catch (error) {
    addDegradedReason(diagnostics, error?.code === "index_version_mismatch" ? "index_version_mismatch" : "zvec_unavailable");
    const keywordItems = keywordFallback(query, eligibleChunks, filters, topK);
    const fallbackDiagnostics = {
      ...diagnostics,
      indexVersion: null,
      channels: { dense: 0, sparse: 0, fts: 0, keyword: keywordItems.length },
      reranker: "skipped",
    };
    const items = keywordItems
      .map((item) => ({ ...item, degradedReasons: [...fallbackDiagnostics.degradedReasons] }));
    return finish(items, fallbackDiagnostics, startedAt);
  }

  diagnostics.indexVersion = retrieval.manifest.indexVersion;
  diagnostics.channels = {
    dense: retrieval.channels.dense.length,
    sparse: retrieval.channels.sparse.length,
    fts: retrieval.channels.fts.length,
    keyword: 0,
  };
  if (retrieval.channelErrors.sparse) addDegradedReason(diagnostics, "sparse_invalid");
  if (retrieval.channelErrors.dense || retrieval.channelErrors.fts) addDegradedReason(diagnostics, "zvec_unavailable");

  const candidates = reciprocalRankFusion(retrieval.channels, candidateTopK);
  diagnostics.candidateCount = candidates.length;
  if (!candidates.length) return finish([], diagnostics, startedAt);

  let ranked = candidates;
  try {
    const scores = await rerankRetrieval(query, candidates.map((item) => item.text));
    ranked = candidates.map((item, index) => ({ ...item, rerankScore: scores[index] }))
      .sort((left, right) => right.rerankScore - left.rerankScore || right.fusionScore - left.fusionScore || left.id.localeCompare(right.id));
    diagnostics.reranker = "applied";
  } catch (error) {
    addDegradedReason(diagnostics, normalizeDegradedReason(error, "reranker_timeout"));
    diagnostics.reranker = "degraded";
  }

  const channelNames = Object.entries(retrieval.channels).filter(([, rows]) => rows.length).map(([name]) => name);
  const mode = channelNames.join("-") || "fts";
  const items = ranked.slice(0, topK).map((item) => ({
    ...item,
    fusionScore: roundScore(item.fusionScore),
    rerankScore: Number.isFinite(item.rerankScore) ? roundScore(item.rerankScore) : null,
    score: roundScore(Number.isFinite(item.rerankScore) ? item.rerankScore : item.fusionScore),
    mode,
    degradedReasons: [...diagnostics.degradedReasons],
  }));
  return finish(items, diagnostics, startedAt);
}

function reciprocalRankFusion(channels, topK = candidateTopK) {
  const byId = new Map();
  for (const [channel, rows] of Object.entries(channels || {})) {
    rows.slice(0, channelTopK).forEach((item, index) => {
      const current = byId.get(item.id) || { ...item, fusionScore: 0, matchedChannels: [] };
      current.fusionScore += 1 / (rankConstant + index + 1);
      current.matchedChannels.push(channel);
      byId.set(item.id, current);
    });
  }
  return [...byId.values()]
    .sort((left, right) => right.fusionScore - left.fusionScore || left.id.localeCompare(right.id))
    .slice(0, topK);
}

function keywordFallback(query, eligibleChunks, filters, topK) {
  return rankKeywordChunks(applyKnowledgeSearchFilters(eligibleChunks, filters), query).slice(0, topK).map((item) => ({
    ...item,
    fusionScore: null,
    rerankScore: null,
    mode: "keyword",
    degradedReasons: [],
  }));
}

function createDiagnostics(filters) {
  return {
    indexVersion: null,
    channels: { dense: 0, sparse: 0, fts: 0, keyword: 0 },
    candidateCount: 0,
    finalCount: 0,
    reranker: "skipped",
    filtersApplied: describeKnowledgeFilters(filters),
    degradedReasons: [],
    contextTokensEstimated: 0,
    elapsedMs: 0,
  };
}

function finish(items, diagnostics, startedAt) {
  diagnostics.finalCount = items.length;
  diagnostics.elapsedMs = Math.round(performance.now() - startedAt);
  return { items, diagnostics };
}

function normalizeDegradedReason(error, fallback) {
  const allowed = new Set([
    "encode_timeout", "encode_circuit_open", "sparse_invalid", "reranker_timeout",
    "reranker_circuit_open", "retrieval_oom", "zvec_unavailable", "index_version_mismatch",
  ]);
  return allowed.has(error?.code) ? error.code : fallback;
}

function addDegradedReason(diagnostics, reason) {
  if (reason && !diagnostics.degradedReasons.includes(reason)) diagnostics.degradedReasons.push(reason);
}

function roundScore(value) {
  return Number(Number(value || 0).toFixed(6));
}

export { candidateTopK, channelTopK, rankConstant, reciprocalRankFusion, searchKnowledgeV4 };

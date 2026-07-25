import { CircuitBreaker } from "./circuit-breaker.js";

const denseDimension = 1024;
const failureThreshold = positiveNumber(process.env.RETRIEVAL_CIRCUIT_FAILURES, 3);
const resetMs = positiveNumber(process.env.RETRIEVAL_CIRCUIT_RESET_MS, 30_000);
const encodeBreaker = new CircuitBreaker({ failureThreshold, resetMs });
const rerankerBreaker = new CircuitBreaker({ failureThreshold, resetMs });

function getRetrievalModelConfig() {
  return {
    enabled: process.env.RETRIEVAL_DISABLED !== "1" && process.env.RETRIEVAL_DISABLED !== "true",
    baseUrl: String(process.env.RETRIEVAL_BASE_URL || "http://127.0.0.1:8000/v1").replace(/\/$/, ""),
    queryEncodeTimeoutMs: positiveNumber(process.env.RETRIEVAL_ENCODE_TIMEOUT_MS, 2_000),
    rerankTimeoutMs: positiveNumber(process.env.RETRIEVAL_RERANK_TIMEOUT_MS, 5_000),
    indexEncodeTimeoutMs: positiveNumber(process.env.RETRIEVAL_INDEX_TIMEOUT_MS, 60_000),
  };
}

async function encodeRetrieval(input, { indexing = false, timeoutMs, fetchImpl = fetch } = {}) {
  const texts = normalizeTexts(input, 64);
  const config = getRetrievalModelConfig();
  if (!config.enabled) throw unavailableError("encode_timeout");
  const effectiveTimeout = timeoutMs || (indexing ? config.indexEncodeTimeoutMs : config.queryEncodeTimeoutMs);
  const attempts = indexing ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await encodeBreaker.run(async () => {
        const payload = await requestJson(`${config.baseUrl}/retrieval/encode`, {
          body: { input: texts, deadline_ms: effectiveTimeout },
          timeoutMs: effectiveTimeout,
          timeoutCode: "encode_timeout",
          fetchImpl,
        });
        return validateEncodeResponse(payload, texts.length);
      }, "encode_circuit_open");
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !error?.circuitFailure) throw error;
      await delay(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function rerankRetrieval(query, documents, { timeoutMs, fetchImpl = fetch } = {}) {
  const cleanQuery = String(query || "").trim();
  const texts = normalizeTexts(documents, 20);
  if (!cleanQuery) throw new TypeError("Rerank query cannot be empty");
  const config = getRetrievalModelConfig();
  if (!config.enabled) throw unavailableError("reranker_timeout");
  const effectiveTimeout = timeoutMs || config.rerankTimeoutMs;
  return rerankerBreaker.run(async () => {
    const payload = await requestJson(`${config.baseUrl}/rerank`, {
      body: { query: cleanQuery, documents: texts, deadline_ms: effectiveTimeout },
      timeoutMs: effectiveTimeout,
      timeoutCode: "reranker_timeout",
      fetchImpl,
    });
    return validateRerankResponse(payload, texts.length);
  }, "reranker_circuit_open");
}

async function requestJson(url, { body, timeoutMs, timeoutCode, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const detail = String(payload?.detail || response.statusText || "Retrieval model request failed");
      const error = new Error(detail);
      error.code = /out of memory/i.test(detail) ? "retrieval_oom" : timeoutCode;
      error.statusCode = response.status;
      error.circuitFailure = response.status >= 500;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Retrieval model request timed out after ${timeoutMs}ms`);
      timeoutError.code = timeoutCode;
      timeoutError.circuitFailure = true;
      throw timeoutError;
    }
    if (error instanceof SyntaxError) {
      error.code = timeoutCode;
      error.circuitFailure = true;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateEncodeResponse(payload, expectedCount) {
  if (!Array.isArray(payload?.data) || payload.data.length !== expectedCount) {
    throw protocolError("Retrieval encode result count mismatch", "sparse_invalid");
  }
  return payload.data.map((row) => ({
    denseEmbedding: validateDense(row?.dense_embedding),
    sparseEmbedding: validateSparse(row?.sparse_embedding),
  }));
}

function validateDense(value) {
  if (!Array.isArray(value) || value.length !== denseDimension || value.some((item) => !Number.isFinite(item))) {
    throw protocolError("Dense embedding must contain 1024 finite numbers", "sparse_invalid");
  }
  return value;
}

function validateSparse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("Sparse embedding must be an object", "sparse_invalid");
  }
  const sparse = {};
  for (const [key, rawWeight] of Object.entries(value)) {
    const tokenId = Number(key);
    const weight = Number(rawWeight);
    if (!Number.isSafeInteger(tokenId) || tokenId < 0 || !Number.isFinite(weight) || weight <= 0) {
      throw protocolError("Sparse embedding contains an invalid token or weight", "sparse_invalid");
    }
    sparse[tokenId] = weight;
  }
  if (Object.keys(sparse).length === 0) throw protocolError("Sparse embedding cannot be empty", "sparse_invalid");
  return sparse;
}

function validateRerankResponse(payload, expectedCount) {
  if (!Array.isArray(payload?.data) || payload.data.length !== expectedCount) {
    throw protocolError("Reranker result count mismatch", "reranker_timeout");
  }
  const scores = Array(expectedCount);
  for (const row of payload.data) {
    const index = Number(row?.index);
    const score = Number(row?.score);
    if (!Number.isSafeInteger(index) || index < 0 || index >= expectedCount || !Number.isFinite(score) || scores[index] !== undefined) {
      throw protocolError("Reranker returned an invalid index or score", "reranker_timeout");
    }
    scores[index] = score;
  }
  return scores;
}

function protocolError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function unavailableError(code) {
  const error = new Error("Retrieval model service is disabled");
  error.code = code;
  return error;
}

function normalizeTexts(value, maxItems) {
  const rows = typeof value === "string" ? [value] : value;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > maxItems) throw new TypeError(`Expected 1 to ${maxItems} texts`);
  const texts = rows.map((item) => String(item || "").trim());
  if (texts.some((item) => !item)) throw new TypeError("Retrieval texts cannot be empty");
  return texts;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { denseDimension, encodeRetrieval, getRetrievalModelConfig, rerankRetrieval, validateEncodeResponse, validateRerankResponse };

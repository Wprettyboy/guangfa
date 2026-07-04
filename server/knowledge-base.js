import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmbedding, createEmbeddings, isEmbeddingConfigured } from "./embedding.js";
import { resolveKnowledgeSearchScope } from "./knowledge/scope.js";
import { rankKeywordChunks } from "./knowledge/text-ranking.js";
import { deleteKnowledgeZvecChunks, insertKnowledgeZvecChunks, searchKnowledgeZvec } from "./knowledge/zvec-store.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const metadataFile = path.join(knowledgeDir, "library.json");
const defaultProjectId = "default-project";
const chunkSize = 900;
const chunkOverlap = 120;

export function knowledgeBaseMiddleware() {
  return async function handleKnowledgeBase(request, response, next) {
    if (!request.url?.startsWith("/api/knowledge-bases")) {
      next();
      return;
    }

    try {
      const url = new URL(request.url, "http://local");
      const parts = url.pathname.split("/").filter(Boolean);

      if (request.method === "GET" && url.pathname === "/api/knowledge-bases") {
        sendJson(response, 200, await listKnowledgeBases());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/knowledge-bases") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, await createKnowledgeBase(payload || {}));
        return;
      }

      if (request.method === "DELETE" && parts.length === 3) {
        sendJson(response, 200, await deleteKnowledgeBase(parts[2]));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/knowledge-bases/search") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, await searchKnowledgeBase(payload || {}));
        return;
      }

      if (request.method === "POST" && parts.length === 4 && parts[3] === "reindex") {
        sendJson(response, 200, await reindexKnowledgeBase(parts[2]));
        return;
      }

      if (request.method === "POST" && parts.length === 4 && parts[3] === "documents") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, await addKnowledgeDocument(parts[2], payload || {}));
        return;
      }

      if (request.method === "DELETE" && parts.length === 5 && parts[3] === "documents") {
        sendJson(response, 200, await deleteKnowledgeDocument(parts[2], parts[4]));
        return;
      }

      sendJson(response, 404, { error: "知识库接口不存在" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "知识库接口异常",
      });
    }
  };
}

export async function searchKnowledgeBase(payload = {}) {
  const query = String(payload.query || "").trim();
  if (!query) return [];

  const topK = clampNumber(Number(payload.topK || 8), 1, 20);
  const metadata = await readMetadata();
  const { allowedKbIds, eligibleChunks, liveChunkIds } = resolveKnowledgeSearchScope(payload, metadata, defaultProjectId);
  if (eligibleChunks.length === 0) return [];

  const keywordResults = rankKeywordChunks(eligibleChunks, query).slice(0, topK);
  const zvecResults = await searchHybridChunks(query, topK, allowedKbIds, liveChunkIds).catch((error) => {
    console.warn("[knowledge] zvec search unavailable:", error.message || error);
    return [];
  });
  return mergeSearchResults(zvecResults, keywordResults, topK);
}

async function listKnowledgeBases() {
  const metadata = await readMetadata();
  return metadata.knowledgeBases.map((kb) => hydrateKnowledgeBase(kb, metadata));
}

async function createKnowledgeBase(payload) {
  const metadata = await readMetadata();
  const scope = payload.scope === "global" ? "global" : "project";
  const projectId = scope === "project" ? payload.projectId || defaultProjectId : "";
  const name = String(payload.name || "").trim() || (scope === "global" ? "全局知识库" : "项目知识库");
  const existing = metadata.knowledgeBases.find((kb) => kb.name === name && kb.scope === scope && (kb.projectId || "") === projectId);
  if (existing) return hydrateKnowledgeBase(existing, metadata);

  const now = new Date().toISOString();
  const kb = {
    id: `KB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    scope,
    projectId,
    createdAt: now,
    updatedAt: now,
  };
  metadata.knowledgeBases.unshift(kb);
  await writeMetadata(metadata);
  return hydrateKnowledgeBase(kb, metadata);
}

async function addKnowledgeDocument(kbId, payload) {
  const metadata = await readMetadata();
  const kb = metadata.knowledgeBases.find((item) => item.id === kbId);
  if (!kb) {
    const error = new Error("知识库不存在");
    error.statusCode = 404;
    throw error;
  }

  const text = normalizeText(payload.text);
  if (!text) {
    const error = new Error("资料内容为空，无法入库");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const documentId = `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rawChunks = chunkText(text);
  const chunkItems = rawChunks.map((chunk, index) => ({
    id: `${documentId}-C${String(index + 1).padStart(4, "0")}`,
    kbId,
    scope: kb.scope,
    projectId: kb.projectId || defaultProjectId,
    documentId,
    documentName: String(payload.name || "未命名资料").trim(),
    chunkIndex: index + 1,
    text: chunk,
    page: "",
    createdAt: now,
  }));

  const document = {
    id: documentId,
    kbId,
    name: String(payload.name || "未命名资料").trim(),
    size: payload.size || "",
    status: "索引中",
    indexMode: "keyword",
    chunkCount: chunkItems.length,
    createdAt: now,
    updatedAt: now,
    error: "",
  };

  metadata.documents.unshift(document);
  metadata.chunks.push(...chunkItems);
  kb.updatedAt = now;

  try {
    if (isEmbeddingConfigured()) {
      const embeddings = await createEmbeddings(chunkItems.map((chunk) => chunk.text));
      await insertKnowledgeZvecChunks(chunkItems, embeddings);
      document.status = "已索引";
      document.indexMode = "vector";
    } else {
      document.status = "关键词可用";
      document.error = "未配置 embedding，当前资料仅支持关键词检索。";
    }
  } catch (error) {
    document.status = "关键词可用";
    document.indexMode = "keyword";
    document.error = error.message || "向量索引失败，已保留关键词检索。";
  }

  document.updatedAt = new Date().toISOString();
  await writeMetadata(metadata);
  return {
    ...document,
    kb: hydrateKnowledgeBase(kb, metadata),
  };
}

async function deleteKnowledgeDocument(kbId, documentId) {
  const metadata = await readMetadata();
  const beforeChunks = metadata.chunks.filter((chunk) => chunk.documentId === documentId && chunk.kbId === kbId);
  metadata.documents = metadata.documents.filter((document) => !(document.id === documentId && document.kbId === kbId));
  metadata.chunks = metadata.chunks.filter((chunk) => !(chunk.documentId === documentId && chunk.kbId === kbId));
  const kb = metadata.knowledgeBases.find((item) => item.id === kbId);
  if (kb) kb.updatedAt = new Date().toISOString();

  try {
    if (beforeChunks.length > 0) {
      await deleteKnowledgeZvecChunks({ chunkIds: beforeChunks.map((chunk) => chunk.id), documentId, kbId });
    }
  } catch {
    // Metadata is the source of truth for visibility; zvec cleanup can be retried by reindexing later.
  }

  await writeMetadata(metadata);
  return { ok: true, deletedChunks: beforeChunks.length };
}

async function deleteKnowledgeBase(kbId) {
  const metadata = await readMetadata();
  const kb = metadata.knowledgeBases.find((item) => item.id === kbId);
  if (!kb) {
    const error = new Error("知识库不存在");
    error.statusCode = 404;
    throw error;
  }

  const beforeChunks = metadata.chunks.filter((chunk) => chunk.kbId === kbId);
  metadata.knowledgeBases = metadata.knowledgeBases.filter((item) => item.id !== kbId);
  metadata.documents = metadata.documents.filter((document) => document.kbId !== kbId);
  metadata.chunks = metadata.chunks.filter((chunk) => chunk.kbId !== kbId);

  try {
    if (beforeChunks.length > 0) {
      await deleteKnowledgeZvecChunks({ chunkIds: beforeChunks.map((chunk) => chunk.id), kbId });
    }
  } catch {
    // Metadata removal is authoritative; vector cleanup can be repaired by rebuilding the index later.
  }

  await writeMetadata(metadata);
  return { ok: true, deletedKnowledgeBaseId: kbId, deletedDocuments: beforeChunks.length ? new Set(beforeChunks.map((chunk) => chunk.documentId)).size : 0, deletedChunks: beforeChunks.length };
}

async function reindexKnowledgeBase(kbId) {
  const metadata = await readMetadata();
  const kb = metadata.knowledgeBases.find((item) => item.id === kbId);
  if (!kb) {
    const error = new Error("知识库不存在");
    error.statusCode = 404;
    throw error;
  }

  const documents = metadata.documents.filter((document) => document.kbId === kbId);
  const chunks = metadata.chunks.filter((chunk) => chunk.kbId === kbId);
  if (chunks.length === 0) {
    return { ok: true, updated: 0, kb: hydrateKnowledgeBase(kb, metadata) };
  }

  const now = new Date().toISOString();
  const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.text));
  await deleteKnowledgeZvecChunks({ chunkIds: chunks.map((chunk) => chunk.id), kbId });
  await insertKnowledgeZvecChunks(chunks, embeddings);

  documents.forEach((document) => {
    document.status = "已索引";
    document.indexMode = "vector";
    document.error = "";
    document.updatedAt = now;
  });
  kb.updatedAt = now;
  await writeMetadata(metadata);
  return { ok: true, updated: documents.length, chunkCount: chunks.length, kb: hydrateKnowledgeBase(kb, metadata) };
}

async function searchHybridChunks(query, topK, allowedKbIds, liveChunkIds) {
  let embedding = null;
  if (isEmbeddingConfigured()) {
    embedding = await createEmbedding(query).catch((error) => {
      console.warn("[knowledge] embedding query unavailable:", error.message || error);
      return null;
    });
  }
  return searchKnowledgeZvec({ query, embedding, topK, allowedKbIds, liveChunkIds });
}

function mergeSearchResults(primaryResults, fallbackResults, topK) {
  const merged = [];
  const seen = new Set();
  [...primaryResults, ...fallbackResults].forEach((item) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(formatSearchResult(item));
  });
  return merged.slice(0, topK);
}

function formatSearchResult(item) {
  return {
    id: item.id,
    kbId: item.kbId,
    scope: item.scope,
    projectId: item.projectId,
    documentId: item.documentId,
    documentName: item.documentName,
    chunkIndex: item.chunkIndex,
    page: item.page || "",
    text: item.text,
    score: Number((item.score || 0).toFixed(4)),
    mode: item.mode || "vector",
  };
}

async function readMetadata() {
  try {
    const raw = await readFile(metadataFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      knowledgeBases: Array.isArray(parsed.knowledgeBases) ? parsed.knowledgeBases : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const now = new Date().toISOString();
    return {
      knowledgeBases: [
        {
          id: "KB-PROJECT-DEFAULT",
          name: "当前项目知识库",
          scope: "project",
          projectId: defaultProjectId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "KB-GLOBAL-DEFAULT",
          name: "全局知识库",
          scope: "global",
          projectId: "",
          createdAt: now,
          updatedAt: now,
        },
      ],
      documents: [],
      chunks: [],
    };
  }
}

async function writeMetadata(metadata) {
  await mkdir(knowledgeDir, { recursive: true });
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2), "utf8");
}

function hydrateKnowledgeBase(kb, metadata) {
  const documents = metadata.documents.filter((document) => document.kbId === kb.id);
  const chunks = metadata.chunks.filter((chunk) => chunk.kbId === kb.id);
  return {
    ...kb,
    documentCount: documents.length,
    chunkCount: chunks.length,
    documents,
    indexStatus: summarizeIndexStatus(documents),
  };
}

function summarizeIndexStatus(documents) {
  if (documents.length === 0) return "空";
  if (documents.some((document) => document.status === "索引中")) return "索引中";
  if (documents.every((document) => document.status === "已索引")) return "已索引";
  return "部分可用";
}

function chunkText(text) {
  const cleanText = normalizeText(text);
  if (cleanText.length <= chunkSize) return [cleanText];
  const chunks = [];
  for (let index = 0; index < cleanText.length; index += chunkSize - chunkOverlap) {
    const chunk = cleanText.slice(index, index + chunkSize).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 80 * 1024 * 1024) {
        const error = new Error("知识库请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        const error = new Error("请求 JSON 格式错误");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

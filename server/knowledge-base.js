import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createEmbedding, createEmbeddings, getEmbeddingConfig, isEmbeddingConfigured } from "./embedding.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const metadataFile = path.join(knowledgeDir, "library.json");
const zvecDir = path.join(knowledgeDir, "zvec");
const collectionPath = path.join(zvecDir, "chunks");
const defaultProjectId = "default-project";
const vectorFieldName = "embedding";
const chunkSize = 900;
const chunkOverlap = 120;

let collectionPromise = null;

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

  const topK = clampNumber(Number(payload.topK || 6), 1, 20);
  const projectId = payload.projectId || defaultProjectId;
  const includeGlobal = payload.includeGlobal !== false;
  const selectedKbIds = new Set(Array.isArray(payload.kbIds) ? payload.kbIds.filter(Boolean) : []);
  const selectedGlobalKbIds = new Set(Array.isArray(payload.globalKbIds) ? payload.globalKbIds.filter(Boolean) : []);
  const metadata = await readMetadata();
  const allowedKbIds = new Set(
    metadata.knowledgeBases
      .filter((kb) => {
        if (selectedKbIds.size > 0) return selectedKbIds.has(kb.id);
        if (kb.scope === "project") return (kb.projectId || defaultProjectId) === projectId;
        return selectedGlobalKbIds.size > 0 ? selectedGlobalKbIds.has(kb.id) : includeGlobal;
      })
      .map((kb) => kb.id),
  );
  const eligibleChunks = metadata.chunks.filter((chunk) => allowedKbIds.has(chunk.kbId));
  if (eligibleChunks.length === 0) return [];

  const keywordResults = rankKeywordChunks(eligibleChunks, query).slice(0, topK);
  const vectorResults = await searchVectorChunks(query, topK, allowedKbIds).catch((error) => {
    console.warn("[knowledge] vector search unavailable:", error.message || error);
    return [];
  });
  return mergeSearchResults(vectorResults, keywordResults, topK);
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
      const collection = await getZvecCollection();
      collection.insertSync(
        chunkItems.map((chunk, index) => ({
          id: chunk.id,
          vectors: { [vectorFieldName]: embeddings[index] },
          fields: createZvecFields(chunk),
        })),
      );
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
      const collection = await getZvecCollection();
      collection.deleteSync(beforeChunks.map((chunk) => chunk.id));
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
      const collection = await getZvecCollection();
      collection.deleteSync(beforeChunks.map((chunk) => chunk.id));
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
  const collection = await getZvecCollection();
  try {
    collection.deleteSync(chunks.map((chunk) => chunk.id));
  } catch {
    // Missing vectors are fine during first vectorization of keyword-only documents.
  }
  collection.insertSync(
    chunks.map((chunk, index) => ({
      id: chunk.id,
      vectors: { [vectorFieldName]: embeddings[index] },
      fields: createZvecFields(chunk),
    })),
  );

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

async function searchVectorChunks(query, topK, allowedKbIds) {
  if (!isEmbeddingConfigured()) return [];
  const embedding = await createEmbedding(query);
  const collection = await getZvecCollection();
  const rows = collection.querySync({
    fieldName: vectorFieldName,
    vector: embedding,
    topk: Math.max(topK * 8, 30),
    includeVector: false,
  });
  return rows
    .map((row) => normalizeZvecResult(row))
    .filter((item) => item && allowedKbIds.has(item.kbId))
    .slice(0, topK);
}

function rankKeywordChunks(chunks, query) {
  const tokens = createSearchTokens(query);
  return chunks
    .map((chunk) => {
      const normalizedText = normalizeForSearch(chunk.text);
      const score = tokens.reduce((sum, token) => sum + (normalizedText.includes(token) ? Math.max(1, token.length) : 0), 0);
      return { ...chunk, score: score / 100, mode: "keyword" };
    })
    .filter((chunk) => chunk.score >= 0.04)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
}

function mergeSearchResults(vectorResults, keywordResults, topK) {
  const merged = [];
  const seen = new Set();
  [...vectorResults, ...keywordResults].forEach((item) => {
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

function normalizeZvecResult(row) {
  const fields = row?.fields || {};
  if (!fields.kbId) return null;
  return {
    id: row.id,
    score: row.score || 0,
    mode: "vector",
    kbId: fields.kbId,
    scope: fields.scope,
    projectId: fields.projectId,
    documentId: fields.documentId,
    documentName: fields.documentName,
    chunkIndex: fields.chunkIndex,
    page: fields.page,
    text: fields.text,
    createdAt: fields.createdAt,
  };
}

function createZvecFields(chunk) {
  return {
    kbId: chunk.kbId,
    scope: chunk.scope,
    projectId: chunk.projectId,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    chunkIndex: chunk.chunkIndex,
    page: chunk.page,
    text: chunk.text,
    createdAt: chunk.createdAt,
  };
}

async function getZvecCollection() {
  if (!collectionPromise) {
    collectionPromise = openZvecCollection();
  }
  return collectionPromise;
}

async function openZvecCollection() {
  await mkdir(zvecDir, { recursive: true });
  const zvec = await import("@zvec/zvec");
  if (existsSync(collectionPath)) {
    return zvec.ZVecOpen(collectionPath);
  }
  const dimension = getEmbeddingConfig().dimension;
  const schema = new zvec.ZVecCollectionSchema({
    name: "knowledge_chunks",
    vectors: {
      name: vectorFieldName,
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension,
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
  return zvec.ZVecCreateAndOpen(collectionPath, schema);
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

function createSearchTokens(query) {
  const raw = String(query || "");
  const normalized = normalizeForSearch(raw);
  const stripped = stripQueryNoise(normalized);
  const parts = raw
    .split(/[\s,，。；;、:：()（）]+/)
    .map(normalizeForSearch)
    .map(stripQueryNoise)
    .filter((item) => item.length >= 2);
  return [...new Set([normalized, stripped, ...parts, ...expandDomainSearchTokens(stripped)].filter((item) => item.length >= 2))];
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function stripQueryNoise(value) {
  return String(value || "")
    .replace(/^(请|帮我|根据|自动|获取|提取|生成|填写|填充|查询|搜索|查找)+/g, "")
    .replace(/(是什么|是啥|怎么写|如何写|怎么填|如何填|填写什么|填什么|多少天|多少|有哪些|是什么内容|的内容|内容|要求)$/g, "")
    .replace(/[?？。.!！]+$/g, "");
}

function expandDomainSearchTokens(value) {
  const tokens = [];
  const add = (...items) => tokens.push(...items.map(normalizeForSearch));

  if (/项目名称|工程名称|项目名|工程名|采购项目/.test(value)) {
    add("项目名称", "工程名称", "名称统一使用", "项目位于");
  }
  if (/项目概况|工程概况|建设规模|工程建设规模|建筑面积|建设内容/.test(value)) {
    add("项目概况", "工程概况", "工程建设规模", "总建筑面积", "新增规划床位", "建设内容", "服务内容", "技术要求", "商务要求");
  }
  if (/采购范围|实施范围|服务范围|主要施工内容|工作内容|包括但不限于/.test(value)) {
    add("采购范围", "实施范围", "服务范围", "主要施工内容", "施工图范围内", "工作内容", "包括但不限于", "分项内容");
  }
  if (/采购控制价|控制价|最高限价|预算金额|采购金额/.test(value)) {
    add("采购控制价", "控制价", "最高限价");
  }
  if (/招采方式|采购方式|招标方式|评审办法|评标办法|综合评分|综合评估|最低投标价/.test(value)) {
    add("招采方式", "采购方式", "综合评估法", "询比采购", "评审条件");
  }
  if (/业绩|类似项目|合同金额|发票/.test(value)) {
    add("业绩要求", "类似项目业绩", "合同金额", "合同发票");
  }
  if (/人员|技术负责人|安全员|项目负责人|专职安全/.test(value)) {
    add("人员要求", "技术负责人", "专职安全生产管理人员", "安全生产考核合格证", "c2", "c3");
  }
  if (/资质|资格|安全生产许可证|劳务资质/.test(value)) {
    add("资质要求", "施工劳务资质", "安全生产许可证");
  }
  if (/工期|合同工期|日历天|进场通知/.test(value)) {
    add("工期", "合同工期", "日历天", "进场通知");
  }
  if (/付款|支付|进度款|结算款|质保金|缺陷责任/.test(value)) {
    add("付款方式", "进度款", "结算款", "质保金", "缺陷责任期");
  }
  if (/甲供|材料|机具|设备/.test(value)) {
    add("甲供材料", "甲供机具", "钢筋", "混凝土", "模板", "木方");
  }

  return tokens;
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

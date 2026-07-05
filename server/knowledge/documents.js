import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmbedding, createEmbeddings, isEmbeddingConfigured } from "../embedding.js";
import { buildKnowledgeChunks, buildKnowledgeParagraphs } from "./chunker.js";
import { defaultProjectId, getKnowledgeDatabase, runTransaction } from "./db.js";
import { parseKnowledgeDocument } from "./parser.js";
import { resolveKnowledgeSearchScope } from "./scope.js";
import { rankKeywordChunks } from "./text-ranking.js";
import { deleteKnowledgeZvecChunks, insertKnowledgeZvecChunks, searchKnowledgeZvec } from "./zvec-store.js";
import { resolveChunkSource } from "./source-resolver.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const filesDir = path.join(knowledgeDir, "files");

async function listKnowledgeBases() {
  const database = await getKnowledgeDatabase();
  const bases = database.prepare(`
    SELECT id, name, scope, project_id AS projectId, description, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_bases
    WHERE deleted_at IS NULL
    ORDER BY scope DESC, created_at
  `).all();
  return bases.map((base) => hydrateKnowledgeBase(database, base));
}

async function createKnowledgeBase(payload = {}) {
  const database = await getKnowledgeDatabase();
  const scope = payload.scope === "global" ? "global" : "project";
  const projectId = scope === "project" ? payload.projectId || defaultProjectId : "";
  const name = String(payload.name || "").trim() || (scope === "global" ? "全局知识库" : "项目知识库");
  const now = Date.now();
  const existing = database.prepare(`
    SELECT id, name, scope, project_id AS projectId, description, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_bases
    WHERE deleted_at IS NULL AND name = ? AND scope = ? AND COALESCE(project_id, '') = ?
  `).get(name, scope, projectId);
  if (existing) return hydrateKnowledgeBase(database, existing);
  const base = {
    id: `KB-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    scope,
    projectId,
    description: String(payload.description || ""),
    createdAt: now,
    updatedAt: now,
  };
  database.prepare(`
    INSERT INTO knowledge_bases (id, name, scope, project_id, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(base.id, base.name, base.scope, base.projectId, base.description, base.createdAt, base.updatedAt);
  return hydrateKnowledgeBase(database, base);
}

async function addKnowledgeDocument(kbId, payload = {}) {
  const database = await getKnowledgeDatabase();
  const kb = getKnowledgeBaseRow(database, kbId);
  if (!kb) throwHttpError("知识库不存在", 404);
  const fileBuffer = decodeDocumentPayload(payload);
  if (!fileBuffer.byteLength) throwHttpError("资料内容为空，无法入库", 400);

  const now = Date.now();
  const documentId = `DOC-${now}-${randomUUID().slice(0, 8)}`;
  const fileName = sanitizeFileName(payload.fileName || payload.name || "未命名资料");
  const fileExt = path.extname(fileName).replace(/^\./, "").toLowerCase() || "txt";
  const documentDir = path.join(filesDir, documentId);
  await mkdir(documentDir, { recursive: true });
  const sourcePath = path.join(documentDir, `source.${fileExt}`);
  const pdfPath = path.join(documentDir, "source.pdf");
  const textPath = path.join(documentDir, "source.txt");
  await writeFile(sourcePath, fileBuffer);

  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  insertDocumentShell(database, {
    id: documentId,
    kbId,
    name: String(payload.name || fileName).trim() || fileName,
    fileName,
    fileExt,
    mimeType: payload.fileType || "",
    fileSize: payload.size || `${fileBuffer.byteLength} B`,
    fileHash,
    filePath: sourcePath,
    pdfPath,
    textPath,
    now,
  });

  let chunks = [];
  let status = "索引中";
  let indexMode = "keyword";
  let error = "";
  try {
    const parsed = await parseKnowledgeDocument({ documentId, sourcePath, pdfPath, textPath, fileExt, fileName });
    const paragraphs = buildKnowledgeParagraphs(parsed.pages);
    chunks = buildKnowledgeChunks({
      documentId,
      kbId,
      documentName: fileName,
      scope: kb.scope,
      projectId: kb.projectId || defaultProjectId,
      paragraphs,
      createdAt: now,
    });
    writeParsedDocument(database, { documentId, kbId, pages: parsed.pages, paragraphs, chunks, now });
    if (isEmbeddingConfigured() && chunks.length > 0) {
      const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.text));
      await insertKnowledgeZvecChunks(chunks, embeddings);
      status = "已索引";
      indexMode = "hybrid";
    } else {
      status = "关键词可用";
      error = "未配置 embedding，当前资料仅支持关键词/全文检索。";
    }
    if (parsed.warning) {
      status = status === "已索引" ? "已索引" : status;
      error = parsed.warning;
    }
  } catch (parseError) {
    status = "解析失败";
    error = parseError?.message || "资料解析失败";
  }
  updateDocumentIndexState(database, {
    documentId,
    status,
    indexMode,
    pageCount: countDocumentRows(database, "knowledge_document_pages", documentId),
    paragraphCount: countDocumentRows(database, "knowledge_document_paragraphs", documentId),
    chunkCount: chunks.length,
    error,
  });
  touchKnowledgeBase(database, kbId);
  return hydrateKnowledgeDocument(database, getKnowledgeDocumentRow(database, documentId));
}

async function deleteKnowledgeDocument(kbId, documentId) {
  const database = await getKnowledgeDatabase();
  const row = getKnowledgeDocumentRow(database, documentId);
  if (!row || row.kbId !== kbId) return { ok: true, deletedChunks: 0 };
  const chunks = database.prepare("SELECT id FROM knowledge_chunks WHERE document_id = ?").all(documentId);
  runTransaction(database, () => {
    database.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_paragraphs WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_pages WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(documentId);
    touchKnowledgeBase(database, kbId);
  });
  await deleteKnowledgeZvecChunks({ chunkIds: chunks.map((chunk) => chunk.id), documentId, kbId }).catch(() => {});
  await rm(path.join(filesDir, documentId), { recursive: true, force: true }).catch(() => {});
  return { ok: true, deletedChunks: chunks.length };
}

async function deleteKnowledgeBase(kbId) {
  const database = await getKnowledgeDatabase();
  const documents = database.prepare("SELECT id FROM knowledge_documents WHERE kb_id = ?").all(kbId);
  runTransaction(database, () => {
    database.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(kbId);
  });
  await deleteKnowledgeZvecChunks({ kbId }).catch(() => {});
  await Promise.all(documents.map((document) => rm(path.join(filesDir, document.id), { recursive: true, force: true }).catch(() => {})));
  return { ok: true, deletedKnowledgeBaseId: kbId, deletedDocuments: documents.length };
}

async function reindexKnowledgeBase(kbId) {
  const database = await getKnowledgeDatabase();
  const chunks = readChunks(database).filter((chunk) => chunk.kbId === kbId);
  if (chunks.length === 0) return { ok: true, updated: 0, chunkCount: 0 };
  await deleteKnowledgeZvecChunks({ chunkIds: chunks.map((chunk) => chunk.id), kbId }).catch(() => {});
  if (isEmbeddingConfigured()) {
    const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.text));
    await insertKnowledgeZvecChunks(chunks, embeddings);
  }
  return { ok: true, updated: new Set(chunks.map((chunk) => chunk.documentId)).size, chunkCount: chunks.length };
}

async function searchKnowledgeBase(payload = {}) {
  const query = String(payload.query || "").trim();
  if (!query) return [];
  const database = await getKnowledgeDatabase();
  const metadata = readKnowledgeMetadata(database);
  const topK = clampNumber(Number(payload.topK || 8), 1, 20);
  const { allowedKbIds, eligibleChunks, liveChunkIds } = resolveKnowledgeSearchScope(payload, metadata, defaultProjectId);
  if (eligibleChunks.length === 0) return [];
  const keywordResults = rankKeywordChunks(eligibleChunks, query).slice(0, topK);
  const zvecResults = await searchHybridChunks(query, topK, allowedKbIds, liveChunkIds).catch((error) => {
    console.warn("[knowledge] zvec search unavailable:", error.message || error);
    return [];
  });
  return mergeSearchResults(database, zvecResults, keywordResults, topK);
}

async function readKnowledgeDocumentFile(documentId) {
  const database = await getKnowledgeDatabase();
  const row = getKnowledgeDocumentRow(database, documentId);
  if (!row?.filePath || !existsSync(row.filePath)) return null;
  return {
    row,
    buffer: await readFile(row.filePath),
  };
}

function insertDocumentShell(database, document) {
  database.prepare(`
    INSERT INTO knowledge_documents (
      id, kb_id, name, file_name, file_ext, mime_type, file_size, file_hash,
      file_path, pdf_path, text_path, status, index_mode, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    document.id,
    document.kbId,
    document.name,
    document.fileName,
    document.fileExt,
    document.mimeType,
    document.fileSize,
    document.fileHash,
    document.filePath,
    document.pdfPath,
    document.textPath,
    "解析中",
    "keyword",
    document.now,
    document.now,
  );
}

function writeParsedDocument(database, { documentId, kbId, pages, paragraphs, chunks, now }) {
  runTransaction(database, () => {
    database.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_paragraphs WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_pages WHERE document_id = ?").run(documentId);
    const insertPage = database.prepare(`
      INSERT INTO knowledge_document_pages (id, document_id, page_number, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertParagraph = database.prepare(`
      INSERT INTO knowledge_document_paragraphs (id, document_id, page_number, paragraph_index, text, normalized_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChunk = database.prepare(`
      INSERT INTO knowledge_chunks (id, kb_id, document_id, chunk_index, page_number, paragraph_start, paragraph_end, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    pages.forEach((page) => {
      insertPage.run(`${documentId}-P${page.page}`, documentId, page.page, page.text, now);
    });
    paragraphs.forEach((paragraph) => {
      insertParagraph.run(
        `${documentId}-P${paragraph.page}-${paragraph.paragraphIndex}`,
        documentId,
        paragraph.page,
        paragraph.paragraphIndex,
        paragraph.text,
        paragraph.normalizedText,
        now,
      );
    });
    chunks.forEach((chunk) => {
      insertChunk.run(chunk.id, kbId, documentId, chunk.chunkIndex, chunk.page, chunk.paragraphStart, chunk.paragraphEnd, chunk.text, now);
    });
  });
}

function updateDocumentIndexState(database, state) {
  database.prepare(`
    UPDATE knowledge_documents
    SET status = ?, index_mode = ?, page_count = ?, paragraph_count = ?, chunk_count = ?, error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    state.status,
    state.indexMode,
    state.pageCount,
    state.paragraphCount,
    state.chunkCount,
    state.error,
    Date.now(),
    state.documentId,
  );
}

function readKnowledgeMetadata(database) {
  return {
    knowledgeBases: database.prepare(`
      SELECT id, name, scope, project_id AS projectId
      FROM knowledge_bases
      WHERE deleted_at IS NULL
    `).all(),
    documents: database.prepare(`
      SELECT id, kb_id AS kbId, name, status, index_mode AS indexMode
      FROM knowledge_documents
      WHERE deleted_at IS NULL
    `).all(),
    chunks: readChunks(database),
  };
}

function readChunks(database) {
  return database.prepare(`
    SELECT
      c.id,
      c.kb_id AS kbId,
      b.scope,
      b.project_id AS projectId,
      c.document_id AS documentId,
      d.file_name AS documentName,
      c.chunk_index AS chunkIndex,
      c.page_number AS page,
      c.paragraph_start AS paragraphStart,
      c.paragraph_end AS paragraphEnd,
      c.text,
      c.created_at AS createdAt
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    JOIN knowledge_bases b ON b.id = c.kb_id
    WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL
  `).all();
}

function mergeSearchResults(database, primaryResults, fallbackResults, topK) {
  const merged = [];
  const seen = new Set();
  [...primaryResults, ...fallbackResults].forEach((item) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(formatSearchResult(database, item));
  });
  return merged.slice(0, topK);
}

function formatSearchResult(database, item) {
  const resolved = resolveChunkSource(database, item);
  return {
    id: item.id,
    kbId: item.kbId,
    scope: item.scope,
    projectId: item.projectId,
    documentId: item.documentId,
    documentName: item.documentName,
    chunkIndex: item.chunkIndex,
    page: item.page || "",
    paragraphStart: item.paragraphStart || "",
    paragraphEnd: item.paragraphEnd || "",
    text: item.text,
    sourceText: resolved.sourceText,
    sourceLocation: resolved.sourceLocation,
    score: Number((item.score || 0).toFixed(4)),
    mode: item.mode || "vector",
  };
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

function hydrateKnowledgeBase(database, base) {
  const documents = database.prepare(`
    SELECT id, kb_id AS kbId, name, file_name AS fileName, file_size AS size, status,
      index_mode AS indexMode, page_count AS pageCount, paragraph_count AS paragraphCount,
      chunk_count AS chunkCount, error, legacy, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_documents
    WHERE kb_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `).all(base.id).map((row) => hydrateKnowledgeDocument(database, row));
  return {
    ...base,
    projectId: base.projectId || "",
    documentCount: documents.length,
    chunkCount: documents.reduce((sum, document) => sum + Number(document.chunkCount || 0), 0),
    documents,
    indexStatus: summarizeIndexStatus(documents),
  };
}

function hydrateKnowledgeDocument(database, row) {
  if (!row) return null;
  return {
    id: row.id,
    kbId: row.kbId,
    name: row.name,
    fileName: row.fileName || row.name,
    size: row.size || row.fileSize || "",
    status: row.status,
    indexMode: row.indexMode,
    pageCount: row.pageCount || 0,
    paragraphCount: row.paragraphCount || 0,
    chunkCount: row.chunkCount || 0,
    error: row.error || "",
    legacy: Boolean(row.legacy),
    createdAt: new Date(Number(row.createdAt || Date.now())).toISOString(),
    updatedAt: new Date(Number(row.updatedAt || Date.now())).toISOString(),
  };
}

function getKnowledgeBaseRow(database, kbId) {
  return database.prepare(`
    SELECT id, name, scope, project_id AS projectId, description, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_bases
    WHERE id = ? AND deleted_at IS NULL
  `).get(kbId);
}

function getKnowledgeDocumentRow(database, documentId) {
  return database.prepare(`
    SELECT id, kb_id AS kbId, name, file_name AS fileName, file_ext AS fileExt, mime_type AS mimeType,
      file_size AS size, file_path AS filePath, pdf_path AS pdfPath, text_path AS textPath,
      status, index_mode AS indexMode, page_count AS pageCount, paragraph_count AS paragraphCount,
      chunk_count AS chunkCount, error, legacy, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_documents
    WHERE id = ? AND deleted_at IS NULL
  `).get(documentId);
}

function countDocumentRows(database, tableName, documentId) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE document_id = ?`).get(documentId).count;
}

function touchKnowledgeBase(database, kbId) {
  database.prepare("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?").run(Date.now(), kbId);
}

function decodeDocumentPayload(payload) {
  if (payload.fileBase64) return Buffer.from(String(payload.fileBase64), "base64");
  if (payload.text) return Buffer.from(String(payload.text), "utf8");
  return Buffer.alloc(0);
}

function sanitizeFileName(value) {
  const clean = String(value || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
  return clean || "document";
}

function summarizeIndexStatus(documents) {
  if (documents.length === 0) return "空";
  if (documents.some((document) => document.status === "解析中" || document.status === "索引中")) return "索引中";
  if (documents.every((document) => document.status === "已索引")) return "已索引";
  return "部分可用";
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function throwHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export {
  addKnowledgeDocument,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  listKnowledgeBases,
  readKnowledgeDocumentFile,
  reindexKnowledgeBase,
  searchKnowledgeBase,
};

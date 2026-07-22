import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmbedding, createEmbeddings, isEmbeddingConfigured } from "../embedding.js";
import { validateKnowledgeDocument } from "../document-security.js";
import { buildKnowledgeChunks, buildKnowledgeParagraphs } from "./chunker.js";
import { defaultProjectId, getKnowledgeDatabase, runTransaction } from "./db.js";
import { parseKnowledgeDocument } from "./parser.js";
import { resolveKnowledgeSearchScope } from "./scope.js";
import { rankKeywordChunks } from "./text-ranking.js";
import { deleteKnowledgeZvecChunks, insertKnowledgeZvecChunks, searchKnowledgeZvec } from "./zvec-store.js";
import { resolveChunkSource } from "./source-resolver.js";

const knowledgeDir = path.resolve(process.cwd(), "data", "knowledge");
const filesDir = path.join(knowledgeDir, "files");
const activeKnowledgeDocumentIds = new Set();
const knowledgeDocumentSelectSql = `
  SELECT id, kb_id AS kbId, name, file_name AS fileName, file_ext AS fileExt, mime_type AS mimeType,
    file_size AS size, file_hash AS fileHash,
    file_path AS filePath, pdf_path AS pdfPath, text_path AS textPath,
    page_source AS pageSource,
    status, index_mode AS indexMode, page_count AS pageCount, paragraph_count AS paragraphCount,
    chunk_count AS chunkCount, error, legacy, created_at AS createdAt, updated_at AS updatedAt
  FROM knowledge_documents
`;

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
  return runTransaction(database, () => {
    const existing = database.prepare(`
      SELECT id, name, scope, project_id AS projectId, description, created_at AS createdAt, updated_at AS updatedAt
      FROM knowledge_bases
      WHERE deleted_at IS NULL AND name = ? AND scope = ? AND COALESCE(project_id, '') = ?
    `).get(name, scope, projectId);
    if (existing) return hydrateKnowledgeBase(database, existing);
    const base = {
      id: `KB-${now}-${randomUUID().slice(0, 12)}`,
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
  });
}

async function addKnowledgeDocument(kbId, payload = {}, options = {}) {
  const database = await getKnowledgeDatabase();
  const kb = getKnowledgeBaseRow(database, kbId);
  if (!kb) throwHttpError("知识库不存在", 404);
  const fileBuffer = decodeDocumentPayload(payload);
  if (!fileBuffer.byteLength) throwHttpError("资料内容为空，无法入库", 400);

  const now = Date.now();
  const documentId = `DOC-${now}-${randomUUID().slice(0, 8)}`;
  const fileName = sanitizeFileName(payload.fileName || payload.name || "未命名资料");
  const validatedFile = await validateKnowledgeDocument(fileBuffer, { fileName, mimeType: payload.fileType });
  const fileExt = validatedFile.extension;
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const scopedIdempotencyKey = normalizeScopedIdempotencyKey(
    options.idempotencyKey ?? payload.idempotencyKey,
    options.principal,
  );
  const documentDir = path.join(filesDir, documentId);
  const sourcePath = path.join(documentDir, `source.${fileExt}`);
  const pdfPath = path.join(documentDir, "source.pdf");
  const textPath = path.join(documentDir, "source.txt");
  try {
    await mkdir(documentDir, { recursive: true });
    await writeFile(sourcePath, fileBuffer);
  } catch (error) {
    await rm(documentDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  let reservation;
  try {
    reservation = reserveKnowledgeDocument(database, {
      id: documentId,
      kbId,
      name: String(payload.name || fileName).trim() || fileName,
      fileName,
      fileExt,
      mimeType: validatedFile.mimeType,
      fileSize: payload.size || `${fileBuffer.byteLength} B`,
      fileHash,
      filePath: sourcePath,
      pdfPath,
      textPath,
      scopedIdempotencyKey,
      now,
    });
  } catch (error) {
    await rm(documentDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  if (!reservation.created) {
    await rm(documentDir, { recursive: true, force: true }).catch(() => {});
    return { ...hydrateKnowledgeDocument(database, reservation.row), idempotentReplay: true };
  }
  activeKnowledgeDocumentIds.add(documentId);
  try {
    if (reservation.replaced) {
      await Promise.all([
        deleteKnowledgeZvecChunks({ documentId: reservation.replaced.id, kbId }).catch(() => {}),
        rm(path.join(filesDir, reservation.replaced.id), { recursive: true, force: true }).catch(() => {}),
      ]);
    }

    let chunks = [];
    let status = "解析失败";
    let indexMode = "keyword";
    let error = "";
    let parsed = null;
    try {
      parsed = await parseKnowledgeDocument({ documentId, sourcePath, pdfPath, textPath, fileExt, fileName });
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
      status = "关键词可用";
      error = parsed.warning || "未配置 embedding，当前资料仅支持关键词/全文检索。";
    } catch (parseError) {
      parsed = null;
      error = parseError?.message || "资料解析失败";
    }

    if (parsed && isEmbeddingConfigured() && chunks.length > 0) {
      try {
        const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.text));
        await insertKnowledgeZvecChunks(chunks, embeddings);
        status = "已索引";
        indexMode = "hybrid";
        error = parsed.warning || "";
      } catch (embeddingError) {
        status = "关键词可用";
        error = `向量索引不可用：${embeddingError?.message || "未知错误"}`;
      }
    }

    const completedDocument = runTransaction(database, () => {
      if (!getKnowledgeDocumentRow(database, documentId)) return false;
      updateDocumentIndexState(database, {
        documentId,
        status,
        indexMode,
        pageSource: parsed?.parser || "",
        pageCount: countDocumentRows(database, "knowledge_document_pages", documentId),
        paragraphCount: countDocumentRows(database, "knowledge_document_paragraphs", documentId),
        chunkCount: chunks.length,
        error,
      });
      touchKnowledgeBase(database, kbId);
      return hydrateKnowledgeDocument(database, getKnowledgeDocumentRow(database, documentId));
    });
    if (!completedDocument) {
      await Promise.all([
        deleteKnowledgeZvecChunks({ chunkIds: chunks.map((chunk) => chunk.id), documentId, kbId }).catch(() => {}),
        rm(documentDir, { recursive: true, force: true }).catch(() => {}),
      ]);
      throwHttpError("资料在上传处理过程中已被删除", 409);
    }
    return { ...completedDocument, idempotentReplay: false };
  } finally {
    activeKnowledgeDocumentIds.delete(documentId);
  }
}

async function deleteKnowledgeDocument(kbId, documentId) {
  const database = await getKnowledgeDatabase();
  const chunks = runTransaction(database, () => {
    const row = getKnowledgeDocumentRow(database, documentId);
    if (!row || row.kbId !== kbId) return null;
    const rows = database.prepare("SELECT id FROM knowledge_chunks WHERE document_id = ?").all(documentId);
    database.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_paragraphs WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_document_pages WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(documentId);
    touchKnowledgeBase(database, kbId);
    return rows;
  });
  if (!chunks) return { ok: true, deletedChunks: 0 };
  await deleteKnowledgeZvecChunks({ chunkIds: chunks.map((chunk) => chunk.id), documentId, kbId }).catch(() => {});
  await rm(path.join(filesDir, documentId), { recursive: true, force: true }).catch(() => {});
  return { ok: true, deletedChunks: chunks.length };
}

async function deleteKnowledgeBase(kbId) {
  const database = await getKnowledgeDatabase();
  const documents = runTransaction(database, () => {
    const rows = database.prepare("SELECT id FROM knowledge_documents WHERE kb_id = ?").all(kbId);
    database.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(kbId);
    return rows;
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
  const liveChunkIds = new Set(readChunks(database).filter((chunk) => chunk.kbId === kbId).map((chunk) => chunk.id));
  const staleChunks = chunks.filter((chunk) => !liveChunkIds.has(chunk.id));
  if (staleChunks.length > 0) {
    await deleteKnowledgeZvecChunks({ chunkIds: staleChunks.map((chunk) => chunk.id), kbId }).catch(() => {});
  }
  const liveChunks = chunks.filter((chunk) => liveChunkIds.has(chunk.id));
  return { ok: true, updated: new Set(liveChunks.map((chunk) => chunk.documentId)).size, chunkCount: liveChunks.length };
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
  try {
    return { row, buffer: await readFile(row.filePath) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readKnowledgeDocumentPdf(documentId) {
  const database = await getKnowledgeDatabase();
  const row = getKnowledgeDocumentRow(database, documentId);
  if (!row || !["pdfjs", "onlyoffice-pdf"].includes(row.pageSource) || !row.pdfPath) return null;
  try {
    return { row, buffer: await readFile(row.pdfPath) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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

function reserveKnowledgeDocument(database, document) {
  return runTransaction(database, () => {
    if (!getKnowledgeBaseRow(database, document.kbId)) throwHttpError("知识库不存在", 404);
    const byKey = document.scopedIdempotencyKey
      ? getKnowledgeDocumentByIdempotencyKey(database, document.kbId, document.scopedIdempotencyKey)
      : null;
    if (byKey) {
      if (byKey.requestFileHash !== document.fileHash || byKey.requestFileName !== document.fileName) {
        throwHttpError("Idempotency-Key 已用于另一份资料", 409);
      }
      if (!isAbandonedKnowledgeReservation(byKey)) return { created: false, row: byKey };
      replaceAbandonedKnowledgeReservation(database, document, byKey);
      return { created: true, row: getKnowledgeDocumentRow(database, document.id), replaced: byKey };
    }
    const duplicate = getKnowledgeDocumentByContent(database, document.kbId, document.fileHash, document.fileName);
    if (duplicate) {
      if (isAbandonedKnowledgeReservation(duplicate)) {
        replaceAbandonedKnowledgeReservation(database, document, duplicate);
        return { created: true, row: getKnowledgeDocumentRow(database, document.id), replaced: duplicate };
      }
      bindKnowledgeIdempotencyKey(database, document, duplicate.id);
      return { created: false, row: duplicate };
    }
    insertDocumentShell(database, document);
    bindKnowledgeIdempotencyKey(database, document, document.id);
    touchKnowledgeBase(database, document.kbId);
    return { created: true, row: getKnowledgeDocumentRow(database, document.id) };
  });
}

function isAbandonedKnowledgeReservation(document) {
  return ["解析中", "索引中"].includes(document.status) && !activeKnowledgeDocumentIds.has(document.id);
}

function replaceAbandonedKnowledgeReservation(database, document, abandoned) {
  database.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(abandoned.id);
  insertDocumentShell(database, document);
  bindKnowledgeIdempotencyKey(database, document, document.id);
  touchKnowledgeBase(database, document.kbId);
}

function getKnowledgeDocumentByIdempotencyKey(database, kbId, scopedKey) {
  return database.prepare(`
    SELECT d.*, i.file_hash AS requestFileHash, i.file_name AS requestFileName
    FROM (${knowledgeDocumentSelectSql}) d
    JOIN knowledge_upload_idempotency i ON i.document_id = d.id AND i.kb_id = d.kbId
    WHERE i.kb_id = ? AND i.scoped_key = ?
  `).get(kbId, scopedKey);
}

function bindKnowledgeIdempotencyKey(database, document, documentId) {
  if (!document.scopedIdempotencyKey) return;
  database.prepare(`
    INSERT INTO knowledge_upload_idempotency (kb_id, scoped_key, document_id, file_hash, file_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    document.kbId,
    document.scopedIdempotencyKey,
    documentId,
    document.fileHash,
    document.fileName,
    document.now,
  );
}

function getKnowledgeDocumentByContent(database, kbId, fileHash, fileName) {
  return database.prepare(`
    ${knowledgeDocumentSelectSql}
    WHERE kb_id = ? AND file_hash = ? AND file_name = ? AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1
  `).get(kbId, fileHash, fileName);
}

function writeParsedDocument(database, { documentId, kbId, pages, paragraphs, chunks, now }) {
  runTransaction(database, () => {
    const document = getKnowledgeDocumentRow(database, documentId);
    if (!document || document.kbId !== kbId) throwHttpError("资料在解析过程中已被删除", 409);
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
    SET status = ?, index_mode = ?, page_source = ?, page_count = ?, paragraph_count = ?, chunk_count = ?, error = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(
    state.status,
    state.indexMode,
    state.pageSource,
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
  const isLive = database.prepare(`
    SELECT 1
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    JOIN knowledge_bases b ON b.id = c.kb_id
    WHERE c.id = ? AND d.deleted_at IS NULL AND b.deleted_at IS NULL
  `);
  [...primaryResults, ...fallbackResults].forEach((item) => {
    if (!item || seen.has(item.id) || !isLive.get(item.id)) return;
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
    sourcePdfAvailable: resolved.sourcePdfAvailable,
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
      index_mode AS indexMode, page_source AS pageSource, page_count AS pageCount, paragraph_count AS paragraphCount,
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
    pageSource: row.pageSource || "",
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
    ${knowledgeDocumentSelectSql}
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
  if (payload.fileBase64) {
    const value = String(payload.fileBase64).replace(/\s+/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throwHttpError("资料内容不是有效 Base64", 400);
    }
    return Buffer.from(value, "base64");
  }
  if (payload.text) return Buffer.from(String(payload.text), "utf8");
  return Buffer.alloc(0);
}

function normalizeScopedIdempotencyKey(value, principal) {
  if (value == null || value === "") return null;
  const key = String(value);
  if (Buffer.byteLength(key, "utf8") > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throwHttpError("Idempotency-Key 必须是不超过 128 字节的可见 ASCII 字符", 400);
  }
  const actorId = String(principal?.id || "local-development");
  if (!actorId || Buffer.byteLength(actorId, "utf8") > 256 || /[\u0000-\u001f\u007f]/.test(actorId)) {
    throwHttpError("幂等请求的身份标识格式无效", 400);
  }
  const actorHash = createHash("sha256").update(`actor:${actorId}`, "utf8").digest("hex");
  const keyHash = createHash("sha256").update(`key:${key}`, "utf8").digest("hex");
  return `${actorHash}:${keyHash}`;
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
  readKnowledgeDocumentPdf,
  reindexKnowledgeBase,
  searchKnowledgeBase,
};

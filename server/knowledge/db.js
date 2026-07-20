import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getTemplateDatabase } from "../template-db.js";

const legacyKnowledgeFile = path.resolve(process.cwd(), "data", "knowledge", "library.json");
const defaultProjectId = "default-project";

async function getKnowledgeDatabase() {
  const database = await getTemplateDatabase();
  database.exec(knowledgeSchemaSql);
  ensureKnowledgeSchemaMigrations(database);
  await migrateLegacyKnowledge(database);
  ensureDefaultKnowledgeBases(database);
  return database;
}

async function migrateLegacyKnowledge(database) {
  const migrated = database.prepare("SELECT value FROM schema_meta WHERE key = ?").get("knowledge_json_migrated");
  if (migrated || !existsSync(legacyKnowledgeFile)) {
    setSchemaMeta(database, "knowledge_json_migrated", "1");
    return;
  }
  const raw = await readFile(legacyKnowledgeFile, "utf8").catch(() => "");
  const parsed = raw ? JSON.parse(raw) : {};
  const now = Date.now();
  runTransaction(database, () => {
    const insertBase = database.prepare(`
      INSERT INTO knowledge_bases (id, name, scope, project_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        scope = excluded.scope,
        project_id = excluded.project_id,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `);
    const insertDocument = database.prepare(`
      INSERT INTO knowledge_documents (
        id, kb_id, name, file_name, file_ext, file_size, status, index_mode,
        page_count, paragraph_count, chunk_count, error, legacy, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const insertChunk = database.prepare(`
      INSERT INTO knowledge_chunks (
        id, kb_id, document_id, chunk_index, page_number, paragraph_start,
        paragraph_end, text, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    const bases = Array.isArray(parsed.knowledgeBases) ? parsed.knowledgeBases : [];
    bases.forEach((base) => {
      insertBase.run(
        base.id,
        base.name || (base.scope === "global" ? "全局知识库" : "当前项目知识库"),
        base.scope === "global" ? "global" : "project",
        base.projectId || (base.scope === "global" ? "" : defaultProjectId),
        Date.parse(base.createdAt || "") || now,
        Date.parse(base.updatedAt || "") || now,
      );
    });

    const documentRows = Array.isArray(parsed.documents) ? parsed.documents : [];
    const chunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    const chunkCounts = chunks.reduce((map, chunk) => {
      map.set(chunk.documentId, (map.get(chunk.documentId) || 0) + 1);
      return map;
    }, new Map());
    documentRows.forEach((document) => {
      insertDocument.run(
        document.id,
        document.kbId,
        document.name || "未命名资料",
        document.name || "未命名资料",
        path.extname(document.name || "").replace(/^\./, "").toLowerCase(),
        document.size || "",
        document.status || "关键词可用",
        document.indexMode || "keyword",
        0,
        0,
        chunkCounts.get(document.id) || 0,
        document.error || "旧资料缺少原文件页码，请重新上传入库以启用原文页码。",
        1,
        Date.parse(document.createdAt || "") || now,
        Date.parse(document.updatedAt || "") || now,
      );
    });
    chunks.forEach((chunk, index) => {
      insertChunk.run(
        chunk.id || `${chunk.documentId || "legacy"}-C${String(index + 1).padStart(4, "0")}`,
        chunk.kbId,
        chunk.documentId,
        Number(chunk.chunkIndex || index + 1),
        Number(chunk.page || 0) || null,
        null,
        null,
        String(chunk.text || ""),
        Date.parse(chunk.createdAt || "") || now,
      );
    });
    setSchemaMeta(database, "knowledge_json_migrated", "1");
  });
}

function runTransaction(database, callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function setSchemaMeta(database, key, value) {
  database.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function ensureDefaultKnowledgeBases(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM knowledge_bases WHERE deleted_at IS NULL").get().count;
  if (count > 0) return;
  const now = Date.now();
  database.prepare(`
    INSERT INTO knowledge_bases (id, name, scope, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)
  `).run(
    "KB-PROJECT-DEFAULT",
    "当前项目知识库",
    "project",
    defaultProjectId,
    now,
    now,
    "KB-GLOBAL-DEFAULT",
    "全局知识库",
    "global",
    "",
    now,
    now,
  );
}

function ensureKnowledgeSchemaMigrations(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_content_identity
    ON knowledge_documents(kb_id, file_hash, file_name)
    WHERE deleted_at IS NULL
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_upload_idempotency_document
    ON knowledge_upload_idempotency(document_id)
  `);
}

const knowledgeSchemaSql = `
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  project_id TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(name, scope, project_id)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_ext TEXT,
  mime_type TEXT,
  file_size TEXT,
  file_hash TEXT,
  file_path TEXT,
  pdf_path TEXT,
  text_path TEXT,
  status TEXT NOT NULL,
  index_mode TEXT NOT NULL,
  page_count INTEGER DEFAULT 0,
  paragraph_count INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  error TEXT,
  legacy INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_upload_idempotency (
  kb_id TEXT NOT NULL,
  scoped_key TEXT NOT NULL,
  document_id TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kb_id, scoped_key),
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(document_id, page_number),
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_document_paragraphs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  paragraph_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(document_id, page_number, paragraph_index),
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  paragraph_start INTEGER,
  paragraph_end INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_scope ON knowledge_bases(scope, project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb ON knowledge_documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_document ON knowledge_document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_knowledge_paragraphs_document ON knowledge_document_paragraphs(document_id, page_number, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb ON knowledge_chunks(kb_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);
`;

export { defaultProjectId, getKnowledgeDatabase, runTransaction };

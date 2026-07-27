import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTemplateDatabase } from "../template-db.js";
import { hasExplicitStarMarker, nonContentBlockTypes } from "./chunker.js";
import { knowledgeDataDir, knowledgeDatabasePath } from "./paths.js";

const legacyKnowledgeFile = path.join(knowledgeDataDir, "library.json");
const defaultProjectId = "default-project";
let standaloneDatabasePromise = null;

async function getKnowledgeDatabase() {
  const database = knowledgeDatabasePath
    ? await getStandaloneKnowledgeDatabase()
    : await getTemplateDatabase();
  database.exec(knowledgeSchemaSql);
  ensureKnowledgeSchemaMigrations(database);
  await migrateLegacyKnowledge(database);
  ensureDefaultKnowledgeBases(database);
  return database;
}

async function getStandaloneKnowledgeDatabase() {
  if (!standaloneDatabasePromise) {
    standaloneDatabasePromise = (async () => {
      await mkdir(path.dirname(knowledgeDatabasePath), { recursive: true });
      const database = new DatabaseSync(knowledgeDatabasePath);
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA journal_mode = WAL");
      return database;
    })();
  }
  return standaloneDatabasePromise;
}

async function closeKnowledgeDatabase() {
  if (!standaloneDatabasePromise) return;
  const database = await standaloneDatabasePromise;
  database.close();
  standaloneDatabasePromise = null;
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
  const documentColumns = new Set(database.prepare("PRAGMA table_info(knowledge_documents)").all().map((column) => column.name));
  const documentMigrations = [
    ["page_source", "TEXT DEFAULT ''"],
    ["processing_stage", "TEXT DEFAULT ''"],
    ["image_count", "INTEGER DEFAULT 0"],
    ["image_caption_count", "INTEGER DEFAULT 0"],
    ["image_failed_count", "INTEGER DEFAULT 0"],
  ];
  documentMigrations.forEach(([name, definition]) => {
    if (!documentColumns.has(name)) database.exec(`ALTER TABLE knowledge_documents ADD COLUMN ${name} ${definition}`);
  });
  const chunkColumns = new Set(database.prepare("PRAGMA table_info(knowledge_chunks)").all().map((column) => column.name));
  const chunkMigrations = [
    ["source_text", "TEXT DEFAULT ''"],
    ["block_type", "TEXT DEFAULT ''"],
    ["heading_path", "TEXT DEFAULT ''"],
    ["parent_chunk_id", "TEXT DEFAULT ''"],
    ["bbox_json", "TEXT DEFAULT ''"],
    ["anchor", "TEXT DEFAULT ''"],
    ["locator_grade", "TEXT DEFAULT 'contextual'"],
    ["is_table", "INTEGER DEFAULT 0"],
    ["has_star", "INTEGER DEFAULT 0"],
    ["source_asset_id", "TEXT DEFAULT ''"],
  ];
  chunkMigrations.forEach(([name, definition]) => {
    if (!chunkColumns.has(name)) database.exec(`ALTER TABLE knowledge_chunks ADD COLUMN ${name} ${definition}`);
  });
  if (!database.prepare("SELECT value FROM schema_meta WHERE key = 'knowledge_has_star_v4'").get()) {
    const updateStar = database.prepare("UPDATE knowledge_chunks SET has_star = ? WHERE id = ?");
    database.prepare("SELECT id, source_text AS sourceText FROM knowledge_chunks").all().forEach((chunk) => {
      updateStar.run(hasExplicitStarMarker(chunk.sourceText) ? 1 : 0, chunk.id);
    });
    setSchemaMeta(database, "knowledge_has_star_v4", "1");
  }
  // 旧库里已经入库的页眉/页脚/页码子块要一次性清掉，否则它们会一直留在检索候选里。
  // 这些块从不作为父块，删除不会产生悬空的 parent_chunk_id；ZVec 侧的残留行由检索时的
  // liveChunkIds 过滤挡住，并在下一次索引重建时消失。
  if (!database.prepare("SELECT value FROM schema_meta WHERE key = 'knowledge_non_content_blocks_v1'").get()) {
    const placeholders = [...nonContentBlockTypes].map(() => "?").join(", ");
    const affected = database.prepare(`
      SELECT DISTINCT document_id AS documentId FROM knowledge_chunks WHERE block_type IN (${placeholders})
    `).all(...nonContentBlockTypes);
    database.prepare(`DELETE FROM knowledge_chunks WHERE block_type IN (${placeholders})`).run(...nonContentBlockTypes);
    const updateChunkCount = database.prepare(`
      UPDATE knowledge_documents
      SET chunk_count = (SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ?)
      WHERE id = ?
    `);
    affected.forEach((row) => updateChunkCount.run(row.documentId, row.documentId));
    setSchemaMeta(database, "knowledge_non_content_blocks_v1", "1");
  }
  const updatePageSource = database.prepare("UPDATE knowledge_documents SET page_source = ? WHERE id = ?");
  database.prepare(`
    SELECT id, file_ext AS fileExt, pdf_path AS pdfPath, error
    FROM knowledge_documents
    WHERE COALESCE(page_source, '') = ''
  `).all().forEach((document) => {
    if (document.fileExt === "pdf" && document.pdfPath && existsSync(document.pdfPath)) {
      updatePageSource.run("pdfjs", document.id);
      return;
    }
    const conversionFailed = /OnlyOffice|转\s*PDF|转换|未抽取到页文本|PDF.*(?:失败|超时)/i.test(document.error || "");
    if (document.fileExt === "docx" && document.pdfPath && existsSync(document.pdfPath) && !conversionFailed) {
      updatePageSource.run("onlyoffice-pdf", document.id);
    }
  });
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
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
  page_source TEXT DEFAULT '',
  processing_stage TEXT DEFAULT '',
  status TEXT NOT NULL,
  index_mode TEXT NOT NULL,
  page_count INTEGER DEFAULT 0,
  paragraph_count INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  image_count INTEGER DEFAULT 0,
  image_caption_count INTEGER DEFAULT 0,
  image_failed_count INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS knowledge_document_heading_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  physical_page INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(document_id, heading_path),
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_document_images (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  image_index INTEGER NOT NULL,
  artifact_path TEXT NOT NULL,
  image_hash TEXT DEFAULT '',
  page_number INTEGER,
  bbox_json TEXT DEFAULT '',
  anchor TEXT DEFAULT '',
  status TEXT NOT NULL,
  caption TEXT DEFAULT '',
  metadata_json TEXT DEFAULT '',
  model TEXT DEFAULT '',
  prompt_version TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(document_id, image_index),
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
  source_text TEXT DEFAULT '',
  block_type TEXT DEFAULT '',
  heading_path TEXT DEFAULT '',
  parent_chunk_id TEXT DEFAULT '',
  bbox_json TEXT DEFAULT '',
  anchor TEXT DEFAULT '',
  locator_grade TEXT DEFAULT 'contextual',
  is_table INTEGER DEFAULT 0,
  has_star INTEGER DEFAULT 0,
  source_asset_id TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_scope ON knowledge_bases(scope, project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb ON knowledge_documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_document ON knowledge_document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_knowledge_paragraphs_document ON knowledge_document_paragraphs(document_id, page_number, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_knowledge_heading_pages_document ON knowledge_document_heading_pages(document_id, heading_path);
CREATE INDEX IF NOT EXISTS idx_knowledge_images_document ON knowledge_document_images(document_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb ON knowledge_chunks(kb_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);
`;

export { closeKnowledgeDatabase, defaultProjectId, getKnowledgeDatabase, runTransaction };

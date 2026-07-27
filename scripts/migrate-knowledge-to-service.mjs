import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const knowledgeTables = [
  "knowledge_bases",
  "knowledge_documents",
  "knowledge_upload_idempotency",
  "knowledge_document_pages",
  "knowledge_document_paragraphs",
  "knowledge_document_heading_pages",
  "knowledge_document_images",
  "knowledge_chunks",
  "knowledge_chunk_embeddings",
];

const deleteOrder = [
  "knowledge_chunk_embeddings",
  "knowledge_document_images",
  "knowledge_document_heading_pages",
  "knowledge_document_paragraphs",
  "knowledge_document_pages",
  "knowledge_chunks",
  "knowledge_upload_idempotency",
  "knowledge_documents",
  "knowledge_bases",
];

async function migrateKnowledgeToService({
  sourceDatabasePath,
  targetDatabasePath,
  sourceKnowledgeDir,
  targetKnowledgeDir,
  verifyOnly = false,
} = {}) {
  assertRequiredPath("sourceDatabasePath", sourceDatabasePath);
  assertRequiredPath("targetDatabasePath", targetDatabasePath);
  assertRequiredPath("sourceKnowledgeDir", sourceKnowledgeDir);
  assertRequiredPath("targetKnowledgeDir", targetKnowledgeDir);

  process.env.KNOWLEDGE_DATABASE_PATH = path.resolve(targetDatabasePath);
  process.env.KNOWLEDGE_DATA_DIR = path.resolve(targetKnowledgeDir);
  const { closeKnowledgeDatabase, getKnowledgeDatabase } = await import("../server/knowledge/db.js");
  const { createKnowledgeEmbeddingCache } = await import("../server/knowledge/embedding-cache.js");
  const target = await getKnowledgeDatabase();
  createKnowledgeEmbeddingCache(target);
  const source = new DatabaseSync(path.resolve(sourceDatabasePath), { readOnly: true });
  source.exec("PRAGMA foreign_keys = ON");
  try {
    if (!verifyOnly) {
      await replaceKnowledgeFiles(sourceKnowledgeDir, targetKnowledgeDir);
      copyKnowledgeRows(source, target, { targetKnowledgeDir });
    }
    return await validateKnowledgeMigration(source, target, { targetKnowledgeDir });
  } finally {
    source.close();
    await closeKnowledgeDatabase();
  }
}

function copyKnowledgeRows(source, target, { targetKnowledgeDir }) {
  assertTablesExist(source, knowledgeTables);
  assertTablesExist(target, knowledgeTables);
  target.exec("BEGIN IMMEDIATE");
  try {
    deleteOrder.forEach((table) => target.exec(`DELETE FROM ${quoteIdentifier(table)}`));
    target.exec("DELETE FROM schema_meta WHERE key LIKE 'knowledge_%'");
    knowledgeTables.forEach((table) => copyTable(source, target, table, {
      transform: table === "knowledge_documents"
        ? (row) => rebaseDocumentPaths(row, targetKnowledgeDir)
        : undefined,
    }));
    copyKnowledgeSchemaMeta(source, target);
    const foreignKeyErrors = target.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) throw new Error(`迁移后存在外键错误：${JSON.stringify(foreignKeyErrors.slice(0, 5))}`);
    target.exec("COMMIT");
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  }
}

function copyTable(source, target, table, { transform } = {}) {
  const sourceColumns = new Set(readTableColumns(source, table));
  const columns = readTableColumns(target, table).filter((column) => sourceColumns.has(column));
  if (!columns.length) throw new Error(`表 ${table} 没有可迁移列`);
  const select = `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`;
  const insert = target.prepare(`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
  source.prepare(select).all().forEach((sourceRow) => {
    const row = transform ? transform({ ...sourceRow }) : sourceRow;
    insert.run(...columns.map((column) => row[column]));
  });
}

function copyKnowledgeSchemaMeta(source, target) {
  const insert = target.prepare("INSERT INTO schema_meta (key, value) VALUES (?, ?)");
  source.prepare("SELECT key, value FROM schema_meta WHERE key LIKE 'knowledge_%' AND key <> 'knowledge_index_v4'").all()
    .forEach((row) => insert.run(row.key, row.value));
}

function rebaseDocumentPaths(row, targetKnowledgeDir) {
  ["file_path", "pdf_path", "text_path"].forEach((column) => {
    if (!row[column]) return;
    const relative = extractKnowledgeRelativePath(row[column]);
    if (!relative) throw new Error(`无法迁移知识文件路径：${row[column]}`);
    row[column] = path.join(path.resolve(targetKnowledgeDir), ...relative.split("/"));
  });
  return row;
}

function extractKnowledgeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const match = /(?:^|\/)data\/knowledge\/(.+)$/i.exec(normalized);
  if (match) return normalizeRelativePath(match[1]);
  const containerMatch = /^\/data\/knowledge\/(.+)$/i.exec(normalized);
  return containerMatch ? normalizeRelativePath(containerMatch[1]) : "";
}

function normalizeRelativePath(value) {
  const parts = String(value || "").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

async function replaceKnowledgeFiles(sourceKnowledgeDir, targetKnowledgeDir) {
  await mkdir(targetKnowledgeDir, { recursive: true });
  for (const directory of ["files", "sources", "zvec"]) {
    await rm(path.join(targetKnowledgeDir, directory), { recursive: true, force: true });
  }
  for (const directory of ["files", "sources"]) {
    const source = path.join(sourceKnowledgeDir, directory);
    if (await pathExists(source)) await cp(source, path.join(targetKnowledgeDir, directory), { recursive: true, force: true });
  }
}

async function validateKnowledgeMigration(source, target, { targetKnowledgeDir }) {
  const counts = {};
  knowledgeTables.forEach((table) => {
    const sourceCount = Number(source.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
    const targetCount = Number(target.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
    if (sourceCount !== targetCount) throw new Error(`${table} 数量不一致：源 ${sourceCount}，目标 ${targetCount}`);
    counts[table] = targetCount;
  });

  const documents = target.prepare(`
    SELECT id, file_path AS filePath, pdf_path AS pdfPath, text_path AS textPath
    FROM knowledge_documents
  `).all();
  let referencedFiles = 0;
  for (const document of documents) {
    for (const value of [document.filePath, document.pdfPath, document.textPath]) {
      if (!value) continue;
      referencedFiles += 1;
      const resolved = path.resolve(value);
      const relative = path.relative(path.resolve(targetKnowledgeDir), resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !(await pathExists(resolved))) {
        throw new Error(`资料 ${document.id} 的迁移文件不存在：${value}`);
      }
    }
  }

  const probe = target.prepare(`
    SELECT c.kb_id AS kbId, c.text
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    JOIN knowledge_bases b ON b.id = c.kb_id AND b.deleted_at IS NULL
    WHERE LENGTH(TRIM(c.text)) >= 8
    ORDER BY c.created_at DESC LIMIT 1
  `).get();
  return {
    ok: true,
    counts,
    referencedFiles,
    reindexKbId: probe?.kbId || target.prepare("SELECT id FROM knowledge_bases WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1").get()?.id || "",
    searchQuery: String(probe?.text || "").replace(/\s+/g, " ").trim().slice(0, 80),
  };
}

function assertTablesExist(database, tables) {
  const existing = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const missing = tables.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`知识库表缺失：${missing.join(", ")}`);
}

function readTableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => column.name);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function pathExists(value) {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertRequiredPath(name, value) {
  if (!String(value || "").trim()) throw new Error(`${name} 不能为空`);
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  const result = await migrateKnowledgeToService({
    sourceDatabasePath: process.env.LEGACY_KNOWLEDGE_DATABASE_PATH || "/legacy/guangfa.sqlite",
    targetDatabasePath: process.env.KNOWLEDGE_DATABASE_PATH || "/data/knowledge.sqlite",
    sourceKnowledgeDir: process.env.LEGACY_KNOWLEDGE_DATA_DIR || "/legacy/knowledge",
    targetKnowledgeDir: process.env.KNOWLEDGE_DATA_DIR || "/data/knowledge",
    verifyOnly,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export {
  copyKnowledgeRows,
  extractKnowledgeRelativePath,
  migrateKnowledgeToService,
  rebaseDocumentPaths,
  validateKnowledgeMigration,
};

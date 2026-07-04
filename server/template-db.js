import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "guangfa.sqlite");
const legacyTemplateFile = path.join(dataDir, "templates", "library.json");
const defaultLibraryId = "LIB-default";
const defaultLibraryName = "默认模板库";

let databasePromise = null;

async function getTemplateDatabase() {
  if (!databasePromise) {
    databasePromise = initializeTemplateDatabase();
  }
  return databasePromise;
}

async function initializeTemplateDatabase() {
  await mkdir(dataDir, { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(schemaSql);
  await migrateLegacyTemplateLibrary(database);
  return database;
}

async function readTemplateLibrary() {
  const database = await getTemplateDatabase();
  return readTemplatesFromDatabase(database);
}

async function readTemplate(templateId) {
  const database = await getTemplateDatabase();
  return readTemplatesFromDatabase(database, templateId)[0] || null;
}

async function replaceTemplateLibrary(templates) {
  const database = await getTemplateDatabase();
  replaceTemplatesInDatabase(database, Array.isArray(templates) ? templates : []);
}

async function readTemplateLibraries() {
  const database = await getTemplateDatabase();
  return database.prepare(`
    SELECT id, name, description, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM template_libraries
    WHERE deleted_at IS NULL
    ORDER BY sort_order, created_at
  `).all();
}

async function readTemplateTypes(libraryId = "") {
  const database = await getTemplateDatabase();
  const sql = `
    SELECT id, library_id AS libraryId, name, description, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM template_types
    WHERE deleted_at IS NULL ${libraryId ? "AND library_id = ?" : ""}
    ORDER BY sort_order, created_at
  `;
  return libraryId ? database.prepare(sql).all(libraryId) : database.prepare(sql).all();
}

async function migrateLegacyTemplateLibrary(database) {
  const migrated = database.prepare("SELECT value FROM schema_meta WHERE key = ?").get("templates_json_migrated");
  const existingCount = database.prepare("SELECT COUNT(*) AS count FROM templates").get().count;
  if (migrated || existingCount > 0 || !existsSync(legacyTemplateFile)) {
    setSchemaMeta(database, "templates_json_migrated", "1");
    return;
  }

  const raw = await readFile(legacyTemplateFile, "utf8");
  const templates = JSON.parse(raw);
  if (Array.isArray(templates) && templates.length > 0) {
    replaceTemplatesInDatabase(database, templates);
  }
  setSchemaMeta(database, "templates_json_migrated", "1");
}

function replaceTemplatesInDatabase(database, templates) {
  runTransaction(database, () => {
    const now = Date.now();
    const insertLibrary = database.prepare(`
      INSERT INTO template_libraries (id, name, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `);
    const insertType = database.prepare(`
      INSERT INTO template_types (id, library_id, name, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        library_id = excluded.library_id,
        name = excluded.name,
        description = excluded.description,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `);
    const insertTemplate = database.prepare(`
      INSERT INTO templates (
        id, library_id, type_id, name, category, file_name, file_size, file_base64,
        saved_at, saved_at_ms, uploaded_at, supported, field_count, placeholder_count,
        confirmed_count, type_summary_json, extra_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertField = database.prepare(`
      INSERT INTO template_fields (
        template_id, id, name, type, category, fill_mode, status, page, source_text,
        bookmark_name, slot_id, marker_json, input_point_json, document_order,
        sort_order, payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVariable = database.prepare(`
      INSERT INTO template_placeholder_variables (
        template_id, id, name, token, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAnchor = database.prepare(`
      INSERT INTO template_placeholder_anchors (
        template_id, id, variable_id, variable_name, token, bookmark_name, page,
        anchor_index, document_order, source, payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    database.exec("DELETE FROM template_placeholder_anchors");
    database.exec("DELETE FROM template_placeholder_variables");
    database.exec("DELETE FROM template_fields");
    database.exec("DELETE FROM templates");

    insertLibrary.run(defaultLibraryId, defaultLibraryName, "", 0, now, now);

    templates.forEach((template, templateIndex) => {
      const normalized = normalizeTemplateForStorage(template, templateIndex, now);
      insertLibrary.run(normalized.libraryId, normalized.libraryName, "", 0, now, now);
      insertType.run(normalized.typeId, normalized.libraryId, normalized.typeName, "", templateIndex, now, now);
      insertTemplate.run(
        normalized.id,
        normalized.libraryId,
        normalized.typeId,
        normalized.name,
        normalized.category,
        normalized.fileName,
        normalized.fileSize,
        normalized.fileBase64,
        normalized.savedAt,
        normalized.savedAtMs,
        normalized.uploadedAt,
        normalized.supported ? 1 : 0,
        normalized.fields.length,
        normalized.placeholderAnchors.length,
        normalized.confirmedCount,
        JSON.stringify(normalized.typeSummary || []),
        JSON.stringify(normalized.extra),
        normalized.createdAt,
        now,
      );

      normalized.fields.forEach((field, fieldIndex) => {
        insertField.run(
          normalized.id,
          String(field.id || `F-${String(fieldIndex + 1).padStart(3, "0")}`),
          textOrNull(field.name),
          textOrNull(field.type),
          textOrNull(field.category),
          textOrNull(field.fillMode),
          textOrNull(field.status),
          numberOrNull(field.page),
          textOrNull(field.sourceText || field.text || field.marker?.text),
          textOrNull(field.bookmarkName || field.marker?.bookmarkName || field.inputPoint?.bookmarkName),
          textOrNull(field.slotId),
          jsonOrNull(field.marker),
          jsonOrNull(field.inputPoint),
          numberOrNull(field.documentOrder),
          fieldIndex,
          JSON.stringify(field),
          normalized.createdAt,
          now,
        );
      });

      normalized.placeholderVariables.forEach((variable, variableIndex) => {
        insertVariable.run(
          normalized.id,
          String(variable.id || `PV-${String(variableIndex + 1).padStart(3, "0")}`),
          String(variable.name || ""),
          String(variable.token || ""),
          variableIndex,
          Number(variable.createdAt || normalized.createdAt),
          now,
        );
      });

      normalized.placeholderAnchors.forEach((anchor, anchorIndex) => {
        insertAnchor.run(
          normalized.id,
          String(anchor.id || `PH-${String(anchorIndex + 1).padStart(3, "0")}`),
          String(anchor.variableId || ""),
          String(anchor.variableName || anchor.name || ""),
          String(anchor.token || ""),
          String(anchor.bookmarkName || ""),
          numberOrDefault(anchor.page, 1),
          numberOrDefault(anchor.index || anchor.anchorIndex, anchorIndex + 1),
          numberOrDefault(anchor.documentOrder, numberOrDefault(anchor.page, 1) * 1000000 + anchorIndex + 1),
          String(anchor.source || "placeholder-variable"),
          JSON.stringify(anchor),
          normalized.createdAt,
          now,
        );
      });
    });
  });
}

function readTemplatesFromDatabase(database, templateId = "") {
  const templateRows = database.prepare(`
    SELECT
      templates.*,
      template_libraries.name AS library_name,
      template_types.name AS type_name
    FROM templates
    LEFT JOIN template_libraries ON template_libraries.id = templates.library_id
    LEFT JOIN template_types ON template_types.id = templates.type_id
    WHERE templates.deleted_at IS NULL ${templateId ? "AND templates.id = ?" : ""}
    ORDER BY templates.saved_at_ms DESC, templates.created_at DESC
  `);
  const fieldsStatement = database.prepare("SELECT * FROM template_fields WHERE template_id = ? ORDER BY sort_order, document_order, id");
  const variablesStatement = database.prepare("SELECT * FROM template_placeholder_variables WHERE template_id = ? ORDER BY sort_order, id");
  const anchorsStatement = database.prepare("SELECT * FROM template_placeholder_anchors WHERE template_id = ? ORDER BY document_order, anchor_index, bookmark_name");
  const rows = templateId ? templateRows.all(templateId) : templateRows.all();

  return rows.map((row) => {
    const extra = parseJson(row.extra_json, {});
    const fields = fieldsStatement.all(row.id).map(rowToField);
    const placeholderVariables = variablesStatement.all(row.id).map(rowToPlaceholderVariable);
    const placeholderAnchors = anchorsStatement.all(row.id).map(rowToPlaceholderAnchor);
    const template = {
      ...extra,
      id: row.id,
      libraryId: row.library_id,
      libraryName: row.library_name || defaultLibraryName,
      typeId: row.type_id,
      typeName: row.type_name || row.category,
      name: row.name,
      category: row.category || row.type_name || "招标类",
      fileName: row.file_name,
      fileSize: row.file_size,
      savedAt: row.saved_at,
      savedAtMs: row.saved_at_ms,
      uploadedAt: row.uploaded_at,
      supported: Boolean(row.supported),
      fieldCount: row.field_count ?? fields.length,
      placeholderCount: row.placeholder_count ?? placeholderAnchors.length,
      confirmedCount: row.confirmed_count ?? fields.filter((field) => field.status === "已标注").length,
      typeSummary: parseJson(row.type_summary_json, []),
      fields,
      placeholderVariables,
      placeholderAnchors,
    };
    if (row.file_base64) template.fileBase64 = row.file_base64;
    return template;
  });
}

function rowToField(row) {
  const field = parseJson(row.payload_json, {});
  return {
    ...field,
    id: row.id,
    name: row.name ?? field.name,
    type: row.type ?? field.type,
    category: row.category ?? field.category,
    fillMode: row.fill_mode ?? field.fillMode,
    status: row.status ?? field.status,
    page: row.page ?? field.page,
    sourceText: row.source_text ?? field.sourceText,
    bookmarkName: row.bookmark_name ?? field.bookmarkName,
    slotId: row.slot_id ?? field.slotId,
    marker: parseJson(row.marker_json, field.marker),
    inputPoint: parseJson(row.input_point_json, field.inputPoint),
    documentOrder: row.document_order ?? field.documentOrder,
  };
}

function rowToPlaceholderVariable(row) {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    createdAt: row.created_at,
  };
}

function rowToPlaceholderAnchor(row) {
  const anchor = parseJson(row.payload_json, {});
  return {
    ...anchor,
    id: row.id,
    variableId: row.variable_id,
    variableName: row.variable_name,
    token: row.token,
    bookmarkName: row.bookmark_name,
    page: row.page,
    index: row.anchor_index,
    documentOrder: row.document_order,
    source: row.source,
  };
}

function normalizeTemplateForStorage(template = {}, index = 0, now = Date.now()) {
  const category = String(template.category || template.typeName || "招标类").trim() || "招标类";
  const libraryId = String(template.libraryId || defaultLibraryId);
  const libraryName = String(template.libraryName || defaultLibraryName);
  const typeName = category;
  const typeId = String(template.typeName === typeName && template.typeId ? template.typeId : stableId("TYPE", `${libraryId}:${typeName}`));
  const templateId = String(template.id || `TPL-${now}-${index + 1}`);
  const fields = Array.isArray(template.fields) ? template.fields : [];
  const placeholderVariables = Array.isArray(template.placeholderVariables) ? template.placeholderVariables : [];
  const placeholderAnchors = Array.isArray(template.placeholderAnchors) ? template.placeholderAnchors.filter((anchor) => anchor?.bookmarkName) : [];
  return {
    id: templateId,
    libraryId,
    libraryName,
    typeId,
    typeName,
    name: String(template.name || template.fileName || `模板${index + 1}`),
    category,
    fileName: String(template.fileName || template.name || `模板${index + 1}.docx`),
    fileSize: String(template.fileSize || ""),
    fileBase64: template.fileBase64 || "",
    savedAt: template.savedAt || new Date(now).toLocaleString("zh-CN", { hour12: false }),
    savedAtMs: Number(template.savedAtMs || now),
    uploadedAt: template.uploadedAt || "",
    supported: template.supported !== false,
    fields,
    placeholderVariables,
    placeholderAnchors,
    confirmedCount: Number(template.confirmedCount ?? fields.filter((field) => field.status === "已标注").length),
    typeSummary: Array.isArray(template.typeSummary) ? template.typeSummary : [],
    createdAt: Number(template.createdAt || template.savedAtMs || now),
    extra: stripTemplateStorageColumns(template),
  };
}

function stripTemplateStorageColumns(template) {
  const {
    id,
    libraryId,
    libraryName,
    typeId,
    typeName,
    name,
    category,
    fileName,
    fileSize,
    fileBase64,
    fileBuffer,
    savedAt,
    savedAtMs,
    uploadedAt,
    supported,
    fieldCount,
    placeholderCount,
    confirmedCount,
    typeSummary,
    fields,
    placeholderVariables,
    placeholderAnchors,
    ...extra
  } = template || {};
  return extra;
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

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha1").update(String(value)).digest("hex").slice(0, 12)}`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}

function textOrNull(value) {
  return value == null || value === "" ? null : String(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS template_types (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(library_id, name),
  FOREIGN KEY (library_id) REFERENCES template_libraries(id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size TEXT,
  file_base64 TEXT,
  saved_at TEXT,
  saved_at_ms INTEGER,
  uploaded_at TEXT,
  supported INTEGER DEFAULT 1,
  field_count INTEGER DEFAULT 0,
  placeholder_count INTEGER DEFAULT 0,
  confirmed_count INTEGER DEFAULT 0,
  type_summary_json TEXT,
  extra_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (library_id) REFERENCES template_libraries(id),
  FOREIGN KEY (type_id) REFERENCES template_types(id)
);

CREATE TABLE IF NOT EXISTS template_fields (
  template_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  type TEXT,
  category TEXT,
  fill_mode TEXT,
  status TEXT,
  page INTEGER,
  source_text TEXT,
  bookmark_name TEXT,
  slot_id TEXT,
  marker_json TEXT,
  input_point_json TEXT,
  document_order INTEGER,
  sort_order INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, id),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_placeholder_variables (
  template_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, id),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_placeholder_anchors (
  template_id TEXT NOT NULL,
  id TEXT NOT NULL,
  variable_id TEXT NOT NULL,
  variable_name TEXT NOT NULL,
  token TEXT NOT NULL,
  bookmark_name TEXT NOT NULL,
  page INTEGER DEFAULT 1,
  anchor_index INTEGER DEFAULT 1,
  document_order INTEGER DEFAULT 0,
  source TEXT DEFAULT 'placeholder-variable',
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, id),
  UNIQUE(template_id, bookmark_name),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_types_library ON template_types(library_id);
CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type_id);
CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id);
CREATE INDEX IF NOT EXISTS idx_placeholder_variables_template ON template_placeholder_variables(template_id);
CREATE INDEX IF NOT EXISTS idx_placeholder_anchors_template ON template_placeholder_anchors(template_id);
`;

export {
  getTemplateDatabase,
  readTemplate,
  readTemplateLibraries,
  readTemplateLibrary,
  readTemplateTypes,
  replaceTemplateLibrary,
};

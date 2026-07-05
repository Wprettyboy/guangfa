import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { getKnowledgeDatabase } from "./db.js";

async function searchKnowledgeTables(payload = {}) {
  const kbIds = normalizeIds([...(payload.kbIds || []), ...(payload.globalKbIds || [])]);
  if (kbIds.length === 0) return [];
  const database = await getKnowledgeDatabase();
  const placeholders = kbIds.map(() => "?").join(",");
  const documents = database.prepare(`
    SELECT d.id, d.kb_id AS kbId, d.name, d.file_name AS fileName, d.file_ext AS fileExt,
      d.file_path AS filePath, b.name AS knowledgeBaseName, b.scope
    FROM knowledge_documents d
    JOIN knowledge_bases b ON b.id = d.kb_id
    WHERE d.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND d.kb_id IN (${placeholders})
      AND LOWER(COALESCE(d.file_ext, '')) = 'docx'
    ORDER BY d.created_at DESC
  `).all(...kbIds);
  return filterKnowledgeTables(await extractTablesForDocuments(database, documents), payload.query).slice(0, 80);
}

async function listKnowledgeDocumentTables(documentId) {
  const database = await getKnowledgeDatabase();
  const row = database.prepare(`
    SELECT d.id, d.kb_id AS kbId, d.name, d.file_name AS fileName, d.file_ext AS fileExt,
      d.file_path AS filePath, b.name AS knowledgeBaseName, b.scope
    FROM knowledge_documents d
    JOIN knowledge_bases b ON b.id = d.kb_id
    WHERE d.id = ? AND d.deleted_at IS NULL AND b.deleted_at IS NULL
  `).get(documentId);
  if (!row) return [];
  return extractTablesForDocuments(database, [row]);
}

async function extractTablesForDocuments(database, documents) {
  const groups = await Promise.all(documents.map((document) => extractDocxTables(database, document)));
  return groups.flat();
}

async function extractDocxTables(database, document) {
  if (!document?.filePath || !existsSync(document.filePath)) return [];
  const zip = await JSZip.loadAsync(await readFile(document.filePath));
  const xml = await zip.file("word/document.xml")?.async("text");
  if (!xml) return [];
  const pages = readDocumentPages(database, document.id);
  const items = readBodyItems(xml);
  const tables = [];
  let lastParagraphText = "";
  items.forEach((item) => {
    if (item.type === "paragraph") {
      const paragraphText = extractText(item.xml);
      if (paragraphText) lastParagraphText = paragraphText;
      return;
    }
    const rows = extractTableRows(item.xml);
    if (rows.length === 0) return;
    const plainText = rows
      .map((row) => row.map((cell) => cell.text).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join("\n");
    const tableIndex = tables.length + 1;
    const columnCount = rows.reduce((max, row) => Math.max(max, row.reduce((sum, cell) => sum + cell.colSpan, 0)), 0);
    tables.push({
      id: `${document.id}-T${tableIndex}`,
      documentId: document.id,
      documentName: document.name || document.fileName || "未命名资料",
      fileName: document.fileName || document.name || "未命名资料",
      knowledgeBaseId: document.kbId,
      knowledgeBaseName: document.knowledgeBaseName || "",
      tableIndex,
      title: lastParagraphText || `表格 ${tableIndex}`,
      page: resolveTablePage(pages, rows, plainText),
      rowCount: rows.length,
      columnCount,
      rows,
      plainText,
    });
  });
  return tables;
}

function readBodyItems(xml) {
  const body = xml.match(/<w:body\b[\s\S]*<\/w:body>/)?.[0] || xml;
  return [...body.matchAll(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((match) => ({
    type: match[0].startsWith("<w:tbl") ? "table" : "paragraph",
    xml: match[0],
  }));
}

function extractTableRows(tableXml) {
  return [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .map((rowMatch) => [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
      .map((cellMatch) => ({
        text: extractText(cellMatch[0]),
        colSpan: Math.max(1, Number(cellMatch[0].match(/<w:gridSpan\b[^>]*w:val="(\d+)"/)?.[1] || 1) || 1),
        vMerge: cellMatch[0].match(/<w:vMerge\b[^>]*(?:w:val="([^"]+)")?/)?.[1] || "",
      }))
      .filter((cell) => cell.text || cell.colSpan > 1 || cell.vMerge))
    .filter((row) => row.length > 0);
}

function extractText(xml) {
  const pieces = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:cr\s*\/>/g;
  let match = null;
  while ((match = tokenPattern.exec(xml))) {
    if (match[1] != null) pieces.push(decodeXmlText(match[1]));
    else if (/w:tab/.test(match[0])) pieces.push(" ");
    else pieces.push("\n");
  }
  return normalizeText(pieces.join(""));
}

function readDocumentPages(database, documentId) {
  return database.prepare(`
    SELECT page_number AS page, text
    FROM knowledge_document_pages
    WHERE document_id = ?
    ORDER BY page_number
  `).all(documentId);
}

function resolveTablePage(pages, rows, tableText) {
  const compactTable = compactText(tableText);
  if (!compactTable) return 0;
  const snippets = rows
    .flatMap((row) => row.map((cell) => compactText(cell.text)))
    .filter((text) => text.length >= 4)
    .map((text) => text.slice(0, Math.min(32, text.length)))
    .slice(0, 24);
  if (snippets.length === 0) {
    const needle = compactTable.slice(0, Math.min(80, compactTable.length));
    const page = pages.find((item) => compactText(item.text).includes(needle));
    return page ? Number(page.page) || 0 : 0;
  }
  const scored = pages
    .map((page) => {
      const pageText = compactText(page.text);
      const score = snippets.reduce((sum, snippet) => sum + (pageText.includes(snippet) ? 1 : 0), 0);
      return { page: Number(page.page) || 0, score };
    })
    .sort((left, right) => right.score - left.score)[0];
  return scored?.score > 0 ? scored.page : 0;
}

function filterKnowledgeTables(tables, query) {
  const keyword = compactText(query);
  if (!keyword) return tables;
  return tables.filter((table) => compactText(`${table.title}\n${table.documentName}\n${table.plainText}`).includes(keyword));
}

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export { listKnowledgeDocumentTables, searchKnowledgeTables };

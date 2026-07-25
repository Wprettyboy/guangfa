import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { getKnowledgeDatabase } from "./db.js";

async function readKnowledgeTableEvidence(chunkId) {
  const database = await getKnowledgeDatabase();
  const chunk = database.prepare(`
    SELECT c.id, c.document_id AS documentId, c.source_text AS sourceText,
      c.block_type AS blockType, c.parent_chunk_id AS parentChunkId,
      parent.source_text AS parentSourceText, parent.block_type AS parentBlockType,
      d.file_path AS filePath
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    LEFT JOIN knowledge_chunks parent ON parent.id = c.parent_chunk_id AND parent.document_id = c.document_id
    WHERE c.id = ? AND d.deleted_at IS NULL
  `).get(chunkId);
  if (!chunk) return null;

  const sourceText = chunk.parentBlockType === "table-parent"
    ? chunk.parentSourceText
    : chunk.blockType === "table-parent"
      ? chunk.sourceText
      : "";
  if (!sourceText) return null;
  const blocks = await readMinerUContentList(chunk.filePath);
  const tableHtml = findMinerUTableHtml(blocks, sourceText);
  if (!tableHtml) return null;

  const table = parseMinerUTableHtml(tableHtml);
  return table ? { chunkId, documentId: chunk.documentId, ...table } : null;
}

async function readMinerUContentList(filePath) {
  if (!filePath) return [];
  const artifactsDir = path.join(path.dirname(filePath), "mineru");
  let entries;
  try {
    entries = await readdir(artifactsDir);
  } catch {
    return [];
  }
  const name = entries.find((entry) => entry.endsWith("_content_list.json"));
  if (!name) return [];
  try {
    const content = JSON.parse(await readFile(path.join(artifactsDir, name), "utf8"));
    return Array.isArray(content) ? content : [];
  } catch {
    return [];
  }
}

function findMinerUTableHtml(blocks, sourceText) {
  const expected = canonicalMinerUTableText(sourceText);
  if (!expected) return "";
  const item = (Array.isArray(blocks) ? blocks : []).find((block) => {
    if (block?.type !== "table") return false;
    const html = String(block.table_body || block.html || "");
    return html && canonicalMinerUTableText(stripMinerUTableHtml(html)) === expected;
  });
  return item ? String(item.table_body || item.html || "") : "";
}

function parseMinerUTableHtml(html) {
  const rows = [...String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => parseTableRow(row[1]))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return null;

  const header = isHeaderRow(rows[0]) ? rows.shift() : [];
  const columnCount = Math.max(0, ...[header, ...rows].map((row) => row.reduce((sum, cell) => sum + cell.colSpan, 0)));
  return { header, rows, columnCount };
}

function parseTableRow(html) {
  return [...String(html || "").matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({
      text: stripMinerUTableCellHtml(match[3]),
      colSpan: readSpan(match[2], "colspan"),
      rowSpan: readSpan(match[2], "rowspan"),
      header: match[1].toLowerCase() === "th" || /<strong\b/i.test(match[3]),
    }));
}

function isHeaderRow(row) {
  return row.length > 0 && row.every((cell) => cell.header);
}

function readSpan(attributes, name) {
  const value = Number(String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i"))?.[1]);
  return Number.isSafeInteger(value) && value > 1 ? value : 1;
}

function stripMinerUTableHtml(value) {
  return String(value || "")
    .replace(/<\/(?:td|th)>\s*<(?:td|th)[^>]*>/gi, " | ")
    .replace(/<\/(?:tr|p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function canonicalMinerUTableText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function stripMinerUTableCellHtml(value) {
  return String(value || "")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export {
  findMinerUTableHtml,
  parseMinerUTableHtml,
  readKnowledgeTableEvidence,
  stripMinerUTableHtml,
};

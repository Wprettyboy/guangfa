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
      html: buildTableHtml(item.xml),
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

function buildTableHtml(tableXml) {
  const tableStyle = buildTableStyle(tableXml);
  const tableBorder = getTableBorderStyle(tableXml);
  const rows = [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((rowMatch) =>
    [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) => ({
      xml: cellMatch[0],
      text: extractCellHtml(cellMatch[0]),
      colSpan: Math.max(1, Number(cellMatch[0].match(/<w:gridSpan\b[^>]*w:val="(\d+)"/)?.[1] || 1) || 1),
      vMerge: cellMatch[0].match(/<w:vMerge\b[^>]*(?:w:val="([^"]+)")?/)?.[1] ?? null,
      style: buildCellStyle(cellMatch[0], tableBorder),
    })),
  );
  const activeMerges = new Map();
  const htmlRows = rows.map((row) => {
    let column = 0;
    const cells = [];
    row.forEach((cell) => {
      while (activeMerges.has(column) && activeMerges.get(column).covered) column += 1;
      const mergeKey = column;
      const isContinueMerge = cell.vMerge === "";
      if (isContinueMerge && activeMerges.has(mergeKey)) {
        activeMerges.get(mergeKey).rowSpan += 1;
        column += cell.colSpan;
        return;
      }
      if (!cell.vMerge) {
        for (let offset = 0; offset < cell.colSpan; offset += 1) activeMerges.delete(column + offset);
      }
      const outputCell = { ...cell, rowSpan: 1 };
      cells.push(outputCell);
      if (cell.vMerge === "restart") {
        activeMerges.set(mergeKey, outputCell);
        for (let offset = 1; offset < cell.colSpan; offset += 1) activeMerges.set(mergeKey + offset, { covered: true });
      }
      column += cell.colSpan;
    });
    return cells;
  });
  const body = htmlRows
    .map((row) => `<tr>${row.map((cell) => {
      const colSpan = cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : "";
      const rowSpan = cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : "";
      return `<td${colSpan}${rowSpan} style="${cell.style}">${cell.text || "&nbsp;"}</td>`;
    }).join("")}</tr>`)
    .join("");
  return `<table style="${tableStyle}"><tbody>${body}</tbody></table>`;
}

function buildTableStyle(tableXml) {
  const width = tableXml.match(/<w:tblW\b[^>]*w:w="([^"]+)"[^>]*w:type="([^"]+)"/);
  const styles = ["border-collapse:collapse", "table-layout:auto"];
  if (width?.[2] === "pct") styles.push(`width:${Math.max(1, Number(width[1]) / 50)}%`);
  else styles.push("width:100%");
  return styles.join(";");
}

function getTableBorderStyle(tableXml) {
  const borders = tableXml.match(/<w:tblBorders\b[\s\S]*?<\/w:tblBorders>/)?.[0] || "";
  const border = borders.match(/<w:(?:insideH|top|left|bottom|right)\b[^>]*w:val="([^"]+)"[^>]*?(?:w:sz="([^"]+)")?[^>]*?(?:w:color="([^"]+)")?[^>]*\/>/);
  return buildBorderStyle(border?.[1], border?.[2], border?.[3]) || "1px solid #000000";
}

function buildCellStyle(cellXml, fallbackBorder) {
  const styles = [
    `border:${fallbackBorder}`,
    "padding:4px 6px",
    "vertical-align:top",
    "word-break:break-word",
  ];
  const width = cellXml.match(/<w:tcW\b[^>]*w:w="([^"]+)"[^>]*w:type="([^"]+)"/);
  if (width?.[2] === "dxa") styles.push(`width:${Math.max(12, Math.round(Number(width[1]) / 15))}px`);
  const fill = normalizeColor(cellXml.match(/<w:shd\b[^>]*w:fill="([^"]+)"/)?.[1]);
  if (fill) styles.push(`background-color:#${fill}`);
  const vertical = cellXml.match(/<w:vAlign\b[^>]*w:val="([^"]+)"/)?.[1];
  if (vertical === "center") styles.push("vertical-align:middle");
  if (vertical === "bottom") styles.push("vertical-align:bottom");
  return styles.join(";");
}

function buildBorderStyle(value, size, color) {
  const borderValue = String(value || "").toLowerCase();
  if (!borderValue || borderValue === "none" || borderValue === "nil") return "";
  const px = Math.max(1, Math.round((Number(size || 8) || 8) / 8));
  return `${px}px solid #${normalizeColor(color) || "000000"}`;
}

function extractCellHtml(cellXml) {
  const paragraphs = [...cellXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => extractText(match[0]))
    .filter(Boolean)
    .map(escapeHtml);
  return paragraphs.length > 0 ? paragraphs.join("<br>") : escapeHtml(extractText(cellXml));
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeColor(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "auto") return "";
  const color = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!color) return "";
  return color.length === 6 ? color : "";
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

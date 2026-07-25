import { existsSync } from "node:fs";

function resolveChunkSource(database, chunk) {
  if (!chunk?.documentId) return formatResolvedSource(chunk);
  const storedChunk = database.prepare(`
    SELECT source_text AS sourceText, block_type AS blockType, heading_path AS headingPath,
      parent_chunk_id AS parentChunkId, bbox_json AS bboxJson, anchor, locator_grade AS locatorGrade,
      source_asset_id AS sourceAssetId
    FROM knowledge_chunks
    WHERE id = ? AND document_id = ?
  `).get(chunk.id, chunk.documentId) || {};
  chunk = { ...storedChunk, ...chunk };
  const document = database.prepare(`
    SELECT page_source AS pageSource, file_ext AS fileExt, file_path AS filePath
    FROM knowledge_documents
    WHERE id = ? AND deleted_at IS NULL
  `).get(chunk.documentId);
  const headingPage = chunk.headingPath
    ? database.prepare(`
        SELECT physical_page AS physicalPage
        FROM knowledge_document_heading_pages
        WHERE document_id = ? AND heading_path = ?
      `).get(chunk.documentId, chunk.headingPath)
    : null;
  const page = Number(chunk.page || chunk.pageNumber || 0) || null;
  const paragraphStart = Number(chunk.paragraphStart || 0) || null;
  const paragraphEnd = Number(chunk.paragraphEnd || paragraphStart || 0) || null;
  let sourceText = "";
  if (page && paragraphStart && paragraphEnd) {
    const rows = database.prepare(`
      SELECT text
      FROM knowledge_document_paragraphs
      WHERE document_id = ?
        AND page_number = ?
        AND paragraph_index BETWEEN ? AND ?
      ORDER BY paragraph_index
    `).all(chunk.documentId, page, paragraphStart, paragraphEnd);
    sourceText = rows.map((row) => row.text).filter(Boolean).join("\n");
  }
  if (!sourceText && page) {
    const row = database.prepare(`
      SELECT text
      FROM knowledge_document_pages
      WHERE document_id = ? AND page_number = ?
    `).get(chunk.documentId, page);
    sourceText = row?.text || "";
  }
  return formatResolvedSource({
    ...chunk,
    physicalPage: Number(headingPage?.physicalPage || 0) || null,
    sourceText: chunk.sourceText || sourceText || chunk.text || "",
    sourceFileAvailable: Boolean(document?.filePath && existsSync(document.filePath)),
    sourceFileType: document?.fileExt || "",
    sourcePdfAvailable: ["pdfjs", "onlyoffice-pdf"].includes(document?.pageSource)
      || (document?.fileExt === "pdf" && String(document?.pageSource || "").startsWith("mineru-")),
  });
}

function resolveChunkContext(database, chunk, maxLength = 6000) {
  const sourceText = String(chunk?.sourceText || chunk?.text || "").trim();
  if (!chunk?.parentChunkId) return String(chunk?.text || sourceText).trim();
  const parent = database.prepare(`
    SELECT source_text AS sourceText, block_type AS blockType
    FROM knowledge_chunks
    WHERE id = ? AND document_id = ?
  `).get(chunk.parentChunkId, chunk.documentId);
  if (!parent) return String(chunk?.text || sourceText).trim();
  const prefix = chunk.headingPath ? `路径: ${chunk.headingPath}\n` : "";
  const availableLength = Math.max(320, maxLength - prefix.length);
  if (parent.blockType === "table-parent" && String(parent.sourceText || "").length <= availableLength) {
    return `${prefix}${parent.sourceText}`.trim();
  }
  const siblings = database.prepare(`
    SELECT id, chunk_index AS chunkIndex, source_text AS sourceText
    FROM knowledge_chunks
    WHERE document_id = ? AND parent_chunk_id = ? AND block_type NOT LIKE '%-parent'
    ORDER BY chunk_index
  `).all(chunk.documentId, chunk.parentChunkId);
  const context = parent.blockType === "table-parent"
    ? buildTableContext(parent.sourceText, siblings, chunk.id, availableLength)
    : buildContextWindow(siblings, chunk.id, availableLength);
  return `${prefix}${context || sourceText}`.trim();
}

function buildContextWindow(rows, targetId, maxLength) {
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (targetIndex < 0) return "";
  const selected = [rows[targetIndex]];
  let length = String(rows[targetIndex].sourceText || "").length;
  let left = targetIndex - 1;
  let right = targetIndex + 1;
  while (left >= 0 || right < rows.length) {
    let added = false;
    for (const index of [left, right]) {
      if (index < 0 || index >= rows.length) continue;
      const rowLength = String(rows[index].sourceText || "").length + 1;
      if (length + rowLength > maxLength) continue;
      selected.push(rows[index]);
      length += rowLength;
      added = true;
    }
    left -= 1;
    right += 1;
    if (!added) break;
  }
  return selected
    .sort((leftRow, rightRow) => leftRow.chunkIndex - rightRow.chunkIndex)
    .map((row) => row.sourceText)
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength)
    .trim();
}

function buildTableContext(parentText, rows, targetId, maxLength) {
  const header = String(parentText || "").split("\n").find(Boolean) || "";
  const normalizedRows = rows.map((row) => ({
    ...row,
    sourceText: removeRepeatedTableHeader(row.sourceText, header),
  }));
  const body = buildContextWindow(normalizedRows, targetId, Math.max(160, maxLength - header.length - 1));
  return [header, body].filter(Boolean).join("\n").slice(0, maxLength).trim();
}

function removeRepeatedTableHeader(value, header) {
  const lines = String(value || "").split("\n");
  if (lines[0] === header) lines.shift();
  return lines.join("\n").trim();
}

function formatResolvedSource(chunk) {
  const page = Number(chunk?.page || chunk?.pageNumber || 0);
  const physicalPage = Number(chunk?.physicalPage || 0) || null;
  const documentName = chunk?.documentName || "未命名资料";
  return {
    ...chunk,
    page: page || "",
    sourceText: chunk?.sourceText || chunk?.text || "",
    sourceLocation: physicalPage
      ? `${documentName} 第${physicalPage}页（章节起始页）`
      : page
        ? chunk?.sourcePdfAvailable ? `${documentName} 第${page}页` : `${documentName}（解析页序 ${page}）`
        : `${documentName}（未映射物理页码）`,
    physicalPage: physicalPage || "",
    sourcePdfAvailable: Boolean(chunk?.sourcePdfAvailable),
    sourceFileAvailable: Boolean(chunk?.sourceFileAvailable),
    sourceFileType: String(chunk?.sourceFileType || chunk?.fileExt || "").toLowerCase(),
    locator: buildLocator(chunk, page),
    locatorGrade: chunk?.locatorGrade || "contextual",
  };
}

function buildLocator(chunk, page) {
  let bbox = null;
  try {
    bbox = chunk?.bboxJson ? JSON.parse(chunk.bboxJson) : null;
  } catch {}
  if (page && Array.isArray(bbox) && bbox.length === 4) return { type: "pdf", page, bbox };
  if (chunk?.anchor) return { type: "bookmark", anchor: chunk.anchor };
  if (chunk?.headingPath) return { type: "section", headingPath: chunk.headingPath };
  return null;
}

export { buildContextWindow, resolveChunkContext, resolveChunkSource };

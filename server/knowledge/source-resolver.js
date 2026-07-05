function resolveChunkSource(database, chunk) {
  if (!chunk?.documentId) return formatResolvedSource(chunk);
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
  return formatResolvedSource({ ...chunk, sourceText: sourceText || chunk.text || "" });
}

function formatResolvedSource(chunk) {
  const page = Number(chunk?.page || chunk?.pageNumber || 0);
  const documentName = chunk?.documentName || "未命名资料";
  return {
    ...chunk,
    page: page || "",
    sourceText: chunk?.sourceText || chunk?.text || "",
    sourceLocation: page ? `${documentName} 第${page}页` : `${documentName}（旧资料缺少原文页码）`,
  };
}

export { resolveChunkSource };

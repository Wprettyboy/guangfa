const chunkSize = 900;
const chunkOverlapParagraphs = 1;

function buildKnowledgeParagraphs(pages = []) {
  const paragraphs = [];
  pages.forEach((page) => {
    splitParagraphs(page.text).forEach((text, index) => {
      paragraphs.push({
        id: "",
        page: Number(page.page) || 1,
        paragraphIndex: index + 1,
        text,
        normalizedText: normalizeForStorage(text),
      });
    });
  });
  return paragraphs;
}

function buildKnowledgeChunks({ documentId, kbId, documentName, scope, projectId, paragraphs, createdAt }) {
  const chunks = [];
  const byPage = groupParagraphsByPage(paragraphs);
  for (const pageParagraphs of byPage.values()) {
    let index = 0;
    while (index < pageParagraphs.length) {
      let end = index;
      let text = "";
      while (end < pageParagraphs.length && text.length < chunkSize) {
        text = [text, pageParagraphs[end].text].filter(Boolean).join("\n");
        end += 1;
      }
      if (text.trim()) {
        chunks.push({
          id: `${documentId}-C${String(chunks.length + 1).padStart(4, "0")}`,
          kbId,
          scope,
          projectId,
          documentId,
          documentName,
          chunkIndex: chunks.length + 1,
          page: pageParagraphs[index].page,
          paragraphStart: pageParagraphs[index].paragraphIndex,
          paragraphEnd: pageParagraphs[Math.max(index, end - 1)].paragraphIndex,
          text: text.trim(),
          createdAt,
        });
      }
      index = Math.max(end - chunkOverlapParagraphs, index + 1);
    }
  }
  return chunks;
}

function buildStructuredKnowledgeChunks({ documentId, kbId, documentName, scope, projectId, blocks, fileExt, createdAt }) {
  const chunks = [];
  const headingStack = [];
  const headingChunkIds = [];
  for (const block of blocks || []) {
    const text = normalizeStructuredText(block.text);
    if (!text) continue;
    const level = Math.max(0, Number(block.level) || 0);
    const isTitle = block.type === "title" || level > 0;
    if (isTitle) {
      const titleLevel = Math.max(1, level || 1);
      headingStack.length = titleLevel - 1;
      headingChunkIds.length = titleLevel - 1;
      headingStack[titleLevel - 1] = text;
    }
    const chunkIndex = chunks.length + 1;
    const id = `${documentId}-C${String(chunkIndex).padStart(4, "0")}`;
    const headingPath = headingStack.filter(Boolean).join(">");
    const parentChunkId = isTitle
      ? headingChunkIds[Math.max(0, (level || 1) - 2)] || ""
      : headingChunkIds.filter(Boolean).at(-1) || "";
    const prefixedText = headingPath && !isTitle ? `路径: ${headingPath}\n${text}` : text;
    const hasExactLocator = fileExt === "pdf" && Array.isArray(block.bbox) || Boolean(block.anchor);
    chunks.push({
      id,
      kbId,
      scope,
      projectId,
      documentId,
      documentName,
      chunkIndex,
      page: Math.max(1, Number(block.pageIndex) + 1 || 1),
      paragraphStart: null,
      paragraphEnd: null,
      text: prefixedText,
      sourceText: text,
      blockType: String(block.type || "paragraph"),
      headingPath,
      parentChunkId,
      bboxJson: Array.isArray(block.bbox) ? JSON.stringify(block.bbox) : "",
      anchor: String(block.anchor || ""),
      locatorGrade: hasExactLocator ? "exact" : headingPath ? "container" : "contextual",
      isTable: block.type === "table" ? 1 : 0,
      hasStar: /(?:★|\*\*?)/.test(text) ? 1 : 0,
      createdAt,
    });
    if (isTitle) headingChunkIds[Math.max(0, (level || 1) - 1)] = id;
  }
  return chunks;
}

function splitParagraphs(text) {
  const normalized = String(text || "").replace(/\r/g, "\n");
  const hardParagraphs = normalized
    .split(/\n{1,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2);
  if (hardParagraphs.length > 0) return hardParagraphs;
  return normalized
    .split(/(?<=[。；;！!？?])\s*/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2);
}

function groupParagraphsByPage(paragraphs) {
  const groups = new Map();
  paragraphs.forEach((paragraph) => {
    const page = Number(paragraph.page) || 1;
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(paragraph);
  });
  return groups;
}

function normalizeForStorage(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStructuredText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export { buildKnowledgeChunks, buildKnowledgeParagraphs, buildStructuredKnowledgeChunks, splitParagraphs };

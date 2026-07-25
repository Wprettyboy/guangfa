const chunkSize = 900;
const chunkOverlapParagraphs = 1;
const structuredChunkSize = 1200;

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
      const parentChunkId = headingChunkIds.filter(Boolean).at(-1) || "";
      const titleChunk = appendStructuredChunk({
        chunks,
        documentId,
        kbId,
        documentName,
        scope,
        projectId,
        block,
        fileExt,
        sourceText: text,
        headingPath: headingStack.filter(Boolean).join(">"),
        parentChunkId,
        blockType: "section-parent",
        createdAt,
      });
      headingChunkIds[titleLevel - 1] = titleChunk.id;
      continue;
    }
    const headingPath = headingStack.filter(Boolean).join(">");
    const sectionParentId = headingChunkIds.filter(Boolean).at(-1) || "";
    const prefixLength = headingPath ? `路径: ${headingPath}\n`.length : 0;
    const maxSourceLength = Math.max(320, structuredChunkSize - prefixLength);
    if (block.type === "table") {
      const tableParent = appendStructuredChunk({
        chunks,
        documentId,
        kbId,
        documentName,
        scope,
        projectId,
        block,
        fileExt,
        sourceText: text,
        headingPath,
        parentChunkId: sectionParentId,
        blockType: "table-parent",
        createdAt,
      });
      const tableSegments = splitTableText(text, maxSourceLength);
      tableSegments.forEach((sourceText) => appendStructuredChunk({
        chunks,
        documentId,
        kbId,
        documentName,
        scope,
        projectId,
        block,
        fileExt,
        sourceText,
        headingPath,
        parentChunkId: tableParent.id,
        blockType: "table-row-group",
        locatorIsContainer: tableSegments.length > 1,
        createdAt,
      }));
      continue;
    }
    const segments = splitBoundedStructuredText(text, maxSourceLength);
    segments.forEach((sourceText) => appendStructuredChunk({
      chunks,
      documentId,
      kbId,
      documentName,
      scope,
      projectId,
      block,
      fileExt,
      sourceText,
      headingPath,
      parentChunkId: sectionParentId,
      blockType: segments.length > 1 ? `${String(block.type || "paragraph")}-segment` : String(block.type || "paragraph"),
      locatorIsContainer: segments.length > 1,
      createdAt,
    }));
  }
  return chunks;
}

function appendStructuredChunk({
  chunks,
  documentId,
  kbId,
  documentName,
  scope,
  projectId,
  block,
  fileExt,
  sourceText,
  headingPath,
  parentChunkId,
  blockType,
  locatorIsContainer = false,
  createdAt,
}) {
  const chunkIndex = chunks.length + 1;
  const hasLocator = (fileExt === "pdf" && Array.isArray(block.bbox)) || Boolean(block.anchor);
  const chunk = {
    id: `${documentId}-C${String(chunkIndex).padStart(4, "0")}`,
    kbId,
    scope,
    projectId,
    documentId,
    documentName,
    chunkIndex,
    page: Math.max(1, Number(block.pageIndex) + 1 || 1),
    paragraphStart: null,
    paragraphEnd: null,
    text: headingPath && !blockType.endsWith("-parent") ? `路径: ${headingPath}\n${sourceText}` : sourceText,
    sourceText,
    blockType,
    headingPath,
    parentChunkId,
    bboxJson: Array.isArray(block.bbox) ? JSON.stringify(block.bbox) : "",
    anchor: String(block.anchor || ""),
    locatorGrade: hasLocator ? locatorIsContainer ? "container" : "exact" : headingPath ? "container" : "contextual",
    isTable: block.type === "table" ? 1 : 0,
    hasStar: hasExplicitStarMarker(sourceText) ? 1 : 0,
    createdAt,
  };
  chunks.push(chunk);
  return chunk;
}

function splitBoundedStructuredText(value, maxLength = structuredChunkSize) {
  let remaining = normalizeStructuredText(value);
  if (!remaining) return [];
  const chunks = [];
  while (remaining.length > maxLength) {
    const minimum = Math.floor(maxLength * 0.6);
    const candidate = remaining.slice(0, maxLength + 1);
    let boundary = -1;
    for (const marker of ["\n", "。", "；", ";", "！", "!", "？", "?"]) {
      boundary = Math.max(boundary, candidate.lastIndexOf(marker));
    }
    const end = boundary >= minimum ? boundary + 1 : maxLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitTableText(value, maxLength) {
  const text = normalizeStructuredText(value);
  if (!text || text.length <= maxLength) return text ? [text] : [];
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) return splitBoundedStructuredText(text, maxLength);
  const header = lines[0];
  const rowLimit = Math.max(160, maxLength - header.length - 1);
  const rows = lines.slice(1).flatMap((line) => splitBoundedStructuredText(line, rowLimit));
  const groups = [];
  let current = header;
  for (const row of rows) {
    const candidate = `${current}\n${row}`;
    if (current !== header && candidate.length > maxLength) {
      groups.push(current);
      current = `${header}\n${row}`;
    } else {
      current = candidate;
    }
  }
  if (current !== header) groups.push(current);
  return groups;
}

function isRetrievalKnowledgeChunk(chunk) {
  return !String(chunk?.blockType || "").endsWith("-parent");
}

function filterRetrievalKnowledgeChunks(chunks = []) {
  const referencedParentIds = new Set(chunks.map((chunk) => chunk.parentChunkId).filter(Boolean));
  return chunks.filter((chunk) => isRetrievalKnowledgeChunk(chunk) || !referencedParentIds.has(chunk.id));
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

function hasExplicitStarMarker(value) {
  return /★/.test(String(value || "")) || /^\s*\*(?!\*)\s*\S/m.test(String(value || ""));
}

export {
  buildKnowledgeChunks,
  buildKnowledgeParagraphs,
  buildStructuredKnowledgeChunks,
  filterRetrievalKnowledgeChunks,
  isRetrievalKnowledgeChunk,
  hasExplicitStarMarker,
  splitBoundedStructuredText,
  splitParagraphs,
};

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

export { buildKnowledgeChunks, buildKnowledgeParagraphs, splitParagraphs };

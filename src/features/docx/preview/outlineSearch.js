import { normalizeOutlineTitle } from "../structure/docxStructure.js";
import { resolvePreviewPage } from "./pageLayout.js";

function syncRenderedTocEntries(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return;
  const tocNodes = [...container.querySelectorAll(".docx-wrapper p")].filter(isRenderedTocNode);
  tocNodes.forEach((node) => {
    const level = getRenderedTocLevel(node);
    const match = findRenderedTocOutlineMatch(node.textContent, level, docxOutlineItems);
    if (!match) return;
    if (normalizeOutlineTitle(node.textContent) === normalizeOutlineTitle(match.title)) return;
    node.textContent = match.title;
  });
}

function getRenderedTocLevel(node) {
  const className = [...(node?.classList || [])].find((name) => /^docx_toc\d*$/i.test(name));
  const match = className?.match(/toc(\d*)$/i);
  const level = Number(match?.[1]);
  return Number.isInteger(level) && level > 0 ? level - 1 : null;
}

function findRenderedTocOutlineMatch(text, level, outlineItems) {
  const normalizedText = normalizeOutlineTitle(text);
  const candidates = outlineItems.filter((item) => level === null || item.level === level);
  const direct = candidates.find((item) => {
    const title = normalizeOutlineTitle(item.title);
    return title === normalizedText || title.endsWith(normalizedText) || normalizedText.endsWith(title);
  });
  if (direct) return direct;

  const chapter = getChapterKey(normalizedText);
  if (!chapter) return null;
  const chapterMatches = candidates.filter((item) => getChapterKey(normalizeOutlineTitle(item.title)) === chapter);
  return chapterMatches.length === 1 ? chapterMatches[0] : null;
}

function getChapterKey(value) {
  return String(value || "").match(/第[一二三四五六七八九十百千万0-9]+章/)?.[0] || "";
}

function extractOutlineItems(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return [];

  const paragraphNodes = getRenderedDocumentParagraphNodes(container);
  const nodes = paragraphNodes
    .map((node) => ({
      node,
      text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      normalized: normalizeOutlineTitle(node.textContent),
    }))
    .filter((item) => item.normalized && !isRenderedTocNode(item.node));

  let searchStart = 0;
  return docxOutlineItems.map((item) => {
    const normalizedTitle = normalizeOutlineTitle(item.title);
    const directNode = getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle);
    const matchIndex = directNode
      ? -1
      : nodes.findIndex((candidate, index) => {
          if (index < searchStart) return false;
          return isOutlineTitleMatch(candidate.normalized, normalizedTitle);
        });
    const matched = directNode ? { node: directNode } : matchIndex >= 0 ? nodes[matchIndex] : null;
    if (matched) {
      if (matchIndex >= 0) searchStart = matchIndex + 1;
      matched.node.dataset.outlineId = item.id;
    }
    return {
      ...item,
      page: matched ? resolvePreviewPage(matched.node, container) : 1,
    };
  });
}

function getRenderedDocumentParagraphNodes(container) {
  return [...(container?.querySelectorAll(".docx-wrapper > section > article p") ?? [])];
}

function getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle) {
  const node = paragraphNodes[item.index];
  if (!node || isRenderedTocNode(node)) return null;
  const normalizedNodeText = normalizeOutlineTitle(node.textContent);
  return isOutlineTitleMatch(normalizedNodeText, normalizedTitle) ? node : null;
}

function isRenderedTocNode(node) {
  return [...(node?.classList || [])].some((className) => /^docx_toc\d*$/i.test(className));
}

function isOutlineTitleMatch(candidate, title) {
  if (!candidate || !title) return false;
  if (candidate === title) return true;
  return title.endsWith(candidate);
}

function highlightSearchMatches(container, term) {
  clearSearchHighlights(container);
  const keyword = term.trim();
  if (!container || !keyword) return { count: 0, firstPage: null };

  const nodes = collectSearchTextNodes(container);
  let count = 0;
  let firstPage = null;
  nodes.forEach((node) => {
    const text = node.textContent || "";
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const matches = [];
    let startIndex = 0;
    while (startIndex <= lowerText.length - lowerKeyword.length) {
      const index = lowerText.indexOf(lowerKeyword, startIndex);
      if (index < 0) break;
      matches.push(index);
      startIndex = index + Math.max(1, lowerKeyword.length);
    }

    matches.reverse().forEach((index) => {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + keyword.length);
      const marker = document.createElement("mark");
      marker.className = "doc-search-hit";
      try {
        range.surroundContents(marker);
        count += 1;
        if (!firstPage) {
          firstPage = resolvePreviewPage(marker, container);
        }
      } catch {
        // Search highlighting is best effort; document rendering should stay stable.
      }
    });
  });

  setActiveSearchHit(container, 0);
  return { count, firstPage };
}

function getSearchHits(container) {
  return [...(container?.querySelectorAll(".doc-search-hit") ?? [])];
}

function setActiveSearchHit(container, index) {
  const hits = getSearchHits(container);
  hits.forEach((hit) => hit.classList.remove("active"));
  const target = hits[index] || null;
  target?.classList.add("active");
  return target;
}

function collectSearchTextNodes(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest?.(".doc-search-hit, .preview-mark-list")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function clearSearchHighlights(container) {
  if (!container) return;
  [...container.querySelectorAll(".doc-search-hit")].forEach((node) => {
    const parent = node.parentNode;
    while (node.firstChild) parent?.insertBefore(node.firstChild, node);
    parent?.removeChild(node);
    parent?.normalize?.();
  });
}

export {
  clearSearchHighlights,
  collectSearchTextNodes,
  extractOutlineItems,
  findRenderedTocOutlineMatch,
  getChapterKey,
  getOutlineNodeBySourceParagraphIndex,
  getRenderedDocumentParagraphNodes,
  getRenderedTocLevel,
  getSearchHits,
  highlightSearchMatches,
  isOutlineTitleMatch,
  isRenderedTocNode,
  setActiveSearchHit,
  syncRenderedTocEntries,
};

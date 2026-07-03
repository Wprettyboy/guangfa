function applyPreviewMarker({ fieldId, container, selection, anchorNode }) {
  if (!container) return;
  const selectedText = selection?.toString().trim();
  try {
    if (selection && selectedText && selection.rangeCount > 0 && container.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      const marked = markRangeTextNodes(range, fieldId, container);
      if (!marked) {
        const marker = document.createElement("span");
        marker.className = "docx-field-marker";
        marker.dataset.fieldId = fieldId;
        range.surroundContents(marker);
      }
      selection.removeAllRanges();
      return;
    }
  } catch {
    // Some DOCX fragments split text across nodes; paragraph marking still gives visible feedback.
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const paragraph = element?.closest?.("p, table, li, div");
  if (paragraph && container.contains(paragraph)) {
    paragraph.classList.add("docx-field-marker-block");
    paragraph.dataset.fieldId = fieldId;
  }
}

function markRangeTextNodes(range, fieldId, container, extraClasses = [], restored = false) {
  const textNodes = collectTextNodesInRange(range, container);
  if (textNodes.length === 0) return false;

  textNodes.forEach((node) => {
    let start = node === range.startContainer ? range.startOffset : 0;
    let end = node === range.endContainer ? range.endOffset : node.textContent.length;
    if (start > end) [start, end] = [end, start];
    if (start === end) return;

    const nodeRange = document.createRange();
    nodeRange.setStart(node, start);
    nodeRange.setEnd(node, end);
    const marker = document.createElement("span");
    marker.className = ["docx-field-marker", ...extraClasses].filter(Boolean).join(" ");
    marker.dataset.fieldId = fieldId;
    if (restored) marker.dataset.restoredFieldId = fieldId;
    try {
      nodeRange.surroundContents(marker);
    } catch {
      const parent = node.parentElement?.closest?.("p, table, li, div");
      parent?.classList.add("docx-field-marker-block", ...extraClasses);
      if (parent) {
        parent.dataset.fieldId = fieldId;
        if (restored) parent.dataset.restoredFieldId = fieldId;
      }
    }
  });

  return true;
}

function collectTextNodesInRange(range, container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function createAnnotationMarkerData({ container, selection, anchorNode, text, page }) {
  if (!container) return null;
  const pageElement = getPreviewPageElement(container, page) || getClosestPreviewSection(anchorNode);
  if (!pageElement) return null;
  const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";

  if (selection && selectedText && selection.rangeCount > 0 && pageElement.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    return {
      kind: "range",
      page,
      text: selectedText.slice(0, 500),
      startPath: getNodePath(pageElement, range.startContainer),
      startOffset: range.startOffset,
      endPath: getNodePath(pageElement, range.endContainer),
      endOffset: range.endOffset,
    };
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const target = element?.closest?.("p, table, li, td, div");
  if (target && pageElement.contains(target)) {
    return {
      kind: "block",
      page,
      text: String(text || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
      elementPath: getNodePath(pageElement, target),
    };
  }

  return null;
}

function getClosestPreviewSection(anchorNode) {
  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  return element?.closest?.(".docx-wrapper > section") ?? null;
}

function getNodePath(root, node) {
  if (!root || !node || !root.contains(node)) return [];
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return [];
    path.unshift([...parent.childNodes].indexOf(current));
    current = parent;
  }
  return path;
}

function resolveNodePath(root, path = []) {
  if (!root || !Array.isArray(path)) return null;
  return path.reduce((node, index) => node?.childNodes?.[index] ?? null, root);
}

function removePreviewMarker(fieldId) {
  document.querySelectorAll(`[data-field-id="${fieldId}"]`).forEach((node) => {
    node.classList.remove("docx-field-marker-block");
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
    } else {
      delete node.dataset.fieldId;
    }
  });
}

function clearPreviewMarkers() {
  [...document.querySelectorAll("[data-field-id]")].forEach((node) => {
    const fieldId = node.dataset.fieldId;
    if (fieldId) removePreviewMarker(fieldId);
  });
}

function restoreAnnotationPreviewMarkers(container, fields, selectedFieldId, activePage) {
  clearRestoredAnnotationMarkers(container);
  if (!selectedFieldId) return;
  const page = getPreviewPageElement(container, activePage);
  if (!page) return;

  const field = fields.find((item) => item.id === selectedFieldId && (item.page || 1) === activePage);
  if (!field) return;

  if (restoreAnnotationMarkerByData(page, field)) return;

  const target = findAnnotationFieldTarget(page, field);
  if (!target) return;
  target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
  target.dataset.fieldId = field.id;
  target.dataset.restoredFieldId = field.id;
}

function clearRestoredAnnotationMarkers(container) {
  container?.querySelectorAll("[data-restored-field-id]").forEach((node) => {
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
      return;
    }
    node.classList.remove("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    delete node.dataset.fieldId;
    delete node.dataset.restoredFieldId;
  });
}

function restoreAnnotationMarkerByData(page, field) {
  const marker = field.marker;
  if (!marker) return false;

  if (marker.kind === "range" && marker.startPath && marker.endPath) {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    if (!startNode || !endNode) return false;
    try {
      const range = document.createRange();
      range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
      range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
      return markRangeTextNodes(range, field.id, page, ["docx-field-marker-restored", "docx-field-marker-active"], true);
    } catch {
      return false;
    }
  }

  if (marker.kind === "block" && marker.elementPath) {
    const target = resolveNodePath(page, marker.elementPath);
    if (!target?.classList) return false;
    target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    target.dataset.fieldId = field.id;
    target.dataset.restoredFieldId = field.id;
    return true;
  }

  return false;
}

function findAnnotationFieldTarget(page, field) {
  const candidates = [...page.querySelectorAll("span, p, td, li, table")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!text || text.length > 360) return null;
      const score = scoreAnnotationTarget(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length || getAnnotationNodeRank(a.node) - getAnnotationNodeRank(b.node));
  return candidates[0]?.node || null;
}

function scoreAnnotationTarget(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const tokens = createAnnotationTargetTokens(field, false);
  let score = 0;
  tokens.forEach((token, index) => {
    if (normalizedText.includes(token)) {
      score += Math.max(6, 28 - index * 3);
    }
  });

  if (score === 0) {
    createAnnotationTargetTokens(field, true).forEach((token) => {
      if (normalizedText.includes(token)) score += 4;
    });
  }
  return score;
}

function createAnnotationTargetTokens(field, includeFallbackName = false) {
  const rawTokens = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, "")];
  if (includeFallbackName) rawTokens.push(field.name);

  return [...new Set(rawTokens.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function splitAnnotationContextTokens(value) {
  return String(value || "")
    .split(/[□☐○〇▢_＿—\-]+/)
    .map((item) => item.replace(/[{}]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeAnnotationText(value) {
  return String(value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/[{}（）()：:，,。；;、\s]/g, "")
    .trim();
}

function getAnnotationNodeRank(node) {
  const tag = node?.tagName?.toLowerCase();
  if (tag === "span") return 0;
  if (tag === "p") return 1;
  if (tag === "td" || tag === "li") return 2;
  if (tag === "table") return 3;
  return 4;
}

function getPreviewPageElement(container, pageNumber) {
  return container?.querySelector(`.docx-wrapper > section[data-preview-page="${pageNumber}"]`) ?? null;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export {
  applyPreviewMarker,
  clearPreviewMarkers,
  clearRestoredAnnotationMarkers,
  collectTextNodesInRange,
  createAnnotationMarkerData,
  createAnnotationTargetTokens,
  findAnnotationFieldTarget,
  getAnnotationNodeRank,
  getClosestPreviewSection,
  getNodePath,
  markRangeTextNodes,
  normalizeAnnotationText,
  removePreviewMarker,
  resolveNodePath,
  restoreAnnotationMarkerByData,
  restoreAnnotationPreviewMarkers,
  scoreAnnotationTarget,
  splitAnnotationContextTokens,
};

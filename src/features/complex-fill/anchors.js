const complexFillBookmarkPrefix = "GF_CF_";

function normalizeComplexFillText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function getNextComplexFillFieldId(fields = []) {
  const max = fields.reduce((current, field) => {
    const value = Number(String(field?.id || "").match(/CF-(\d+)/)?.[1] || 0);
    return Math.max(current, value);
  }, 0);
  return `CF-${String(max + 1).padStart(3, "0")}`;
}

function getNextComplexFillAnchorIndex(anchors = [], fieldId) {
  return anchors.filter((anchor) => anchor.fieldId === fieldId).length + 1;
}

function buildComplexFillBookmarkName(fieldId, index = 1) {
  const safeId = String(fieldId || "CF").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
  const safeIndex = String(Math.max(1, Number(index) || 1)).padStart(3, "0");
  return `${complexFillBookmarkPrefix}${safeId}_${safeIndex}`;
}

function createComplexFillField(fields = []) {
  return {
    id: getNextComplexFillFieldId(fields),
    fieldSummary: "新复杂字段",
    formatRequirement: "",
    contentRequirement: "",
    createdAt: Date.now(),
  };
}

function createComplexFillAnchorDraft(field, anchors = []) {
  const index = getNextComplexFillAnchorIndex(anchors, field?.id);
  return {
    id: `CFA-${Date.now()}-${index}`,
    fieldId: field?.id || "",
    fieldSummary: field?.fieldSummary || "",
    bookmarkName: buildComplexFillBookmarkName(field?.id, index),
    page: 1,
    sourceText: "",
    index,
    documentOrder: index,
    createdAt: Date.now(),
  };
}

function normalizeComplexFillField(field = {}, order = 1, existing = null) {
  const summarySource = field.fieldSummary ?? field.description ?? existing?.fieldSummary;
  return {
    id: String(field.id || existing?.id || `CF-${String(order).padStart(3, "0")}`),
    fieldSummary: summarySource == null ? `复杂字段${order}` : normalizeComplexFillText(summarySource, 300),
    formatRequirement: normalizeComplexFillText(field.formatRequirement ?? existing?.formatRequirement, 1000),
    contentRequirement: normalizeComplexFillText(field.contentRequirement ?? existing?.contentRequirement, 1000),
    createdAt: Number(field.createdAt || existing?.createdAt || Date.now()),
  };
}

function normalizeComplexFillFields(fields = []) {
  const items = Array.isArray(fields) ? fields : [];
  return items.map((field, index) => normalizeComplexFillField(field, index + 1)).filter((field) => field.id);
}

function normalizeComplexFillAnchor(anchor = {}, order = 1, existing = null) {
  const fieldId = String(anchor.fieldId || anchor.itemId || anchor.id || existing?.fieldId || "");
  const index = Math.max(1, Number(anchor.index || anchor.anchorIndex || existing?.index || order) || order);
  const bookmarkName = String(anchor.bookmarkName || existing?.bookmarkName || buildComplexFillBookmarkName(fieldId, index));
  if (!fieldId || !bookmarkName) return null;
  const page = Math.max(1, Number(anchor.page || existing?.page || 1) || 1);
  return {
    id: String(existing?.id || anchor.anchorId || anchor.id || `CFA-${String(order).padStart(3, "0")}`),
    fieldId,
    fieldSummary: normalizeComplexFillText(anchor.fieldSummary || anchor.description || existing?.fieldSummary, 300),
    bookmarkName,
    page,
    sourceText: normalizeComplexFillText(anchor.sourceText || anchor.selectedText || existing?.sourceText, 2000),
    index,
    documentOrder: Math.max(1, Number(anchor.documentOrder || existing?.documentOrder || page * 1000000 + index) || page * 1000000 + index),
    createdAt: Number(anchor.createdAt || existing?.createdAt || Date.now()),
  };
}

function normalizeComplexFillAnchors(anchors = []) {
  return Array.isArray(anchors)
    ? anchors.map((anchor, index) => normalizeComplexFillAnchor(anchor, index + 1)).filter(Boolean)
    : [];
}

function applyComplexFillAnchors(existingAnchors = [], incomingAnchors = []) {
  const byBookmark = new Map(normalizeComplexFillAnchors(existingAnchors).map((anchor) => [anchor.bookmarkName, anchor]));
  incomingAnchors.forEach((anchor, offset) => {
    const normalized = normalizeComplexFillAnchor(anchor, byBookmark.size + offset + 1, byBookmark.get(anchor?.bookmarkName));
    if (normalized) byBookmark.set(normalized.bookmarkName, normalized);
  });
  return [...byBookmark.values()]
    .map((anchor, index) => normalizeComplexFillAnchor(anchor, index + 1, anchor))
    .filter(Boolean)
    .sort(compareComplexFillAnchors);
}

function updateComplexFillAnchorPage(anchors = [], bookmarkName, page) {
  const nextPage = Math.max(1, Number(page) || 1);
  if (!bookmarkName || !Number.isFinite(nextPage)) return anchors;
  let changed = false;
  const nextAnchors = anchors.map((anchor) => {
    if (anchor.bookmarkName !== bookmarkName || Number(anchor.page) === nextPage) return anchor;
    changed = true;
    const index = Math.max(1, Number(anchor.index) || 1);
    return {
      ...anchor,
      page: nextPage,
      documentOrder: nextPage * 1000000 + index,
    };
  });
  return changed ? applyComplexFillAnchors([], nextAnchors) : anchors;
}

function compareComplexFillAnchors(left, right) {
  return (
    (Number(left?.documentOrder) || 0) - (Number(right?.documentOrder) || 0) ||
    (Number(left?.page) || 0) - (Number(right?.page) || 0) ||
    (Number(left?.index) || 0) - (Number(right?.index) || 0) ||
    String(left?.bookmarkName || "").localeCompare(String(right?.bookmarkName || ""))
  );
}

function isComplexFillFieldComplete(field) {
  return Boolean(
    String(field?.fieldSummary || "").trim() &&
      String(field?.formatRequirement || "").trim() &&
      String(field?.contentRequirement || "").trim(),
  );
}

function buildComplexFillStateFromTemplate(template = {}) {
  const legacyItems = Array.isArray(template.complexFillItems) ? template.complexFillItems : [];
  const fields = normalizeComplexFillFields(
    Array.isArray(template.complexFillFields) && template.complexFillFields.length > 0
      ? template.complexFillFields
      : legacyItems,
  );
  const anchors = normalizeComplexFillAnchors(
    Array.isArray(template.complexFillAnchors) && template.complexFillAnchors.length > 0
      ? template.complexFillAnchors
      : legacyItems.filter((item) => item?.bookmarkName),
  );
  return { fields, anchors };
}

export {
  applyComplexFillAnchors,
  buildComplexFillBookmarkName,
  buildComplexFillStateFromTemplate,
  compareComplexFillAnchors,
  complexFillBookmarkPrefix,
  createComplexFillAnchorDraft,
  createComplexFillField,
  getNextComplexFillAnchorIndex,
  isComplexFillFieldComplete,
  normalizeComplexFillAnchor,
  normalizeComplexFillAnchors,
  normalizeComplexFillField,
  normalizeComplexFillFields,
  updateComplexFillAnchorPage,
};

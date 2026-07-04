const complexFillBookmarkPrefix = "GF_CF_";

function normalizeComplexFillText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function getNextComplexFillItemId(items = []) {
  const max = items.reduce((current, item) => {
    const value = Number(String(item?.id || "").match(/CF-(\d+)/)?.[1] || 0);
    return Math.max(current, value);
  }, 0);
  return `CF-${String(max + 1).padStart(3, "0")}`;
}

function buildComplexFillBookmarkName(itemOrId) {
  const rawId = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
  const id = String(rawId || "").trim();
  const numberPart = id.match(/^CF-(\d+)$/)?.[1];
  const safeId = numberPart
    ? numberPart.padStart(3, "0")
    : id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  return `${complexFillBookmarkPrefix}${safeId || String(Date.now()).slice(-8)}`;
}

function createComplexFillItemDraft(items = []) {
  const id = getNextComplexFillItemId(items);
  return {
    id,
    bookmarkName: buildComplexFillBookmarkName(id),
    page: 1,
    sourceText: "",
    fieldSummary: "",
    formatRequirement: "",
    contentRequirement: "",
    documentOrder: items.length + 1,
    createdAt: Date.now(),
  };
}

function normalizeComplexFillItem(item = {}, order = 1, existing = null) {
  const id = String(item.id || existing?.id || `CF-${String(order).padStart(3, "0")}`);
  const page = Math.max(1, Number(item.page || existing?.page || 1) || 1);
  const bookmarkName = String(item.bookmarkName || existing?.bookmarkName || buildComplexFillBookmarkName(id));
  return {
    id,
    bookmarkName,
    page,
    sourceText: normalizeComplexFillText(item.sourceText || item.selectedText || existing?.sourceText, 2000),
    fieldSummary: normalizeComplexFillText(item.fieldSummary ?? item.description ?? existing?.fieldSummary, 300),
    formatRequirement: normalizeComplexFillText(item.formatRequirement ?? existing?.formatRequirement, 1000),
    contentRequirement: normalizeComplexFillText(item.contentRequirement ?? existing?.contentRequirement, 1000),
    documentOrder: Math.max(1, Number(item.documentOrder || existing?.documentOrder || page * 1000000 + order) || page * 1000000 + order),
    createdAt: Number(item.createdAt || existing?.createdAt || Date.now()),
  };
}

function normalizeComplexFillItems(items = []) {
  return Array.isArray(items)
    ? items.map((item, index) => normalizeComplexFillItem(item, index + 1)).filter((item) => item.bookmarkName)
    : [];
}

function applyComplexFillItems(existingItems = [], incomingItems = []) {
  const byBookmark = new Map(normalizeComplexFillItems(existingItems).map((item) => [item.bookmarkName, item]));
  incomingItems.forEach((item, offset) => {
    const existing = byBookmark.get(item?.bookmarkName);
    const normalized = normalizeComplexFillItem(item, byBookmark.size + offset + 1, existing);
    if (normalized.bookmarkName) byBookmark.set(normalized.bookmarkName, normalized);
  });
  return [...byBookmark.values()]
    .map((item, index) => normalizeComplexFillItem(item, index + 1, item))
    .sort(compareComplexFillItems);
}

function updateComplexFillItemPage(items = [], bookmarkName, page) {
  const nextPage = Math.max(1, Number(page) || 1);
  if (!bookmarkName || !Number.isFinite(nextPage)) return items;
  let changed = false;
  const nextItems = items.map((item, index) => {
    if (item.bookmarkName !== bookmarkName || Number(item.page) === nextPage) return item;
    changed = true;
    return {
      ...item,
      page: nextPage,
      documentOrder: nextPage * 1000000 + index + 1,
    };
  });
  return changed ? applyComplexFillItems([], nextItems) : items;
}

function compareComplexFillItems(left, right) {
  return (
    (Number(left?.documentOrder) || 0) - (Number(right?.documentOrder) || 0) ||
    (Number(left?.page) || 0) - (Number(right?.page) || 0) ||
    String(left?.bookmarkName || "").localeCompare(String(right?.bookmarkName || ""))
  );
}

function isComplexFillItemComplete(item) {
  return Boolean(
    String(item?.bookmarkName || "").trim() &&
      String(item?.fieldSummary || "").trim() &&
      String(item?.formatRequirement || "").trim() &&
      String(item?.contentRequirement || "").trim(),
  );
}

export {
  applyComplexFillItems,
  buildComplexFillBookmarkName,
  compareComplexFillItems,
  complexFillBookmarkPrefix,
  createComplexFillItemDraft,
  isComplexFillItemComplete,
  normalizeComplexFillItem,
  normalizeComplexFillItems,
  updateComplexFillItemPage,
};

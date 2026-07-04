import { getPlaceholderDefinition } from "./definitions.js";

function applyDetectedPlaceholders(existingAnchors = [], detections = []) {
  const existingByBookmark = new Map(existingAnchors.map((item) => [item.bookmarkName, item]));
  return detections
    .map((item, index) => normalizePlaceholderAnchor(item, index + 1, existingByBookmark.get(item.bookmarkName)))
    .filter(Boolean)
    .sort((a, b) => a.documentOrder - b.documentOrder || a.id.localeCompare(b.id));
}

function normalizePlaceholderAnchor(item = {}, order, existing) {
  const definition = getPlaceholderDefinition(item.key || item.token);
  if (!definition || !item.bookmarkName) return null;
  const page = Math.max(1, Number(item.page || existing?.page || 1) || 1);
  const index = Math.max(1, Number(item.index || order) || order);
  return {
    id: existing?.id || `PH-${String(order).padStart(3, "0")}`,
    key: definition.key,
    label: definition.label,
    token: definition.token,
    bookmarkName: item.bookmarkName,
    page,
    index,
    documentOrder: Math.max(1, Number(item.documentOrder || page * 1000000 + index) || page * 1000000 + index),
    source: "placeholder",
  };
}

export {
  applyDetectedPlaceholders,
};

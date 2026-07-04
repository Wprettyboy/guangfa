const defaultPlaceholderVariables = [
  { id: "PV-001", name: "项目名称", token: "{{项目名称}}", createdAt: 0 },
];

function normalizePlaceholderName(name) {
  return String(name || "").replace(/\s+/g, "").trim().slice(0, 40);
}

function buildPlaceholderToken(name) {
  const normalizedName = normalizePlaceholderName(name);
  return normalizedName ? `{{${normalizedName}}}` : "";
}

function getNextPlaceholderVariableId(variables = []) {
  const max = variables.reduce((current, variable) => {
    const value = Number(String(variable?.id || "").match(/PV-(\d+)/)?.[1] || 0);
    return Math.max(current, value);
  }, 0);
  return `PV-${String(max + 1).padStart(3, "0")}`;
}

function createPlaceholderVariable(name = "新字段", variables = []) {
  const normalizedName = normalizePlaceholderName(name) || "新字段";
  return {
    id: getNextPlaceholderVariableId(variables),
    name: normalizedName,
    token: buildPlaceholderToken(normalizedName),
    createdAt: Date.now(),
  };
}

function normalizePlaceholderVariable(variable = {}, index = 0) {
  const name = normalizePlaceholderName(variable.name || variable.label || variable.key) || `字段${index + 1}`;
  return {
    id: String(variable.id || `PV-${String(index + 1).padStart(3, "0")}`),
    name,
    token: buildPlaceholderToken(name),
    createdAt: Number(variable.createdAt || 0),
  };
}

function normalizePlaceholderVariables(variables) {
  const items = Array.isArray(variables) ? variables : defaultPlaceholderVariables;
  return items.map(normalizePlaceholderVariable).filter((variable) => variable.name && variable.token);
}

function getNextPlaceholderAnchorIndex(anchors = [], variableId) {
  return anchors.filter((anchor) => anchor.variableId === variableId).length + 1;
}

function normalizePlaceholderAnchor(anchor = {}, order = 1, existing = null) {
  const bookmarkName = String(anchor.bookmarkName || existing?.bookmarkName || "");
  if (!bookmarkName) return null;
  const variableName = normalizePlaceholderName(anchor.variableName || anchor.name || anchor.label || existing?.variableName || existing?.name) || "字段";
  const variableId = String(anchor.variableId || existing?.variableId || "");
  const page = Math.max(1, Number(anchor.page || existing?.page || 1) || 1);
  const index = Math.max(1, Number(anchor.index || existing?.index || order) || order);
  const token = anchor.token || existing?.token || buildPlaceholderToken(variableName);
  return {
    id: existing?.id || anchor.id || `PH-${String(order).padStart(3, "0")}`,
    variableId,
    variableName,
    token,
    bookmarkName,
    page,
    index,
    documentOrder: Math.max(1, Number(anchor.documentOrder || existing?.documentOrder || page * 1000000 + index) || page * 1000000 + index),
    source: "placeholder-variable",
  };
}

function applyPlaceholderAnchors(existingAnchors = [], incomingAnchors = []) {
  const byBookmark = new Map(existingAnchors.map((anchor) => [anchor.bookmarkName, anchor]));
  incomingAnchors.forEach((anchor, offset) => {
    const normalized = normalizePlaceholderAnchor(anchor, byBookmark.size + offset + 1, byBookmark.get(anchor?.bookmarkName));
    if (normalized) byBookmark.set(normalized.bookmarkName, normalized);
  });
  return [...byBookmark.values()]
    .map((anchor, index) => normalizePlaceholderAnchor(anchor, index + 1, anchor))
    .filter(Boolean)
    .sort((a, b) => a.documentOrder - b.documentOrder || a.bookmarkName.localeCompare(b.bookmarkName));
}

function updatePlaceholderAnchorPage(anchors = [], bookmarkName, page) {
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
  return changed ? applyPlaceholderAnchors([], nextAnchors) : anchors;
}

export {
  applyPlaceholderAnchors,
  buildPlaceholderToken,
  createPlaceholderVariable,
  defaultPlaceholderVariables,
  getNextPlaceholderAnchorIndex,
  normalizePlaceholderName,
  normalizePlaceholderVariable,
  normalizePlaceholderVariables,
  updatePlaceholderAnchorPage,
};

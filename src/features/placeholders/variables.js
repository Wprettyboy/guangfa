const defaultPlaceholderVariables = [
  { id: "PV-001", name: "项目名称", token: "{{项目名称}}", prompt: "", createdAt: 0 },
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
    prompt: "",
    createdAt: Date.now(),
  };
}

function normalizePlaceholderVariable(variable = {}, index = 0) {
  const name = normalizePlaceholderName(variable.name || variable.label || variable.key) || `字段${index + 1}`;
  const prompt = String(variable.prompt || variable.aiPrompt || variable.instruction || "").trim();
  return {
    id: String(variable.id || `PV-${String(index + 1).padStart(3, "0")}`),
    name,
    token: buildPlaceholderToken(name),
    prompt,
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

function comparePlaceholderAnchors(left, right) {
  return (
    (Number(left?.documentOrder) || 0) - (Number(right?.documentOrder) || 0) ||
    getPlaceholderAnchorPage(left) - getPlaceholderAnchorPage(right) ||
    (Number(left?.index) || 0) - (Number(right?.index) || 0) ||
    String(left?.bookmarkName || "").localeCompare(String(right?.bookmarkName || ""))
  );
}

function getPlaceholderAnchorPage(anchor) {
  const page = Number(anchor?.page);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function labelPlaceholderAnchorPages(anchors = []) {
  return anchors.map((anchor) => {
    const page = getPlaceholderAnchorPage(anchor);
    return {
      ...anchor,
      page,
      pageLabel: `第 ${page} 页`,
    };
  });
}

function buildPlaceholderFillCards(variables = [], anchors = [], fills = {}) {
  const normalizedAnchors = applyPlaceholderAnchors([], anchors);
  return normalizePlaceholderVariables(variables)
    .map((variable) => {
      const variableAnchors = labelPlaceholderAnchorPages(
        normalizedAnchors.filter((anchor) => anchor.variableId === variable.id).sort(comparePlaceholderAnchors),
      );
      if (variableAnchors.length === 0) return null;
      const fill = fills[variable.id] || {};
      return {
        ...variable,
        anchors: variableAnchors,
        insertedCount: variableAnchors.length,
        value: String(fill.value || ""),
        status: fill.status || "未填充",
        confidence: Number(fill.confidence || 0),
        source: fill.source || "待上传资料后生成",
        evidence: fill.evidence || "",
        sourceSnippetText: fill.sourceSnippetText || "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => comparePlaceholderAnchors(left.anchors[0], right.anchors[0]) || left.name.localeCompare(right.name));
}

export {
  applyPlaceholderAnchors,
  buildPlaceholderToken,
  buildPlaceholderFillCards,
  comparePlaceholderAnchors,
  createPlaceholderVariable,
  defaultPlaceholderVariables,
  getNextPlaceholderAnchorIndex,
  getPlaceholderAnchorPage,
  labelPlaceholderAnchorPages,
  normalizePlaceholderName,
  normalizePlaceholderVariable,
  normalizePlaceholderVariables,
  updatePlaceholderAnchorPage,
};

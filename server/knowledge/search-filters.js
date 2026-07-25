function normalizeKnowledgeSearchFilters(value = {}) {
  if (value == null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) throw filterError("filters 必须是对象");
  const filters = {
    documentIds: stringList(value.documentIds, "documentIds", 100),
    pageFrom: optionalPage(value.pageFrom, "pageFrom"),
    pageTo: optionalPage(value.pageTo, "pageTo"),
    isTable: optionalBoolean(value.isTable, "isTable"),
    hasStar: optionalBoolean(value.hasStar, "hasStar"),
    blockTypes: stringList(value.blockTypes, "blockTypes", 30),
    headingPaths: stringList(value.headingPaths, "headingPaths", 100),
  };
  if (filters.pageFrom && filters.pageTo && filters.pageFrom > filters.pageTo) {
    throw filterError("pageFrom 不能大于 pageTo");
  }
  return filters;
}

function buildKnowledgeZvecFilter(allowedKbIds, filters) {
  const kbIds = [...(allowedKbIds || [])].filter(Boolean);
  if (!kbIds.length) return "";
  return [
    `kbId IN (${kbIds.map(quoteFilterString).join(", ")})`,
    filters.documentIds.length ? `documentId IN (${filters.documentIds.map(quoteFilterString).join(", ")})` : "",
    filters.pageFrom ? `page >= ${filters.pageFrom}` : "",
    filters.pageTo ? `page <= ${filters.pageTo}` : "",
    filters.isTable == null ? "" : `isTable = ${filters.isTable ? "true" : "false"}`,
    filters.hasStar == null ? "" : `hasStar = ${filters.hasStar ? "true" : "false"}`,
    filters.blockTypes.length ? `blockType IN (${filters.blockTypes.map(quoteFilterString).join(", ")})` : "",
    filters.headingPaths.length ? `headingPath IN (${filters.headingPaths.map(quoteFilterString).join(", ")})` : "",
  ].filter(Boolean).join(" AND ");
}

function applyKnowledgeSearchFilters(chunks, filters) {
  const documentIds = new Set(filters.documentIds);
  const blockTypes = new Set(filters.blockTypes);
  const headingPaths = new Set(filters.headingPaths);
  return chunks.filter((chunk) => {
    const page = Number(chunk.page || 0);
    if (documentIds.size && !documentIds.has(chunk.documentId)) return false;
    if (filters.pageFrom && page < filters.pageFrom) return false;
    if (filters.pageTo && page > filters.pageTo) return false;
    if (filters.isTable != null && Boolean(chunk.isTable) !== filters.isTable) return false;
    if (filters.hasStar != null && Boolean(chunk.hasStar) !== filters.hasStar) return false;
    if (blockTypes.size && !blockTypes.has(chunk.blockType)) return false;
    if (headingPaths.size && !headingPaths.has(chunk.headingPath)) return false;
    return true;
  });
}

function describeKnowledgeFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value != null));
}

function stringList(value, name, maxItems) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw filterError(`${name} 必须是最多 ${maxItems} 项的数组`);
  const rows = value.map((item) => String(item || "").trim());
  if (rows.some((item) => !item || item.length > 240)) throw filterError(`${name} 包含无效值`);
  return [...new Set(rows)];
}

function optionalPage(value, name) {
  if (value == null || value === "") return null;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw filterError(`${name} 必须是正整数`);
  return page;
}

function optionalBoolean(value, name) {
  if (value == null || value === "") return null;
  if (typeof value !== "boolean") throw filterError(`${name} 必须是布尔值`);
  return value;
}

function quoteFilterString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function filterError(message) {
  const error = new TypeError(message);
  error.statusCode = 400;
  return error;
}

export { applyKnowledgeSearchFilters, buildKnowledgeZvecFilter, describeKnowledgeFilters, normalizeKnowledgeSearchFilters };

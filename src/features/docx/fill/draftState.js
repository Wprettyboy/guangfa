const pendingStatus = "生成中";

function normalizePendingFill(fill = {}) {
  if (!fill || typeof fill !== "object" || fill.status !== pendingStatus) return fill;
  const value = String(fill.value || "").trim();
  return {
    ...fill,
    status: value ? "待确认" : "未填充",
    confidence: value ? Number(fill.confidence || 0) : 0,
  };
}

function normalizePendingFillMap(fills = {}) {
  if (!fills || typeof fills !== "object" || Array.isArray(fills)) return {};
  let changed = false;
  const nextFills = Object.fromEntries(
    Object.entries(fills).map(([fieldId, fill]) => {
      const nextFill = normalizePendingFill(fill);
      if (nextFill !== fill) changed = true;
      return [fieldId, nextFill];
    }),
  );
  return changed ? nextFills : fills;
}

function normalizePendingFillFields(fields = []) {
  if (!Array.isArray(fields)) return [];
  let changed = false;
  const nextFields = fields.map((field) => {
    const nextField = normalizePendingFill(field);
    if (nextField !== field) changed = true;
    return nextField;
  });
  return changed ? nextFields : fields;
}

function normalizeDraftFillState(draft) {
  if (!draft) return draft;
  return {
    ...draft,
    placeholderFills: normalizePendingFillMap(draft.placeholderFills),
    complexFillFills: normalizePendingFillMap(draft.complexFillFills),
    fillFields: normalizePendingFillFields(draft.fillFields),
  };
}

export {
  normalizeDraftFillState,
  normalizePendingFillFields,
  normalizePendingFillMap,
};

function buildPlanningReplaceTarget(group) {
  const styleRef = normalizePlanningStyleRef(group?.styleRef);
  const hasSubtreeEndRef = Boolean(group && Object.hasOwn(group, "subtreeEndRef"));
  const subtreeEndRef = group?.subtreeEndRef === null ? null : normalizePlanningStyleRef(group?.subtreeEndRef);
  const subtreeParagraphCount = normalizePlanningSubtreeParagraphCount(group?.subtreeParagraphCount);
  const title = String(styleRef?.title || styleRef?.text || "").trim();
  const endTitle = String(subtreeEndRef?.title || subtreeEndRef?.text || "").trim();
  if (!styleRef || !title || subtreeParagraphCount === null || !hasSubtreeEndRef) return null;
  if (group.subtreeEndRef !== null && !subtreeEndRef) return null;
  if (subtreeEndRef && !endTitle) return null;
  if (subtreeEndRef && subtreeEndRef.paragraphIndex !== styleRef.paragraphIndex + subtreeParagraphCount) return null;
  return {
    scope: "subtree",
    title,
    styleRef,
    subtreeEndRef,
    subtreeParagraphCount,
  };
}

function bindPlanningInsertTarget(payload, group) {
  return {
    ...(payload || {}),
    replaceTarget: buildPlanningReplaceTarget(group),
  };
}

function normalizePlanningSubtreeMetadata(item) {
  const metadata = {
    subtreeParagraphCount: normalizePlanningSubtreeParagraphCount(item?.subtreeParagraphCount),
  };
  if (item && Object.hasOwn(item, "subtreeEndRef")) {
    metadata.subtreeEndRef = item.subtreeEndRef === null
      ? null
      : normalizePlanningStyleRef(item.subtreeEndRef) || undefined;
  }
  return metadata;
}

function normalizePlanningStyleRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  if (ref.paragraphIndex == null || String(ref.paragraphIndex).trim() === "") return null;
  const paragraphIndex = Number(ref.paragraphIndex);
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return null;
  return {
    paragraphIndex,
    outlineIndex: Number.isFinite(Number(ref.outlineIndex)) ? Number(ref.outlineIndex) : null,
    title: String(ref.title || "").trim(),
    text: String(ref.text || "").trim(),
    level: Number.isFinite(Number(ref.level)) ? Number(ref.level) : null,
    styleName: String(ref.styleName || "").trim(),
  };
}

function normalizePlanningSubtreeParagraphCount(value) {
  if (value == null || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 ? count : null;
}

export {
  bindPlanningInsertTarget,
  buildPlanningReplaceTarget,
  normalizePlanningSubtreeMetadata,
  normalizePlanningSubtreeParagraphCount,
};

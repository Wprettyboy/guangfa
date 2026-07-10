function buildDraftSectionInsert(section) {
  return buildDraftSectionsInsert([section]);
}

function buildDraftSectionsInsert(sections = []) {
  const rows = Array.isArray(sections) ? sections.filter(Boolean) : [];
  const first = rows[0] || {};
  const paragraphs = rows.flatMap((section) => splitBodyParagraphs(section?.content || "").map((text) => ({
    type: "body",
    style: "body",
    styleFallback: "body",
    styleRef: normalizeStyleRef(section?.replaceTarget?.bodyStyleRef),
    text,
  })));
  const normalized = paragraphs.filter((paragraph) => paragraph.text);
  return {
    text: normalized.map((paragraph) => paragraph.text).join("\n").trim(),
    paragraphs: normalized,
    replaceTarget: normalizeReplaceTarget(first?.replaceTarget, first?.sourceHeading),
  };
}

function groupDraftSectionsByTarget(sections = []) {
  const groups = new Map();
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const target = normalizeReplaceTarget(section?.replaceTarget, section?.sourceHeading);
    const key = target?.styleRef?.paragraphIndex != null
      ? `ref:${target.styleRef.paragraphIndex}`
      : `title:${target?.title || section?.sourceHeading || section?.title || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section);
  });
  return Array.from(groups.values());
}

function splitBodyParagraphs(content) {
  return String(content || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeReplaceTarget(target, fallbackTitle = "") {
  const title = String(target?.title || fallbackTitle || "").trim();
  const styleRef = normalizeStyleRef(target?.styleRef);
  const bodyStyleRef = normalizeStyleRef(target?.bodyStyleRef);
  const rawBodyParagraphCount = target?.bodyParagraphCount;
  const bodyParagraphCount = rawBodyParagraphCount == null || String(rawBodyParagraphCount).trim() === "" ? null : Number(rawBodyParagraphCount);
  return title || styleRef
    ? {
      title,
      headingPath: Array.isArray(target?.headingPath) ? target.headingPath.map((item) => String(item || "").trim()).filter(Boolean) : [],
      styleRef,
      bodyStyleRef,
      bodyParagraphCount: Number.isInteger(bodyParagraphCount) && bodyParagraphCount >= 0 ? bodyParagraphCount : null,
    }
    : null;
}

function normalizeStyleRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const paragraphIndex = Number(ref.paragraphIndex);
  if (!Number.isFinite(paragraphIndex)) return null;
  return {
    paragraphIndex,
    outlineIndex: Number.isFinite(Number(ref.outlineIndex)) ? Number(ref.outlineIndex) : null,
    title: String(ref.title || "").trim(),
    text: String(ref.text || "").trim(),
    level: Number.isFinite(Number(ref.level)) ? Number(ref.level) : null,
    styleName: String(ref.styleName || "").trim(),
  };
}

export {
  buildDraftSectionsInsert,
  buildDraftSectionInsert,
  groupDraftSectionsByTarget,
};

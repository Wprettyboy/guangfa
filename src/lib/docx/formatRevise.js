import {
  WORD_NS,
  collectParagraphs,
  createWordElement,
  ensureWordChild,
  getWordAttr,
  getWordChild,
  getWordElements,
  loadDocxXml,
  parseDocxStyles,
  serializeXml,
  setWordAttr,
} from "./wordXml";

export async function reviseDocxFormat(buffer, issues, config = {}) {
  const { zip, documentDoc, stylesDoc } = await loadDocxXml(buffer.slice(0));
  const params = normalizeAuditParams(config.params);
  const styleData = parseDocxStyles(stylesDoc);
  const paragraphs = collectParagraphs(documentDoc, styleData);

  for (const issue of issues) {
    if (issue.action === "demoteBodyOutline") demoteBodyOutline(documentDoc, paragraphs, issue.targets, styleData, params);
    if (issue.action === "applyHeadingStyles") applyHeadingStyles(documentDoc, paragraphs, issue.targets, styleData);
    if (issue.action === "mergeSplitHeadings") mergeSplitHeadings(documentDoc, paragraphs, issue.targets);
    if (issue.action === "normalizeSections") normalizeSections(documentDoc, params);
    if (issue.action === "normalizeBodyFonts") normalizeBodyFonts(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeBodySizes") normalizeBodySizes(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeFirstLineIndent") normalizeFirstLineIndent(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeLineSpacing") normalizeLineSpacing(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeParagraphSpacing") normalizeParagraphSpacing(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "removeExtraBlankLines") removeExtraBlankLines(paragraphs, issue.targets);
    if (issue.action === "normalizeHeadingLevels") normalizeHeadingLevels(documentDoc, paragraphs, issue.targets, styleData, params);
    if (issue.action === "normalizeHeadingVisualStyles") normalizeHeadingVisualStyles(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeWordOutline") normalizeWordOutline(documentDoc, paragraphs, issue.targets, styleData, params);
    if (issue.action === "applyAiOutlinePlan") applyAiOutlinePlan(documentDoc, paragraphs, issue.targets, styleData, params);
    if (issue.action === "markTocDirty") await markTocDirty(documentDoc, zip, styleData);
    if (issue.action === "normalizeBodyParagraphs") normalizeBodyParagraphs(documentDoc, paragraphs, issue.targets, params);
    if (issue.action === "normalizeTables") normalizeTables(documentDoc, issue.targets);
  }

  zip.file("word/document.xml", serializeXml(documentDoc));
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function optimizeDocxOutlineStyles(buffer, config = {}) {
  const { zip, documentDoc, stylesDoc } = await loadDocxXml(buffer.slice(0));
  const params = normalizeAuditParams(config.params);
  const styleData = parseDocxStyles(stylesDoc);
  const paragraphs = collectParagraphs(documentDoc, styleData);

  paragraphs.forEach((item) => {
    if (!Number.isInteger(item.level) || item.level < 0 || item.level > 8 || item.inTable) return;
    applyOutlineVisualStyle(documentDoc, item.paragraph, item.level, params);
  });

  zip.file("word/document.xml", serializeXml(documentDoc));
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function applyOutlineVisualStyle(doc, paragraph, level, params) {
  const pPr = ensureWordChild(doc, paragraph, "pPr");
  ensureWordChild(doc, pPr, "keepNext");
  ensureWordChild(doc, pPr, "keepLines");

  const spacing = ensureWordChild(doc, pPr, "spacing");
  setWordAttr(spacing, "before", level === 0 ? "360" : level === 1 ? "240" : "160");
  setWordAttr(spacing, "after", level === 0 ? "240" : "120");
  setWordAttr(spacing, "line", "360");
  setWordAttr(spacing, "lineRule", "auto");

  const jc = ensureWordChild(doc, pPr, "jc");
  setWordAttr(jc, "val", level === 0 ? "center" : "left");

  const ind = ensureWordChild(doc, pPr, "ind");
  setWordAttr(ind, "firstLine", "0");
  setWordAttr(ind, "left", "0");

  const size = level === 0 ? params.headingLevel1HalfPt : level === 1 ? params.headingLevel2HalfPt : level === 2 ? params.headingLevel3HalfPt : "24";
  const font = level === 0 ? params.headingLevel1Font : level === 1 ? params.headingLevel2Font : level === 2 ? params.headingLevel3Font : params.bodyFont;
  getWordElements(paragraph, "r").forEach((run) => {
    const rPr = ensureWordChild(doc, run, "rPr", run.firstChild);
    const rFonts = ensureWordChild(doc, rPr, "rFonts");
    ["ascii", "hAnsi", "eastAsia", "cs"].forEach((name) => setWordAttr(rFonts, name, font));
    setWordAttr(ensureWordChild(doc, rPr, "b"), "val", "1");
    setWordAttr(ensureWordChild(doc, rPr, "sz"), "val", size);
    setWordAttr(ensureWordChild(doc, rPr, "szCs"), "val", size);
  });
}

function demoteBodyOutline(doc, paragraphs, targets, styleData, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index)) return;
    const pPr = ensureWordChild(doc, item.paragraph, "pPr");
    getWordChild(pPr, "outlineLvl")?.remove();
    const pStyle = getWordChild(pPr, "pStyle");
    if (pStyle && Number.isInteger(styleData.styles.get(item.styleId)?.level)) pStyle.remove();
    applyBodyVisualStyle(doc, item.paragraph, params);
  });
}

function applyHeadingStyles(doc, paragraphs, targets, styleData) {
  targets.forEach((target) => {
    const item = paragraphs[target.index];
    const styleId = styleData.headingStyleIds.get(target.level);
    if (!item || !styleId) return;
    const pPr = ensureWordChild(doc, item.paragraph, "pPr");
    const pStyle = ensureWordChild(doc, pPr, "pStyle");
    setWordAttr(pStyle, "val", styleId);
    getWordChild(pPr, "outlineLvl")?.remove();
  });
}

function mergeSplitHeadings(doc, paragraphs, targets) {
  [...targets]
    .sort((a, b) => b.index - a.index)
    .forEach((target) => {
      const item = paragraphs[target.index];
      const next = paragraphs[target.nextIndex];
      if (!item || !next || item.inTable || next.inTable || item.level !== next.level) return;
      setParagraphText(doc, item.paragraph, `${item.text}${next.text}`);
      next.paragraph.remove();
    });
}

function normalizeSections(doc, params) {
  const sections = getWordElements(doc, "sectPr");
  const baseline = findMostCommonSectionLayout(sections);
  if (!baseline) return;

  sections.forEach((section) => {
    const pgSz = ensureWordChild(doc, section, "pgSz");
    setWordAttr(pgSz, "w", baseline.width);
    setWordAttr(pgSz, "h", baseline.height);
    if (baseline.orient) setWordAttr(pgSz, "orient", baseline.orient);
    else pgSz.removeAttributeNS(WORD_NS, "orient");

    const pgMar = ensureWordChild(doc, section, "pgMar");
    setWordAttr(pgMar, "top", params.pageMarginTopTwip);
    setWordAttr(pgMar, "right", params.pageMarginRightTwip);
    setWordAttr(pgMar, "bottom", params.pageMarginBottomTwip);
    setWordAttr(pgMar, "left", params.pageMarginLeftTwip);
    ["header", "footer", "gutter"].forEach((name) => {
      if (baseline[name]) setWordAttr(pgMar, name, baseline[name]);
    });
  });
}

function findMostCommonSectionLayout(sections) {
  const layouts = sections.map((section) => {
    const pageSize = getWordChild(section, "pgSz");
    const margin = getWordChild(section, "pgMar");
    return {
      width: getWordAttr(pageSize, "w"),
      height: getWordAttr(pageSize, "h"),
      orient: getWordAttr(pageSize, "orient"),
      top: getWordAttr(margin, "top"),
      right: getWordAttr(margin, "right"),
      bottom: getWordAttr(margin, "bottom"),
      left: getWordAttr(margin, "left"),
      header: getWordAttr(margin, "header"),
      footer: getWordAttr(margin, "footer"),
      gutter: getWordAttr(margin, "gutter"),
    };
  });
  return layouts
    .map((layout) => ({
      layout,
      signature: Object.values(layout).join("/"),
      count: layouts.filter((item) => Object.values(item).join("/") === Object.values(layout).join("/")).length,
    }))
    .sort((a, b) => b.count - a.count)[0]?.layout;
}

function setParagraphText(doc, paragraph, text) {
  const pPr = getWordChild(paragraph, "pPr");
  const firstRunPr = getWordChild(getWordElements(paragraph, "r")[0], "rPr")?.cloneNode(true) || null;
  [...paragraph.childNodes].forEach((child) => {
    if (child !== pPr) child.remove();
  });
  const run = createWordElement(doc, "r");
  if (firstRunPr) run.append(firstRunPr);
  const textNode = createWordElement(doc, "t");
  textNode.setAttribute("xml:space", "preserve");
  textNode.textContent = text;
  run.append(textNode);
  paragraph.append(run);
}

function normalizeBodyFonts(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable) return;
    getWordElements(item.paragraph, "r").forEach((run) => {
      const rPr = ensureWordChild(doc, run, "rPr", run.firstChild);
      const rFonts = ensureWordChild(doc, rPr, "rFonts");
      ["ascii", "hAnsi", "eastAsia", "cs"].forEach((name) => setWordAttr(rFonts, name, params.bodyFont));
      getWordChild(rPr, "b")?.remove();
      getWordChild(rPr, "bCs")?.remove();
    });
  });
}

function normalizeBodySizes(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable) return;
    getWordElements(item.paragraph, "r").forEach((run) => {
      const rPr = ensureWordChild(doc, run, "rPr", run.firstChild);
      setWordAttr(ensureWordChild(doc, rPr, "sz"), "val", params.bodySizeHalfPt);
      setWordAttr(ensureWordChild(doc, rPr, "szCs"), "val", params.bodySizeHalfPt);
    });
  });
}

function normalizeBodyParagraphs(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable || item.text.length < 12) return;
    const pPr = ensureWordChild(doc, item.paragraph, "pPr");
    const spacing = ensureWordChild(doc, pPr, "spacing");
    setWordAttr(spacing, "before", params.paragraphBeforeTwip);
    setWordAttr(spacing, "after", params.paragraphAfterTwip);
    setWordAttr(spacing, "line", params.lineSpacingTwip);
    setWordAttr(spacing, "lineRule", "auto");
    const ind = ensureWordChild(doc, pPr, "ind");
    setWordAttr(ind, "firstLine", params.firstLineTwip);
  });
}

function normalizeFirstLineIndent(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable) return;
    const ind = ensureWordChild(doc, ensureWordChild(doc, item.paragraph, "pPr"), "ind");
    setWordAttr(ind, "firstLine", params.firstLineTwip);
  });
}

function normalizeLineSpacing(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable) return;
    const spacing = ensureWordChild(doc, ensureWordChild(doc, item.paragraph, "pPr"), "spacing");
    setWordAttr(spacing, "line", params.lineSpacingTwip);
    setWordAttr(spacing, "lineRule", "auto");
  });
}

function normalizeParagraphSpacing(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || Number.isInteger(item.level) || item.inTable) return;
    const spacing = ensureWordChild(doc, ensureWordChild(doc, item.paragraph, "pPr"), "spacing");
    setWordAttr(spacing, "before", params.paragraphBeforeTwip);
    setWordAttr(spacing, "after", params.paragraphAfterTwip);
  });
}

function removeExtraBlankLines(paragraphs, targets) {
  const indexes = new Set(targets.map((target) => target.index));
  [...paragraphs]
    .filter((item) => indexes.has(item.index) && !item.text && !item.inTable)
    .sort((a, b) => b.index - a.index)
    .forEach((item) => item.paragraph.remove());
}

function normalizeHeadingLevels(doc, paragraphs, targets, styleData, params) {
  applyHeadingStyles(doc, paragraphs, targets, styleData);
  targets.forEach((target) => {
    const item = paragraphs[target.index];
    if (item && Number.isInteger(target.level)) applyOutlineVisualStyle(doc, item.paragraph, target.level, params);
  });
}

function normalizeHeadingVisualStyles(doc, paragraphs, targets, params) {
  const indexes = new Set(targets.map((target) => target.index));
  paragraphs.forEach((item) => {
    if (!indexes.has(item.index) || !Number.isInteger(item.level) || item.inTable) return;
    applyOutlineVisualStyle(doc, item.paragraph, item.level, params);
  });
}

function normalizeWordOutline(doc, paragraphs, targets, styleData, params) {
  targets.forEach((target) => {
    const item = paragraphs[target.index];
    if (!item) return;
    if (Number.isInteger(target.level)) {
      applyHeadingStyles(doc, paragraphs, [target], styleData);
      applyOutlineVisualStyle(doc, item.paragraph, target.level, params);
    } else {
      demoteBodyOutline(doc, paragraphs, [target], styleData, params);
    }
  });
}

function applyAiOutlinePlan(doc, paragraphs, targets, styleData, params) {
  const outlineParagraphs = paragraphs.filter((item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 8 && !item.inTable);
  targets.forEach((target) => {
    const item = resolveAiOutlineTargetParagraph(paragraphs, outlineParagraphs, target);
    if (!item || item.inTable) return;
    const resolvedTarget = { ...target, index: item.index };
    if (target.operation === "heading" && Number.isInteger(target.level)) {
      applyHeadingStyles(doc, paragraphs, [resolvedTarget], styleData);
      applyOutlineVisualStyle(doc, item.paragraph, target.level, params);
      return;
    }
    if (target.operation === "demote") {
      demoteBodyOutline(doc, paragraphs, [resolvedTarget], styleData, params);
    }
  });
}

function resolveAiOutlineTargetParagraph(paragraphs, outlineParagraphs, target) {
  const outlineIndex = Number(target.outlineIndex);
  const outlineItem = Number.isInteger(outlineIndex) ? outlineParagraphs[outlineIndex] : null;
  if (outlineItem && isAiOutlineTargetMatch(outlineItem, target)) return outlineItem;

  const indexedItem = paragraphs[target.index];
  if (indexedItem && isAiOutlineTargetMatch(indexedItem, target)) return indexedItem;

  const targetText = normalizeRevisionText(target.text);
  if (!targetText || targetText === "空标题") return null;
  return outlineParagraphs.find((item) => isRevisionTextMatch(normalizeRevisionText(item.text), targetText) && isAiOutlineLevelMatch(item, target)) || null;
}

function isAiOutlineTargetMatch(item, target) {
  if (!item) return false;
  const targetText = normalizeRevisionText(target.text);
  if (!targetText || targetText === "空标题") return !normalizeRevisionText(item.text);
  if (!isRevisionTextMatch(normalizeRevisionText(item.text), targetText)) return false;
  return isAiOutlineLevelMatch(item, target);
}

function isRevisionTextMatch(itemText, targetText) {
  return itemText === targetText || (targetText.length >= 40 && itemText.startsWith(targetText));
}

function isAiOutlineLevelMatch(item, target) {
  const outlineLevel = Number(target.outlineLevel);
  return !Number.isInteger(outlineLevel) || item.level === outlineLevel;
}

function normalizeRevisionText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function applyBodyVisualStyle(doc, paragraph, params) {
  const pPr = ensureWordChild(doc, paragraph, "pPr");
  const spacing = ensureWordChild(doc, pPr, "spacing");
  setWordAttr(spacing, "before", params.paragraphBeforeTwip);
  setWordAttr(spacing, "after", params.paragraphAfterTwip);
  setWordAttr(spacing, "line", params.lineSpacingTwip);
  setWordAttr(spacing, "lineRule", "auto");
  const ind = ensureWordChild(doc, pPr, "ind");
  setWordAttr(ind, "firstLine", params.firstLineTwip);
  setWordAttr(ind, "left", "0");
  const jc = getWordChild(pPr, "jc");
  if (jc) jc.remove();

  getWordElements(paragraph, "r").forEach((run) => {
    const rPr = ensureWordChild(doc, run, "rPr", run.firstChild);
    const rFonts = ensureWordChild(doc, rPr, "rFonts");
    ["ascii", "hAnsi", "eastAsia", "cs"].forEach((name) => setWordAttr(rFonts, name, params.bodyFont));
    setWordAttr(ensureWordChild(doc, rPr, "sz"), "val", params.bodySizeHalfPt);
    setWordAttr(ensureWordChild(doc, rPr, "szCs"), "val", params.bodySizeHalfPt);
    getWordChild(rPr, "b")?.remove();
  });
}

async function markTocDirty(doc, zip, styleData) {
  rebuildPlainToc(doc, styleData);
  getWordElements(doc, "fldChar").forEach((field) => {
    if (getWordAttr(field, "fldCharType") === "begin") setWordAttr(field, "dirty", "true");
  });
  const settingsXml = zip.file("word/settings.xml");
  if (!settingsXml) return;
  const xml = await settingsXml.async("text");
  const settingsDoc = new DOMParser().parseFromString(xml, "application/xml");
  const updateFields = ensureWordChild(settingsDoc, settingsDoc.documentElement, "updateFields");
  setWordAttr(updateFields, "val", "true");
  zip.file("word/settings.xml", serializeXml(settingsDoc));
}

function rebuildPlainToc(doc, styleData) {
  const paragraphs = collectParagraphs(doc, styleData);
  const tocTitle = paragraphs.find((item) => /^目\s*录$/.test(item.text));
  const tocItems = paragraphs.filter((item) => isTocParagraph(item));
  if (!tocTitle || tocItems.length === 0) return;

  const pageByTitle = new Map();
  tocItems.forEach((item) => {
    const match = item.text.match(/^(.+?)(?:[.\u2026·\s]+)(\d+)$/);
    if (match) pageByTitle.set(match[1].trim(), match[2]);
  });

  const pageByParagraph = estimateHeadingPages(paragraphs);
  const headings = paragraphs.filter(
    (item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 2 && !item.inTable && !isTocParagraph(item) && !/^目\s*录$/.test(item.text),
  );
  if (headings.length === 0) return;

  const body = tocTitle.paragraph.parentNode;
  const insertBefore = findTocInsertBefore(paragraphs, tocTitle);
  tocItems.forEach((item) => item.paragraph.remove());
  headings.forEach((heading) => {
    body.insertBefore(createTocParagraph(doc, heading, pageByTitle.get(heading.text) || pageByParagraph.get(heading.index) || "1"), insertBefore);
  });
}

function findTocInsertBefore(paragraphs, tocTitle) {
  const afterTitle = paragraphs.filter((item) => item.index > tocTitle.index);
  return afterTitle.find((item) => !isTocParagraph(item))?.paragraph || tocTitle.paragraph.nextSibling;
}

function createTocParagraph(doc, heading, page) {
  const paragraph = createWordElement(doc, "p");
  const pPr = createWordElement(doc, "pPr");
  const pStyle = createWordElement(doc, "pStyle");
  setWordAttr(pStyle, "val", `TOC${Math.min(heading.level + 1, 9)}`);
  pPr.append(pStyle);
  paragraph.append(pPr);

  const run = createWordElement(doc, "r");
  const text = createWordElement(doc, "t");
  text.setAttribute("xml:space", "preserve");
  text.textContent = `${heading.text}${".".repeat(Math.max(8, 44 - heading.text.length))}${page}`;
  run.append(text);
  paragraph.append(run);
  return paragraph;
}

function estimateHeadingPages(paragraphs) {
  const pages = new Map();
  let page = 1;
  let contentStarted = false;
  paragraphs.forEach((item) => {
    if (Number.isInteger(item.level) && item.level >= 0 && item.level <= 8 && !isTocParagraph(item)) {
      contentStarted = true;
      pages.set(item.index, String(page));
    }
    const hasPageBreak = getWordElements(item.paragraph, "br").some((br) => getWordAttr(br, "type") === "page");
    const hasSectionBreak = Boolean(getWordChild(getWordChild(item.paragraph, "pPr"), "sectPr"));
    if (contentStarted && (hasPageBreak || hasSectionBreak)) page += 1;
  });
  return pages;
}

function isTocParagraph(item) {
  return /^TOC\d+$/i.test(item.styleId || "") || /^toc\s*\d*$/i.test(item.styleName || "");
}

function normalizeTables(doc, targets) {
  const indexes = new Set(targets.map((target) => target.index));
  [...doc.getElementsByTagNameNS(WORD_NS, "tbl")].forEach((table, index) => {
    if (!indexes.has(index)) return;
    const tblPr = ensureWordChild(doc, table, "tblPr");
    const borders = ensureWordChild(doc, tblPr, "tblBorders");
    ["top", "left", "bottom", "right", "insideH", "insideV"].forEach((name) => {
      const border = ensureWordChild(doc, borders, name);
      setWordAttr(border, "val", "single");
      setWordAttr(border, "sz", "4");
      setWordAttr(border, "space", "0");
      setWordAttr(border, "color", "666666");
    });
    const cellMar = ensureWordChild(doc, tblPr, "tblCellMar");
    ["top", "left", "bottom", "right"].forEach((name) => {
      const margin = ensureWordChild(doc, cellMar, name);
      setWordAttr(margin, "w", "80");
      setWordAttr(margin, "type", "dxa");
    });
    [...table.getElementsByTagNameNS(WORD_NS, "tc")].forEach((cell) => {
      const tcPr = ensureWordChild(doc, cell, "tcPr");
      const vAlign = ensureWordChild(doc, tcPr, "vAlign");
      setWordAttr(vAlign, "val", "center");
    });
  });
}

function normalizeAuditParams(params = {}) {
  const bodyFontSizePt = Number(params.bodyFontSizePt) || 16;
  return {
    pageMarginTopTwip: String(mmToTwip(params.pageMarginTopMm ?? 37)),
    pageMarginRightTwip: String(mmToTwip(params.pageMarginRightMm ?? 26)),
    pageMarginBottomTwip: String(mmToTwip(params.pageMarginBottomMm ?? 35)),
    pageMarginLeftTwip: String(mmToTwip(params.pageMarginLeftMm ?? 28)),
    bodyFont: String(params.bodyFont || "仿宋").trim() || "仿宋",
    bodySizeHalfPt: String(Math.round(bodyFontSizePt * 2)),
    firstLineTwip: String(Math.round((Number(params.firstLineChars) || 2) * 210)),
    lineSpacingTwip: String(Math.round((Number(params.lineSpacing) || 1.5) * 240)),
    paragraphBeforeTwip: String(Math.round((Number(params.paragraphBeforePt) || 0) * 20)),
    paragraphAfterTwip: String(Math.round((Number(params.paragraphAfterPt) || 0) * 20)),
    headingLevel1Font: String(params.headingLevel1Font || "小标宋").trim() || "小标宋",
    headingLevel1HalfPt: String(Math.round((Number(params.headingLevel1SizePt) || 22) * 2)),
    headingLevel2Font: String(params.headingLevel2Font || "黑体").trim() || "黑体",
    headingLevel2HalfPt: String(Math.round((Number(params.headingLevel2SizePt) || 16) * 2)),
    headingLevel3Font: String(params.headingLevel3Font || "楷体").trim() || "楷体",
    headingLevel3HalfPt: String(Math.round((Number(params.headingLevel3SizePt) || 16) * 2)),
  };
}

function mmToTwip(value) {
  return Math.round((Number(value) || 0) * 56.7);
}

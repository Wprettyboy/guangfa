import { collectParagraphs, getWordAttr, getWordChild, getWordElements, loadDocxXml, parseDocxStyles } from "./wordXml";

export async function auditDocxFormat(buffer, config = {}) {
  const { documentDoc, stylesDoc } = await loadDocxXml(buffer);
  const enabled = normalizeEnabledItems(config.enabled);
  const params = normalizeAuditParams(config.params);
  const styleData = parseDocxStyles(stylesDoc);
  const allParagraphs = collectParagraphs(documentDoc, styleData);
  const paragraphs = allParagraphs.filter((item) => item.text);
  const tables = getWordElements(documentDoc, "tbl");
  const issues = [
    createOutlineEvidenceIssue(paragraphs),
    createSectionEvidenceIssue(documentDoc),
    enabled.has("page-margin") ? createSectionNormalizeIssue(documentDoc, params) : null,
    enabled.has("body-font") ? createBodyFontIssue(paragraphs, params) : null,
    enabled.has("body-size") ? createBodySizeIssue(paragraphs, params) : null,
    enabled.has("first-line-indent") ? createFirstLineIndentIssue(paragraphs, params) : null,
    enabled.has("line-spacing") ? createLineSpacingIssue(paragraphs, params) : null,
    enabled.has("paragraph-spacing") ? createParagraphSpacingIssue(paragraphs, params) : null,
    enabled.has("blank-lines") ? createBlankLinesIssue(allParagraphs) : null,
    enabled.has("body-outline") ? createBodyOutlineIssue(paragraphs) : null,
    enabled.has("missing-heading-style") ? createMissingHeadingStyleIssue(paragraphs, styleData) : null,
    enabled.has("heading-level") ? createHeadingLevelIssue(paragraphs, styleData) : null,
    enabled.has("heading-visual-style") ? createHeadingVisualStyleIssue(paragraphs, params) : null,
    enabled.has("split-heading") ? createSplitHeadingIssue(paragraphs) : null,
    enabled.has("word-outline") ? createWordOutlineIssue(paragraphs, styleData) : null,
    enabled.has("toc-items") ? createTocItemsIssue(allParagraphs, paragraphs) : null,
  ].filter(Boolean);

  const layerCounts = issues.reduce((counts, issue) => {
    counts[issue.layer] = (counts[issue.layer] || 0) + 1;
    return counts;
  }, {});

  return {
    stats: {
      paragraphCount: paragraphs.length,
      headingCount: paragraphs.filter((item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 8).length,
      tableCount: tables.length,
      issueCount: issues.filter((issue) => issue.layer !== "evidence").reduce((sum, issue) => sum + issue.count, 0),
      layerCounts,
    },
    issues,
  };
}

function collectSections(documentDoc) {
  return getWordElements(documentDoc, "sectPr")
    .map((section, index) => {
      const pageSize = getWordChild(section, "pgSz");
      const margin = getWordChild(section, "pgMar");
      const target = {
        index,
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
      target.signature = [
        target.width,
        target.height,
        target.orient,
        target.top,
        target.right,
        target.bottom,
        target.left,
        target.header,
        target.footer,
        target.gutter,
      ].join("/");
      target.text = `节 ${index + 1}: ${target.signature}`;
      return target;
    })
    .filter((item) => item.signature.replaceAll("/", ""));
}

function createOutlineEvidenceIssue(paragraphs) {
  const targets = paragraphs
    .filter((item) => Number.isInteger(item.directOutlineLevel) || (Number.isInteger(item.level) && item.level >= 0 && item.level <= 8))
    .map((item) => ({
      index: item.index,
      text: item.text,
      level: item.level,
      directOutlineLevel: item.directOutlineLevel,
      styleName: item.styleName,
    }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "outline-evidence",
    layer: "evidence",
    category: "标题层级",
    title: "Word 大纲/标题证据",
    severity: "low",
    description: "列出会进入 Word 导航窗格或目录判断的段落，作为后续修复依据。",
    fixable: false,
    count: targets.length,
    targets,
  });
}

function createSectionEvidenceIssue(documentDoc) {
  const targets = collectSections(documentDoc);
  const uniqueSignatures = new Set(targets.map((item) => item.signature));
  if (targets.length <= 1 || uniqueSignatures.size <= 1) return null;

  return makeIssue({
    id: "section-evidence",
    layer: "evidence",
    category: "页面设置",
    title: "节页面设置不一致",
    severity: "medium",
    description: "检测到多个节的纸张或页边距不一致；通用流程只提示，避免误改横向页或特殊表格页。",
    fixable: false,
    count: targets.length,
    targets,
  });
}

function createSectionNormalizeIssue(documentDoc, params) {
  const targets = collectSections(documentDoc);
  const uniqueSignatures = new Set(targets.map((item) => item.signature));
  const badMargins = targets.filter((item) => !hasConfiguredMargins(item, params));
  const issueTargets = badMargins.length > 0 ? badMargins : targets;
  if (badMargins.length === 0 && (targets.length <= 1 || uniqueSignatures.size <= 1)) return null;

  return makeIssue({
    id: "section-normalize",
    layer: "manual",
    category: "页面设置",
    title: "统一节页面设置",
    severity: "medium",
    description: "将所有节统一为文档中最常见的纸张和页边距设置；适合普通正文文档，横向表格页需先人工确认。",
    action: "normalizeSections",
    count: issueTargets.length,
    targets: issueTargets,
    reviewRequired: true,
  });
}

function createBodyFontIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => isBodyFormatTarget(item) && !hasBodyFont(item, params.bodyFont))
    .slice(0, 300)
    .map((item) => ({ index: item.index, text: item.text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "body-font-format",
    layer: "safe",
    category: "基础文字",
    title: "正文字体不统一",
    severity: "low",
    description: `将正文统一为 ${params.bodyFont}。`,
    action: "normalizeBodyFonts",
    count: targets.length,
    targets,
  });
}

function createBodySizeIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => isBodyFormatTarget(item) && !hasBodySize(item, params.bodySizeHalfPt))
    .slice(0, 300)
    .map((item) => ({ index: item.index, text: item.text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "body-size-format",
    layer: "safe",
    category: "基础文字",
    title: "正文字号不统一",
    severity: "low",
    description: `将正文字号统一为 ${params.bodyFontSizePt} pt。`,
    action: "normalizeBodySizes",
    count: targets.length,
    targets,
  });
}

function createBodyOutlineIssue(paragraphs) {
  const targets = paragraphs
    .filter((item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 8 && isBodyLikeHeading(item.text))
    .map((item) => ({ index: item.index, text: item.text, level: item.level, styleName: item.styleName }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "body-outline",
    layer: "safe",
    category: "标题层级",
    title: "正文段落被识别为标题",
    severity: "high",
    description: "这些段落带有标题样式或大纲级别，容易进入 Word 导航窗格和前端大纲。",
    action: "demoteBodyOutline",
    count: targets.length,
    targets,
    defaultSelected: true,
  });
}

function createMissingHeadingStyleIssue(paragraphs, styleData) {
  const targets = paragraphs
    .filter((item) => !Number.isInteger(item.level) && !item.inTable && !isTocParagraph(item))
    .map((item) => ({ ...item, expectedLevel: inferHeadingLevel(item.text) }))
    .filter((item) => Number.isInteger(item.expectedLevel) && styleData.headingStyleIds.has(item.expectedLevel))
    .map((item) => ({ index: item.index, text: item.text, level: item.expectedLevel }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "missing-heading-style",
    layer: "manual",
    category: "标题层级",
    title: "疑似标题未使用 Word 标题样式",
    severity: "medium",
    description: "这些段落看起来像章节标题，但没有进入 Word 大纲层级。",
    action: "applyHeadingStyles",
    count: targets.length,
    targets,
    defaultSelected: false,
    reviewRequired: true,
  });
}

function createSplitHeadingIssue(paragraphs) {
  const targets = [];
  for (let index = 0; index < paragraphs.length - 1; index += 1) {
    const current = paragraphs[index];
    const next = paragraphs[index + 1];
    if (!Number.isInteger(current.level) || current.level !== next.level || current.inTable || next.inTable) continue;
    if (!looksLikeSplitHeading(current.text, next.text)) continue;
    targets.push({ index: current.index, nextIndex: next.index, text: `${current.text} / ${next.text}`, level: current.level });
  }
  if (targets.length === 0) return null;

  return makeIssue({
    id: "split-heading",
    layer: "manual",
    category: "标题层级",
    title: "疑似标题被拆成两段",
    severity: "medium",
    description: "相邻标题段落可能是一个标题被断开；勾选后会合并为一个标题段落。",
    action: "mergeSplitHeadings",
    count: targets.length,
    targets,
    reviewRequired: true,
  });
}

function createFirstLineIndentIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => isBodyFormatTarget(item) && !hasFirstLineIndent(item, params))
    .slice(0, 300)
    .map((item) => ({ index: item.index, text: item.text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "first-line-indent-format",
    layer: "safe",
    category: "段落格式",
    title: "正文首行缩进不统一",
    severity: "low",
    description: `将正文首行缩进统一为 ${params.firstLineChars} 字符。`,
    action: "normalizeFirstLineIndent",
    count: targets.length,
    targets,
  });
}

function createLineSpacingIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => isBodyFormatTarget(item) && !hasLineSpacing(item, params))
    .slice(0, 300)
    .map((item) => ({ index: item.index, text: item.text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "line-spacing-format",
    layer: "safe",
    category: "段落格式",
    title: "正文行距不统一",
    severity: "low",
    description: `将正文行距统一为 ${params.lineSpacing} 倍。`,
    action: "normalizeLineSpacing",
    count: targets.length,
    targets,
  });
}

function createParagraphSpacingIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => isBodyFormatTarget(item) && !hasParagraphSpacing(item, params))
    .slice(0, 300)
    .map((item) => ({ index: item.index, text: item.text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "paragraph-spacing-format",
    layer: "safe",
    category: "段落格式",
    title: "正文段前段后不统一",
    severity: "low",
    description: `将正文段前统一为 ${params.paragraphBeforePt} pt，段后统一为 ${params.paragraphAfterPt} pt。`,
    action: "normalizeParagraphSpacing",
    count: targets.length,
    targets,
  });
}

function createBlankLinesIssue(paragraphs) {
  const targets = [];
  let blankRun = 0;
  paragraphs.forEach((item) => {
    if (item.inTable || item.text) {
      blankRun = 0;
      return;
    }
    blankRun += 1;
    if (blankRun > 1) targets.push({ index: item.index, text: `连续空行第 ${blankRun} 行` });
  });
  if (targets.length === 0) return null;

  return makeIssue({
    id: "blank-lines-format",
    layer: "safe",
    category: "段落格式",
    title: "存在连续空行",
    severity: "low",
    description: "删除连续空行中多余的空白段落，保留单个空行。",
    action: "removeExtraBlankLines",
    count: targets.length,
    targets,
  });
}

function createHeadingLevelIssue(paragraphs, styleData) {
  const targets = paragraphs
    .map((item) => ({ ...item, expectedLevel: inferHeadingLevel(item.text) }))
    .filter((item) => Number.isInteger(item.expectedLevel) && Number.isInteger(item.level) && item.level !== item.expectedLevel && styleData.headingStyleIds.has(item.expectedLevel))
    .map((item) => ({ index: item.index, text: item.text, level: item.expectedLevel, currentLevel: item.level }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "heading-level-format",
    layer: "manual",
    category: "标题体系",
    title: "标题层级疑似错级",
    severity: "medium",
    description: "按标题编号规则修正 Word 标题层级。",
    action: "normalizeHeadingLevels",
    count: targets.length,
    targets,
    reviewRequired: true,
  });
}

function createHeadingVisualStyleIssue(paragraphs, params) {
  const targets = paragraphs
    .filter((item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 2 && !item.inTable && !isBodyLikeHeading(item.text) && !hasHeadingVisualStyle(item, params))
    .map((item) => ({ index: item.index, text: item.text, level: item.level }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "heading-visual-style-format",
    layer: "safe",
    category: "标题体系",
    title: "标题字体字号不规范",
    severity: "low",
    description: "按配置统一一、二、三级标题字体、字号和加粗样式。",
    action: "normalizeHeadingVisualStyles",
    count: targets.length,
    targets,
  });
}

function createWordOutlineIssue(paragraphs, styleData) {
  const targets = paragraphs
    .map((item) => ({ ...item, expectedLevel: inferHeadingLevel(item.text) }))
    .filter((item) => {
      if (Number.isInteger(item.level) && item.level >= 0 && item.level <= 8 && isBodyLikeHeading(item.text)) return true;
      if (Number.isInteger(item.expectedLevel) && item.level !== item.expectedLevel && styleData.headingStyleIds.has(item.expectedLevel)) return true;
      return false;
    })
    .map((item) => ({ index: item.index, text: item.text, level: item.expectedLevel, currentLevel: item.level }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "word-outline-format",
    layer: "manual",
    category: "目录大纲",
    title: "Word 大纲内容不准确",
    severity: "medium",
    description: "同步 Word 导航窗格：正文退出大纲，疑似标题进入正确标题层级。",
    action: "normalizeWordOutline",
    count: targets.length,
    targets,
    reviewRequired: true,
  });
}

function createTocItemsIssue(allParagraphs, paragraphs) {
  const tocTargets = allParagraphs.filter((item) => isTocParagraph(item));
  const headingCount = paragraphs.filter((item) => Number.isInteger(item.level) && item.level >= 0 && item.level <= 8 && !isBodyLikeHeading(item.text)).length;
  if (tocTargets.length === 0 || headingCount === tocTargets.length) return null;

  return makeIssue({
    id: "toc-items-format",
    layer: "safe",
    category: "目录大纲",
    title: "目录项可能未更新",
    severity: "low",
    description: "按当前 Word 标题大纲重建普通目录项；页码会尽量沿用已有目录页码，最终页码仍建议在 Word 中刷新确认。",
    action: "markTocDirty",
    count: tocTargets.length,
    targets: tocTargets.map((item) => ({ index: item.index, text: item.text || "目录项" })),
  });
}

function createTableFormatIssue(tables) {
  const targets = tables
    .map((table, index) => ({ table, index, text: `表格 ${index + 1}` }))
    .filter((item) => !hasNormalizedTableFormat(item.table))
    .map(({ index, text }) => ({ index, text }));
  if (targets.length === 0) return null;

  return makeIssue({
    id: "table-basic-format",
    layer: "safe",
    category: "表格格式",
    title: "表格可统一基础边框和单元格边距",
    severity: "low",
    description: "对表格补齐单线边框、单元格边距和垂直居中；复杂表格建议人工复核。",
    action: "normalizeTables",
    count: targets.length,
    targets,
    defaultSelected: false,
  });
}

function makeIssue(issue) {
  return {
    fixable: true,
    layer: "safe",
    reviewRequired: false,
    defaultSelected: false,
    samples: issue.targets.slice(0, 5).map((target) => target.text),
    ...issue,
  };
}

function isBodyLikeHeading(text) {
  const value = normalizeText(text);
  if (/^[一二三四五六七八九十]+、.+[：:。；;]$/.test(value)) return true;
  if (/^\d+[.．、].+[：:。；;]$/.test(value)) return true;
  if (value.length > 70) return true;
  if (value.length > 42 && /[，,。；;：:]/.test(value)) return true;
  if (/[。；;]$/.test(value)) return true;
  return false;
}

function isBodyParagraph(text) {
  const value = normalizeText(text);
  if (value.length < 12) return false;
  if (inferHeadingLevel(value) !== null) return false;
  return /[，,。；;：:]/.test(value) || value.length > 28;
}

function isBodyFormatTarget(item) {
  return !Number.isInteger(item.level) && !item.inTable && !isTocParagraph(item) && isBodyParagraph(item.text);
}

function hasFirstLineIndent(item, params) {
  const ind = getWordChild(getWordChild(item.paragraph, "pPr"), "ind");
  return getWordAttr(ind, "firstLine") === params.firstLineTwip;
}

function hasLineSpacing(item, params) {
  const spacing = getWordChild(getWordChild(item.paragraph, "pPr"), "spacing");
  return getWordAttr(spacing, "line") === params.lineSpacingTwip && getWordAttr(spacing, "lineRule") === "auto";
}

function hasParagraphSpacing(item, params) {
  const spacing = getWordChild(getWordChild(item.paragraph, "pPr"), "spacing");
  return getWordAttr(spacing, "before") === params.paragraphBeforeTwip && getWordAttr(spacing, "after") === params.paragraphAfterTwip;
}

function hasBodyFont(item, fontName) {
  const runs = getTextRuns(item.paragraph);
  if (runs.length === 0) return true;
  return runs.every((run) => {
    const rPr = getWordChild(run, "rPr");
    const fonts = getWordChild(rPr, "rFonts");
    return [getWordAttr(fonts, "eastAsia"), getWordAttr(fonts, "ascii"), getWordAttr(fonts, "hAnsi")].filter(Boolean).every((font) => font === fontName);
  }) && runs.every((run) => !getWordChild(getWordChild(run, "rPr"), "b") && !getWordChild(getWordChild(run, "rPr"), "bCs"));
}

function hasBodySize(item, halfPt) {
  const runs = getTextRuns(item.paragraph);
  if (runs.length === 0) return true;
  return runs.every((run) => {
    const rPr = getWordChild(run, "rPr");
    return getWordAttr(getWordChild(rPr, "sz"), "val") === halfPt && getWordAttr(getWordChild(rPr, "szCs"), "val") === halfPt;
  });
}

function hasHeadingVisualStyle(item, params) {
  const halfPt = item.level === 0 ? params.headingLevel1HalfPt : item.level === 1 ? params.headingLevel2HalfPt : params.headingLevel3HalfPt;
  const fontName = item.level === 0 ? params.headingLevel1Font : item.level === 1 ? params.headingLevel2Font : params.headingLevel3Font;
  const runs = getTextRuns(item.paragraph);
  if (runs.length === 0) return true;
  return runs.every((run) => {
    const rPr = getWordChild(run, "rPr");
    const fonts = getWordChild(rPr, "rFonts");
    return (
      [getWordAttr(fonts, "eastAsia"), getWordAttr(fonts, "ascii"), getWordAttr(fonts, "hAnsi")].filter(Boolean).every((font) => font === fontName) &&
      getWordAttr(getWordChild(rPr, "sz"), "val") === halfPt &&
      getWordAttr(getWordChild(rPr, "szCs"), "val") === halfPt &&
      getWordChild(rPr, "b")
    );
  });
}

function hasNormalizedTableFormat(table) {
  const tblPr = getWordChild(table, "tblPr");
  const borders = getWordChild(tblPr, "tblBorders");
  const hasBorders = ["top", "left", "bottom", "right", "insideH", "insideV"].every((name) => {
    const border = getWordChild(borders, name);
    return getWordAttr(border, "val") === "single" && getWordAttr(border, "sz") === "4";
  });
  const cellMar = getWordChild(tblPr, "tblCellMar");
  const hasMargins = ["top", "left", "bottom", "right"].every((name) => getWordAttr(getWordChild(cellMar, name), "w") === "80");
  const cells = getWordElements(table, "tc");
  const hasVerticalAlign = cells.every((cell) => getWordAttr(getWordChild(getWordChild(cell, "tcPr"), "vAlign"), "val") === "center");
  return hasBorders && hasMargins && hasVerticalAlign;
}

function getTextRuns(paragraph) {
  return getWordElements(paragraph, "r").filter((run) => getWordElements(run, "t").some((text) => text.textContent?.trim()));
}

function inferHeadingLevel(text) {
  const value = normalizeText(text).replace(/^[□☐○〇▢]+/, "");
  if (!value || value.length > 60 || /[，,。；;：:]/.test(value)) return null;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]\s*\S{0,36}$/.test(value)) return 0;
  if (/^[一二三四五六七八九十]+、\S{1,28}$/.test(value)) return 1;
  if (/^\d+[.．、]\S{1,32}$/.test(value)) return 2;
  return null;
}

function looksLikeSplitHeading(current, next) {
  const left = normalizeText(current);
  const right = normalizeText(next);
  if (!left || !right || left.length > 36 || right.length > 18) return false;
  if (/[，,。；;：:]$/.test(left) || /[，,。；;：:]$/.test(right)) return false;
  return /[的与和及、]$/.test(left) || /^[和与及、]/.test(right);
}

function isTocParagraph(item) {
  return /^toc\b/i.test(item.styleName || "") || /^TOC/i.test(item.styleId || "");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAuditParams(params = {}) {
  const bodyFontSizePt = Number(params.bodyFontSizePt) || 16;
  const headingLevel1SizePt = Number(params.headingLevel1SizePt) || 22;
  const headingLevel2SizePt = Number(params.headingLevel2SizePt) || 16;
  const headingLevel3SizePt = Number(params.headingLevel3SizePt) || 16;
  return {
    pageMarginTopTwip: mmToTwip(params.pageMarginTopMm ?? 37),
    pageMarginRightTwip: mmToTwip(params.pageMarginRightMm ?? 26),
    pageMarginBottomTwip: mmToTwip(params.pageMarginBottomMm ?? 35),
    pageMarginLeftTwip: mmToTwip(params.pageMarginLeftMm ?? 28),
    bodyFont: String(params.bodyFont || "仿宋").trim() || "仿宋",
    bodyFontSizePt,
    firstLineChars: Number(params.firstLineChars) || 2,
    lineSpacing: Number(params.lineSpacing) || 1.5,
    paragraphBeforePt: Number(params.paragraphBeforePt) || 0,
    paragraphAfterPt: Number(params.paragraphAfterPt) || 0,
    bodySizeHalfPt: String(Math.round(bodyFontSizePt * 2)),
    firstLineTwip: String(Math.round((Number(params.firstLineChars) || 2) * 210)),
    lineSpacingTwip: String(Math.round((Number(params.lineSpacing) || 1.5) * 240)),
    paragraphBeforeTwip: String(Math.round((Number(params.paragraphBeforePt) || 0) * 20)),
    paragraphAfterTwip: String(Math.round((Number(params.paragraphAfterPt) || 0) * 20)),
    headingLevel1Font: String(params.headingLevel1Font || "小标宋").trim() || "小标宋",
    headingLevel1HalfPt: String(Math.round(headingLevel1SizePt * 2)),
    headingLevel2Font: String(params.headingLevel2Font || "黑体").trim() || "黑体",
    headingLevel2HalfPt: String(Math.round(headingLevel2SizePt * 2)),
    headingLevel3Font: String(params.headingLevel3Font || "楷体").trim() || "楷体",
    headingLevel3HalfPt: String(Math.round(headingLevel3SizePt * 2)),
  };
}

function normalizeEnabledItems(enabled) {
  const defaults = [
    "page-margin",
    "body-font",
    "body-size",
    "first-line-indent",
    "line-spacing",
    "paragraph-spacing",
    "blank-lines",
    "body-outline",
    "missing-heading-style",
    "heading-level",
    "heading-visual-style",
    "split-heading",
    "word-outline",
    "toc-items",
  ];
  const values = Array.isArray(enabled) ? enabled : defaults;
  return new Set(values.length > 0 ? values : defaults);
}

function hasConfiguredMargins(section, params) {
  const tolerance = mmToTwip(1);
  return (
    nearTwip(section.top, params.pageMarginTopTwip, tolerance) &&
    nearTwip(section.right, params.pageMarginRightTwip, tolerance) &&
    nearTwip(section.bottom, params.pageMarginBottomTwip, tolerance) &&
    nearTwip(section.left, params.pageMarginLeftTwip, tolerance)
  );
}

function nearTwip(value, target, tolerance) {
  return Math.abs((Number(value) || 0) - target) <= tolerance;
}

function mmToTwip(value) {
  return Math.round((Number(value) || 0) * 56.7);
}

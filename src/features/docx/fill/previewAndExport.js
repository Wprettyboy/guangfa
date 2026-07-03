import JSZip from "jszip";

import { buildExportFileName, downloadDocxBuffer } from "../../../utils/files.js";

import { getTemplateFieldSourceText, hasFillBlank, normalizeFillMode } from "../../../utils/fields.js";

import {
  buildDateSegmentReplacement,
  collectChoiceKeywordsFromText,
  dateSegmentNeedsTime,
  getDateSegmentBlankPattern,
  getFieldAmountValue,
  getFieldChoiceValue,
  getFillBookmarkName,
  isDateField,
  normalizeChoiceText,
  parseDateParts,
} from "./helpers.js";

import {
  normalizeAnnotationText,
  resolveNodePath,
  splitAnnotationContextTokens,
} from "../annotate/markers.js";

import { clampNumber, getPreviewPageElement } from "../preview/pageLayout.js";
function applyFillPreviewValues(container, fields) {
  if (!container) return;
  container.querySelectorAll("[data-fill-original-html]").forEach((node) => {
    node.innerHTML = node.dataset.fillOriginalHtml || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalHtml;
  });
  container.querySelectorAll("[data-fill-original-text]").forEach((node) => {
    node.textContent = node.dataset.fillOriginalText || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalText;
  });
  container.querySelectorAll(".docx-replaced-source").forEach((node) => {
    node.classList.remove("docx-replaced-source");
    delete node.dataset.replacedByField;
  });
  container.querySelectorAll(".docx-choice-selected").forEach((node) => {
    node.classList.remove("docx-choice-selected");
    collectTextNodes(node).forEach((textNode) => {
      textNode.textContent = (textNode.textContent || "").replace(/[☑✓✔]/g, "□");
    });
  });
  container.normalize?.();

  fields.forEach((field) => {
    if (!field.name || !field.value) return;
    if (field.type === "单选项" && applySectionLeadFillValue(container, field)) return;

    if (field.type === "单选项") {
      const choiceScope = getPreviewPageElement(container, field.page || 1) || container;
      const choiceTarget = findChoiceTarget(choiceScope, field);
      if (choiceTarget) {
        markChoiceTarget(choiceTarget);
        if (!shouldContinueFillAfterChoice(field)) return;
        if (applyAmountUnitFillValue(choiceTarget.element ?? choiceTarget, field)) return;
      }
    }

    if (isDateField(field) && applyDateSegmentFillValue(container, field)) return;
    if (applyAmountUnitFillValue(container, field)) return;
    if (applyMarkerFillValue(container, field)) return;
    if (applyContextualFillValue(container, field)) return;
    if (applyTemplateContextBlankFillValue(container, field)) return;

    const target = findFillTarget(container, field.name);
    if (!target) return;
    applyLabelFillValue(target, field);
  });
}

function applyDateSegmentFillValue(container, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const scope = getPreviewPageElement(container, field.marker?.page || field.page || 1) || container;
  const markerTarget = field.marker ? findMarkerFillTarget(scope, field.marker) : null;
  if (markerTarget && replaceDateSegmentInTarget(markerTarget, field, parts)) return true;

  const candidates = getScopedCandidateNodes(scope, "p, td, li, div")
    .map((node) => {
      const text = node.textContent || "";
      if (text.length > 260 || !hasDateSegmentBlank(text)) return null;
      return { node, score: scoreDateSegmentCandidate(text, field), length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (replaceDateSegmentInTarget(candidate.node, field, parts)) return true;
  }
  return false;
}

function replaceDateSegmentInTarget(target, field, parts) {
  const text = target.textContent || "";
  const match = getDateSegmentBlankPattern().exec(text);
  if (!match) return false;
  const replacement = buildDateSegmentReplacement(match[0], parts);
  if (!replacement) return true;

  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(text.slice(0, match.index)));
  appendDateFillPart(target, field, parts.year);
  target.append(document.createTextNode("年"));
  appendDateFillPart(target, field, parts.month);
  target.append(document.createTextNode("月"));
  appendDateFillPart(target, field, parts.day);
  target.append(document.createTextNode("日"));
  if (dateSegmentNeedsTime(match[0])) {
    appendDateFillPart(target, field, parts.hour);
    target.append(document.createTextNode("时"));
    appendDateFillPart(target, field, parts.minute);
    target.append(document.createTextNode("分"));
  }
  target.append(document.createTextNode(text.slice(match.index + match[0].length)));
  target.classList.add("docx-fill-mutated");
  return true;
}

function appendDateFillPart(target, field, value) {
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value date-piece";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = value;
  target.append(valueNode);
}

function scoreDateSegmentCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const context = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 5;
  if (normalizedText.includes("日期") || normalizedText.includes("年月日")) score += 8;
  if (context.includes("日期") || context.includes("年月日")) score += 6;
  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 5;
  });
  return score;
}

function applyAmountUnitFillValue(container, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return false;

  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = getScopedCandidateNodes(scope, "td, p, li, div")
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length > 1200 || !/(金额|限价|报价|费用)[^。；;]{0,80}[：:]\s*(元|万元)/.test(text)) return null;
      const score = scoreAmountUnitCandidate(text, field);
      return { node, score, length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function getScopedCandidateNodes(scope, selector) {
  if (!scope) return [];
  const nodes = [...scope.querySelectorAll(selector)];
  if (scope.matches?.(selector)) nodes.unshift(scope);
  return nodes;
}

function scoreAmountUnitCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const normalizedContext = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 0;

  ["询比保证金", "投标保证金", "最高限价", "采购控制价", "安全文明施工费", "规费", "专业工程暂估价", "暂列金额"].forEach((label) => {
    const normalizedLabel = normalizeAnnotationText(label);
    if (normalizedContext.includes(normalizedLabel) && normalizedText.includes(normalizedLabel)) score += 50;
  });

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  if (/金额[^。；;]{0,20}[：:]\s*(元|万元)/.test(text)) score += 8;
  return score;
}

function applyMarkerFillValue(container, field) {
  const marker = field.marker;
  if (!container || !marker) return false;
  const page = getPreviewPageElement(container, marker.page || field.page || 1) || container;
  const target = findMarkerFillTarget(page, marker);
  if (!target) return false;

  if (field.type === "单选项") {
    const choiceTarget = findChoiceTarget(target, field);
    if (choiceTarget) {
      markChoiceTarget(choiceTarget);
      if (!shouldContinueFillAfterChoice(field)) return true;
    }
  }

  if (applyFirstBlankFillValue(target, field)) return true;
  if (marker.kind === "range") return applyMarkerRangeFillValue(page, marker, field);
  return false;
}

function shouldContinueFillAfterChoice(field) {
  const context = `${field.answerFormat || ""} ${field.question || ""}`;
  const value = getFieldAmountValue(field);
  return hasFillBlank(context) || /金额|限价|费用|报价|%|％|元|万元/.test(context) || /[0-9]/.test(value);
}

function findMarkerFillTarget(page, marker) {
  if (marker.kind === "range") {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    const startTarget = startNode?.parentElement?.closest?.("p, td, li, div");
    const endTarget = endNode?.parentElement?.closest?.("p, td, li, div");
    if (startTarget && startTarget === endTarget) return startTarget;
    return startTarget?.closest?.("td") || startTarget || endTarget;
  }

  if (marker.kind === "block") {
    const target = resolveNodePath(page, marker.elementPath);
    return target?.closest?.("p, td, li, div") || target;
  }

  return null;
}

function applyTemplateContextBlankFillValue(container, field) {
  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = [...scope.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!hasFillBlank(text) || text.length > 1800) return null;
      if (!isBlankCandidateCompatible(text, field)) return null;
      const score = scoreBlankFillCandidate(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function isBlankCandidateCompatible(text, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (expectsAmountBlank(context, getFieldAmountValue(field))) {
    return /(?:金额|限价|报价|费用)[^。；;]{0,30}[：:]\s*(?:元|万元)/.test(text);
  }
  return true;
}

function scoreBlankFillCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const contexts = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, ""), field.name].filter(Boolean);
  let score = 0;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  const contextTokens = [...new Set(contexts.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  contextTokens.forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(10, token.length);
  });

  if (score > 0 && hasFillBlank(text)) score += 5;
  return score;
}

function applyFirstBlankFillValue(target, field) {
  const text = target.textContent || "";
  const matches = collectBlankMatches(target).filter((item) => isUsefulFillBlank(text, item.match));
  if (matches.length === 0) return false;

  const bestMatch = chooseBestBlankMatch(text, matches, field);
  if (!bestMatch) return false;
  return replaceBlankMatchWithValue(target, bestMatch, field);
}

function applyMarkerRangeFillValue(page, marker, field) {
  const startNode = resolveNodePath(page, marker.startPath);
  const endNode = resolveNodePath(page, marker.endPath);
  if (!startNode || !endNode) return false;
  const target = startNode.parentElement?.closest?.("p, td, li, div");
  if (!target) return false;

  try {
    storeOriginalText(target);
    const range = document.createRange();
    range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
    range.deleteContents();
    const valueNode = document.createElement("span");
    valueNode.className = "docx-fill-value";
    valueNode.dataset.fieldId = field.id;
    valueNode.textContent = field.value;
    range.insertNode(valueNode);
    target.classList.add("docx-fill-mutated");
    return true;
  } catch {
    return false;
  }
}

function isUsefulFillBlank(text, match) {
  const index = match.index ?? 0;
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + match[0].length, index + match[0].length + 18);
  return /[：:（(，,、\u4e00-\u9fa5A-Za-z0-9□☐○〇▢]/.test(before) && /[\u4e00-\u9fa5A-Za-z0-9□☐○〇▢）),，,。；;]/.test(after);
}

function chooseBestBlankMatch(text, matches, field) {
  const compatibleMatches = filterCompatibleBlankMatches(text, matches, field);
  if (compatibleMatches.length === 0) return null;
  if (expectsAmountBlank(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`, getFieldAmountValue(field))) {
    return compatibleMatches[0];
  }
  const tokens = getFieldNameTokens(field.name);
  if (tokens.length === 0) return compatibleMatches[0];

  const ranked = compatibleMatches
    .map((item) => {
      const index = item.match.index ?? 0;
      const tokenDistances = tokens.map((token) => {
        const tokenIndex = text.lastIndexOf(token, index);
        return tokenIndex >= 0 ? index - tokenIndex : Number.POSITIVE_INFINITY;
      });
      const distance = Math.min(...tokenDistances);
      const labelScore = scoreBlankLocalLabel(text, index, field);
      return { item, distance, labelScore };
    })
    .sort((a, b) => b.labelScore - a.labelScore || a.distance - b.distance);

  const best = ranked[0];
  if (!best || (best.labelScore === 0 && !Number.isFinite(best.distance))) return null;
  return best.item;
}

function filterCompatibleBlankMatches(text, matches, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return matches;

  return matches.filter((item) => {
    const index = item.match.index ?? 0;
    const before = text.slice(Math.max(0, index - 42), index);
    const after = text.slice(index + item.match[0].length, index + item.match[0].length + 12);
    return /金额|限价|报价|费用/.test(before) && /元|万元/.test(after);
  });
}

function expectsAmountBlank(context, value) {
  return /金额|报价|费用|元|万元/.test(`${context || ""} ${value || ""}`) && /[0-9]/.test(String(value || ""));
}

function collectBlankMatches(target) {
  const items = [];
  let baseIndex = 0;
  collectTextNodes(target).forEach((node) => {
    const text = node.textContent || "";
    [...text.matchAll(/[_＿—-]{2,}|\s{2,}|(?<=[：:])\s+(?=元|万元|%|％|日历天|分钟|天)|(?<=的)\s+(?=%|％)/g)].forEach((match) => {
      items.push({
        node,
        localIndex: match.index ?? 0,
        match: {
          ...match,
          index: baseIndex + (match.index ?? 0),
          0: match[0],
        },
      });
    });
    baseIndex += text.length;
  });
  return items;
}

function replaceBlankMatchWithValue(target, item, field) {
  const { node, localIndex, match } = item;
  const text = node.textContent || "";
  if (!text || localIndex < 0) return false;
  storeOriginalHtml(target);
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = getBlankPreviewValue(field, target.textContent || "", match.index ?? 0);

  const afterNode = node.splitText(localIndex);
  afterNode.textContent = afterNode.textContent.slice(match[0].length);
  afterNode.parentNode?.insertBefore(valueNode, afterNode);
  target.classList.add("docx-fill-mutated");
  return true;
}

function getBlankPreviewValue(field, fullText, blankIndex) {
  const value = getFieldAmountValue(field);
  const before = fullText.slice(Math.max(0, blankIndex - 42), blankIndex);
  const label = before.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]+)\s*[：:]?\s*$/)?.[1] || "";
  if (!label || !value) return value;

  const normalizedLabel = normalizeAnnotationText(label);
  if (normalizedLabel.includes("金额") || normalizedLabel.includes("报价") || normalizedLabel.includes("费用") || normalizedLabel.includes("限价")) {
    const labelledAmount = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]?\\s*([^，,；;。\\s元]+)`));
    if (labelledAmount?.[1]) return labelledAmount[1].trim();
    const amount = value.match(/(?:人民币)?\s*([0-9][0-9,，.]*)\s*(?:万?元)?/);
    if (amount?.[1]) return amount[1].replace(/，/g, ",");
  }

  const labelledValue = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]\\s*([^，,；;。]+)`));
  if (labelledValue?.[1]) return labelledValue[1].trim();
  return value;
}

function scoreBlankLocalLabel(text, index, field) {
  const before = text.slice(Math.max(0, index - 36), index);
  const normalizedBefore = normalizeAnnotationText(before);
  return getFieldNameTokens(field.name).reduce((score, token) => {
    return normalizedBefore.includes(normalizeAnnotationText(token)) ? score + token.length : score;
  }, 0);
}

function getFieldNameTokens(name = "") {
  return String(name)
    .split(/[\s/／|｜,，、:：()（）]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(-4);
}

function applyLabelFillValue(target, field) {
  const text = target.textContent || "";
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const match = pattern.exec(text);
  if (!match) return false;

  replaceTargetTextWithValue({
    target,
    field,
    beforeValue: text.slice(0, match.index) + match[1],
    afterValue: text.slice(match.index + match[0].length),
  });
  return true;
}

function applyContextualFillValue(container, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const target = findContextualFillTarget(container, descriptor);
    if (!target) continue;
    const match = descriptor.pattern.exec(target.textContent || "");
    if (!match) continue;
    replaceTargetTextWithValue({
      target,
      field,
      beforeValue: target.textContent.slice(0, match.index) + match[1],
      afterValue: target.textContent.slice(match.index + match[0].length),
    });
    return true;
  }
  return false;
}

function applySectionLeadFillValue(container, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadDomTarget(container, sectionLabel, field);
  if (!target) return false;

  storeOriginalText(target);
  replaceTargetTextWithValue({
    target,
    field: { ...field, value: getSectionAnswerValue(field, sectionLabel) },
    beforeValue: `${sectionLabel}：`,
    afterValue: "",
    lead: true,
  });

  getSectionReplacementSourceNodes(target, sectionLabel).forEach((node) => {
    node.classList.add("docx-replaced-source");
    node.dataset.replacedByField = field.id;
  });
  return true;
}

function getSectionReplacementSourceNodes(target, sectionLabel) {
  const nodes = [];
  let current = target.nextElementSibling;
  while (current) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text) {
      current = current.nextElementSibling;
      continue;
    }
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      nodes.push(current);
    }
    current = current.nextElementSibling;
  }
  return nodes;
}

function findSectionLeadDomTarget(container, sectionLabel, field) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => isSectionLeadParagraph(node.textContent || "", sectionLabel))
    .map((node) => ({
      node,
      score: scoreSectionLeadCandidate(
        [node.textContent || "", ...getSectionFollowingDomTexts(node, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || (a.node.textContent?.length || 0) - (b.node.textContent?.length || 0))[0]?.node || null;
}

function getSectionFollowingDomTexts(target, sectionLabel) {
  const texts = [];
  let current = target.nextElementSibling;
  while (current && texts.length < 4) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
    current = current.nextElementSibling;
  }
  return texts;
}

function isNextSectionLead(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  if (!/^\d+[.、]/.test(text.trim())) return false;
  return !normalizedText.startsWith(normalizedLabel);
}

function isSectionNoRequirementOption(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return /^无.{0,12}要求/.test(normalizedText) && normalizedLabel.includes("要求");
}

function isSectionTemplateOptionParagraph(text, sectionLabel) {
  const trimmedText = String(text || "").trim();
  return /^[□☐○〇▢]/.test(trimmedText) || isSectionNoRequirementOption(trimmedText, sectionLabel);
}

function isSectionReplacementChoiceField(field) {
  return field.type === "单选项" && normalizeFillMode(field.fillMode, field) === "choice-replace" && Boolean(resolveSectionLeadLabel(field)) && shouldReplaceSectionWithAnswer(field);
}

function getSectionAnswerValue(field, sectionLabel) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  const label = normalizeChoiceText(sectionLabel).replace(/^\d+/, "");
  return value.replace(new RegExp(`^\\s*(?:\\d+[.、]\\s*)?${escapeRegExp(label)}\\s*[：:]?\\s*`), "").trim() || value;
}

function shouldReplaceSectionWithAnswer(field) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  if (/^无.{0,12}要求/.test(normalizeChoiceText(value))) return false;
  if (normalizeFillMode(field.fillMode, field) === "choice-replace") return true;
  if (value.length < 60) return false;
  return /[。；;，,]/.test(value) || value.length >= 90;
}

function scoreSectionLeadCandidate(candidateText, field, sectionLabel) {
  const candidate = normalizeChoiceText(candidateText);
  const format = normalizeChoiceText(field.answerFormat || "");
  const name = normalizeChoiceText(field.name || "");
  let score = 0;

  if (candidate.includes(normalizeChoiceText(sectionLabel))) score += 10;
  if (name && candidate.includes(name)) score += 6;
  if (!format) return score;

  const tokens = createSectionMatchTokens(format);
  tokens.forEach((token) => {
    if (candidate.includes(token)) score += Math.min(12, token.length);
  });
  return score;
}

function createSectionMatchTokens(text) {
  return [...new Set(String(text || "").split(/[□☐○〇▢_＿—\-]+/))]
    .map((item) => normalizeChoiceText(item))
    .filter((item) => item.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function getContextualFillDescriptors(field) {
  const contexts = [field.answerFormat, field.question, field.name]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return contexts
    .map((context) => {
      const quoteMatch = context.match(/^(.*?[“"])\s*([”"].*)$/);
      if (quoteMatch) return createContextualFillDescriptor(quoteMatch[1], quoteMatch[2]);

      const blankMatch = context.match(/^(.*?)(_{2,}|＿+|—+|-{2,}|\s{2,})(.*)$/);
      if (blankMatch) return createContextualFillDescriptor(blankMatch[1], blankMatch[3]);

      const punctBlankMatch = context.match(/^(.*?[：:][^。；;，,）)]*?)\s+([。；;，,）)].*)$/);
      if (punctBlankMatch) return createContextualFillDescriptor(punctBlankMatch[1], punctBlankMatch[2]);

      return null;
    })
    .filter(Boolean);
}

function createContextualFillDescriptor(prefix, suffix) {
  const cleanPrefix = prefix.trimEnd();
  const cleanSuffix = suffix.trimStart();
  if (!cleanPrefix || !cleanSuffix) return null;
  return {
    pattern: new RegExp(`(${escapeFlexibleContext(cleanPrefix)})([_＿—\\-\\s]*)(?=${escapeFlexibleContext(cleanSuffix)})`),
  };
}

function findContextualFillTarget(container, descriptor) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.length <= 240 && descriptor.pattern.test(node.textContent || "");
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))[0] || null;
}

function replaceTargetTextWithValue({ target, field, beforeValue, afterValue }) {
  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(beforeValue));
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = field.value;
  target.append(valueNode);
  target.append(document.createTextNode(afterValue));
  target.classList.add("docx-fill-mutated");
  if (arguments[0]?.lead) {
    target.classList.add("docx-section-fill-lead");
  }
}

function storeOriginalText(target) {
  if (!target.dataset.fillOriginalText) {
    target.dataset.fillOriginalText = target.textContent || "";
  }
}

function storeOriginalHtml(target) {
  if (!target.dataset.fillOriginalHtml && !target.dataset.fillOriginalText) {
    target.dataset.fillOriginalHtml = target.innerHTML || "";
  }
}

async function buildFilledDocxBuffer(templateFile, fields) {
  const filledFields = fields.filter((field) => field.value);
  fillBookmarkId = 50000;
  fillBookmarkNames = new Set();
  const zip = await JSZip.loadAsync(templateFile.buffer.slice(0));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX 缺少 word/document.xml");

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const xmlText = await documentFile.async("text");
  const doc = parser.parseFromString(xmlText, "application/xml");
  const paragraphs = [...doc.getElementsByTagName("w:p")];

  filledFields.forEach((field) => {
    if (applySectionLeadFillToDocxXml(paragraphs, field)) return;
    if (field.type === "单选项") {
      const choiceApplied = applyChoiceToDocxXml(paragraphs, field);
      if (choiceApplied && !shouldContinueFillAfterChoice(field)) return;
    }
    if (isDateField(field) && applyDateSegmentFillToDocxXml(paragraphs, field)) return;
    if (applyContextualFillToDocxXml(paragraphs, field)) return;
    applyLabelFillToDocxXml(paragraphs, field);
  });

  zip.file("word/document.xml", serializer.serializeToString(doc));
  await enableDocxTrackRevisions(zip, parser, serializer);
  return zip.generateAsync({
    type: "arraybuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function exportFilledDocx(templateFile, fields) {
  downloadDocxBuffer(await buildFilledDocxBuffer(templateFile, fields), buildExportFileName(templateFile.name));
}

async function enableDocxTrackRevisions(zip, parser, serializer) {
  const settingsFile = zip.file("word/settings.xml");
  if (!settingsFile) return;
  const settingsDoc = parser.parseFromString(await settingsFile.async("text"), "application/xml");
  const root = settingsDoc.documentElement;
  if (!root || root.getElementsByTagName("w:trackRevisions").length > 0) return;
  root.appendChild(settingsDoc.createElementNS(WORD_NS, "w:trackRevisions"));
  zip.file("word/settings.xml", serializer.serializeToString(settingsDoc));
}

function setXmlParagraphWithFill(paragraph, beforeValue, fillValue, afterValue, field, options = {}) {
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlRun(paragraph, beforeValue);
  appendXmlInsertedRun(paragraph, fillValue, field, options);
  appendXmlRun(paragraph, afterValue);
}

function appendXmlRun(parent, text, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const run = doc.createElementNS(WORD_NS, "w:r");
  const rPr = createXmlRunProperties(doc, options);
  if (rPr) run.appendChild(rPr);
  const textNode = doc.createElementNS(WORD_NS, "w:t");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  parent.appendChild(run);
}

function appendXmlInsertedRun(parent, text, field, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const bookmarkName = getFillBookmarkName(field);
  const shouldBookmark = bookmarkName && !fillBookmarkNames.has(bookmarkName);
  const bookmarkId = shouldBookmark ? fillBookmarkId++ : 0;
  if (shouldBookmark) {
    fillBookmarkNames.add(bookmarkName);
    const start = doc.createElementNS(WORD_NS, "w:bookmarkStart");
    start.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    start.setAttributeNS(WORD_NS, "w:name", bookmarkName);
    parent.appendChild(start);
  }
  const inserted = doc.createElementNS(WORD_NS, "w:ins");
  inserted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  inserted.setAttributeNS(WORD_NS, "w:author", getFillRevisionAuthor(field));
  inserted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  appendXmlRun(inserted, text, options);
  parent.appendChild(inserted);
  if (shouldBookmark) {
    const end = doc.createElementNS(WORD_NS, "w:bookmarkEnd");
    end.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    parent.appendChild(end);
  }
}

function setXmlParagraphDeleted(paragraph) {
  const text = getXmlParagraphText(paragraph);
  if (!text.trim()) return;
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlDeletedRun(paragraph, text);
}

function appendXmlDeletedRun(parent, text) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const deleted = doc.createElementNS(WORD_NS, "w:del");
  deleted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  deleted.setAttributeNS(WORD_NS, "w:author", "AI填充");
  deleted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  const run = doc.createElementNS(WORD_NS, "w:r");
  const textNode = doc.createElementNS(WORD_NS, "w:delText");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  deleted.appendChild(run);
  parent.appendChild(deleted);
}

function createXmlRunProperties(doc, options = {}) {
  if (!options.underline) return null;
  const rPr = doc.createElementNS(WORD_NS, "w:rPr");
  const underline = doc.createElementNS(WORD_NS, "w:u");
  underline.setAttributeNS(WORD_NS, "w:val", "single");
  rPr.appendChild(underline);
  return rPr;
}

function getFillRevisionAuthor(field) {
  return String(field?.source || "").includes("人工") ? "人工填写" : "AI填充";
}

function shouldUnderlineFilledValue(blankText) {
  return /[_＿—\-\s]{2,}/.test(blankText || "");
}

function applyDateSegmentFillToDocxXml(paragraphs, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const candidates = paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => text.length <= 260 && hasDateSegmentBlank(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreDateSegmentCandidate(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  const target = candidates[0];
  if (!target) return false;

  const match = getDateSegmentBlankPattern().exec(target.text);
  if (!match) return false;
  const replacement = buildDateSegmentReplacement(match[0], parts);
  if (!replacement) return true;

  setXmlParagraphWithFill(
    target.item,
    target.text.slice(0, match.index),
    replacement,
    target.text.slice(match.index + match[0].length),
    field,
    { underline: shouldUnderlineFilledValue(match[0]) },
  );
  return true;
}

function applyChoiceToDocxXml(paragraphs, field) {
  const keywords = getChoiceKeywords(getFieldChoiceValue(field), `${field.name || ""} ${field.question || ""} ${field.answerFormat || ""}`);
  if (keywords.length === 0) return false;

  const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => {
    return /[□☐○〇▢☑✓✔]/.test(text) && Boolean(findMatchedChoiceKeyword(text, keywords));
  });
  if (!paragraph) return false;

  const textNodes = getXmlTextNodes(paragraph);
  textNodes.forEach((node) => {
    node.textContent = (node.textContent || "").replace(/[☑✓✔]/g, "□");
  });

  const keyword = findMatchedChoiceKeyword(getXmlParagraphText(paragraph), keywords);
  const keywordPosition = findXmlKeywordPosition(textNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestXmlChoiceMarkerBefore(textNodes, keywordPosition)
    : findFirstXmlChoiceMarker(textNodes);

  if (!markerPosition) return false;
  const markerIndex = getXmlTextNodeOffset(textNodes, markerPosition.node, markerPosition.index);
  const paragraphText = getXmlParagraphText(paragraph);
  if (markerIndex < 0) return false;
  setXmlParagraphWithFill(paragraph, paragraphText.slice(0, markerIndex), "☑", paragraphText.slice(markerIndex + 1), field);
  return true;
}

function getXmlTextNodeOffset(nodes, targetNode, localIndex) {
  let offset = 0;
  for (const node of nodes) {
    if (node === targetNode) return offset + localIndex;
    offset += (node.textContent || "").length;
  }
  return -1;
}

function applyContextualFillToDocxXml(paragraphs, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => descriptor.pattern.test(text));
    if (!paragraph) continue;
    const text = getXmlParagraphText(paragraph);
    const match = descriptor.pattern.exec(text);
    if (!match) continue;
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }
  return false;
}

function applySectionLeadFillToDocxXml(paragraphs, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadXmlTarget(paragraphs, sectionLabel, field);
  const paragraph = target?.item;
  if (!paragraph) return false;

  setXmlParagraphWithFill(paragraph, `${sectionLabel}：`, getSectionAnswerValue(field, sectionLabel), "", field);
  removeSectionTemplateOptionParagraphs(paragraphs, target.index, sectionLabel);
  return true;
}

function findSectionLeadXmlTarget(paragraphs, sectionLabel, field) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => isSectionLeadParagraph(text, sectionLabel))
    .map((target) => ({
      ...target,
      score: scoreSectionLeadCandidate(
        [target.text, ...getSectionFollowingXmlTexts(paragraphs, target.index, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0];
}

function getSectionFollowingXmlTexts(paragraphs, startIndex, sectionLabel) {
  const texts = [];
  for (let index = startIndex + 1; index < paragraphs.length && texts.length < 4; index += 1) {
    const text = getXmlParagraphText(paragraphs[index]).replace(/\s+/g, " ").trim();
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
  }
  return texts;
}

function removeSectionTemplateOptionParagraphs(paragraphs, startIndex, sectionLabel) {
  for (let index = startIndex + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const text = getXmlParagraphText(paragraph);
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      setXmlParagraphDeleted(paragraph);
    }
  }
}

function resolveSectionLeadLabel(field) {
  const source = getTemplateFieldSourceText(field) || field.name || "";
  const match = source.match(/^\s*(\d+[.、]\s*)?[□☐○〇▢☑✓✔]?\s*([^：:；;。]{2,24}要求)\s*[：:]/);
  if (match) return `${(match[1] || "").replace(/\s+/g, "")}${match[2].replace(/\s+/g, "")}`;
  return "";
}

function isSectionLeadParagraph(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return normalizedText.startsWith(normalizedLabel) && (normalizedText.length <= normalizedLabel.length + 8 || normalizedLabel.includes("要求"));
}

function applyLabelFillToDocxXml(paragraphs, field) {
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const paragraph = findBestXmlParagraphForField(
    paragraphs,
    field,
    (text) => text.includes(field.name) && /[：:]/.test(text),
  );
  if (!paragraph) return false;
  const text = getXmlParagraphText(paragraph);
  const match = pattern.exec(text);
  if (match) {
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }

  return applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field);
}

function applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field) {
  const labelIndex = findFieldLabelIndex(text, field.name);
  if (labelIndex < 0) return false;

  const colonIndex = findColonAfterIndex(text, labelIndex);
  const searchStart = colonIndex >= 0 ? colonIndex + 1 : labelIndex + field.name.length;
  const tail = text.slice(searchStart);
  const blankMatch = /[_＿—\-\s]{2,}/.exec(tail);
  if (!blankMatch) return false;

  const blankStart = searchStart + blankMatch.index;
  setXmlParagraphWithFill(
    paragraph,
    text.slice(0, blankStart),
    field.value,
    text.slice(blankStart + blankMatch[0].length),
    field,
    { underline: shouldUnderlineFilledValue(blankMatch[0]) },
  );
  return true;
}

function findBestXmlParagraphForField(paragraphs, field, predicate) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => predicate(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreXmlParagraphForField(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.index - b.index)[0]?.item || null;
}

function scoreXmlParagraphForField(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  let score = 0;
  if (field.name && text.includes(field.name)) score += 12;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 6;
  });

  getFieldContextTokens(field).forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(24, token.length * 2);
  });

  getFieldContextTexts(field).forEach((context) => {
    const normalizedContext = normalizeAnnotationText(context);
    if (!normalizedContext) return;
    if (normalizedText.includes(normalizedContext)) score += 120;
    else if (normalizedContext.includes(normalizedText) && normalizedText.length >= 8) score += 60;
  });

  return score;
}

function getFieldContextTexts(field) {
  return [
    field.marker?.text,
    field.answerFormat,
    field.question?.replace(/^模板上下文[：:]/, ""),
  ]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2);
}

function getFieldContextTokens(field) {
  return [...new Set(getFieldContextTexts(field).flatMap((text) => {
    return text
      .split(/[□☐○〇▢_＿—\-\s,，。；;:：（）()、/／]+/)
      .map((item) => normalizeAnnotationText(item))
      .filter((item) => item.length >= 2);
  }))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function findFieldLabelIndex(text, fieldName) {
  const names = [
    fieldName,
    String(fieldName || "").replace(/^\s*\d+[.、]\s*/, ""),
    String(fieldName || "").replace(/[（）()]/g, ""),
  ]
    .map((name) => name.trim())
    .filter(Boolean);

  for (const name of [...new Set(names)]) {
    const index = text.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function findColonAfterIndex(text, startIndex) {
  const colonIndex = text.indexOf("：", startIndex);
  const halfColonIndex = text.indexOf(":", startIndex);
  if (colonIndex < 0) return halfColonIndex;
  if (halfColonIndex < 0) return colonIndex;
  return Math.min(colonIndex, halfColonIndex);
}

function getXmlTextNodes(paragraph) {
  return [...paragraph.getElementsByTagName("w:t")];
}

function getXmlParagraphText(paragraph) {
  return getXmlTextNodes(paragraph)
    .map((node) => node.textContent || "")
    .join("");
}

function setXmlParagraphText(paragraph, text) {
  const textNodes = getXmlTextNodes(paragraph);
  if (textNodes.length === 0) return;
  textNodes[0].textContent = text;
  for (let index = 1; index < textNodes.length; index += 1) {
    textNodes[index].textContent = "";
  }
}

function findXmlKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };
    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestXmlChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstXmlChoiceMarker(nodes);
}

function findFirstXmlChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function findChoiceTarget(container, field) {
  const value = typeof field === "string" ? field : getFieldChoiceValue(field);
  const context = typeof field === "string" ? "" : `${field?.name || ""} ${field?.question || ""} ${field?.answerFormat || ""}`;
  const keywords = getChoiceKeywords(value, context);
  if (keywords.length === 0) return null;

  const splitNodeTarget = collectTextNodes(container)
    .map((node) => {
      const matchedKeyword = findMatchedChoiceKeyword(node.textContent || "", keywords);
      if (!matchedKeyword) return null;
      const paragraph = node.parentElement?.closest?.("p, td, li, div");
      if (!paragraph || !hasChoiceMarker(paragraph)) return null;
      return { element: paragraph, keyword: matchedKeyword };
    })
    .find(Boolean);
  if (splitNodeTarget) return splitNodeTarget;

  const candidates = [...container.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!/[□☐○〇▢☑✓✔]/.test(text)) return null;
      const matchedKeyword = findMatchedChoiceKeyword(text, keywords);
      return matchedKeyword ? { element: node, keyword: matchedKeyword } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.element.textContent?.length || 0) - (b.element.textContent?.length || 0));
  return candidates[0] || null;
}

function hasChoiceMarker(node) {
  return collectTextNodes(node).some((textNode) => /[□☐○〇▢☑✓✔]/.test(textNode.textContent || ""));
}

function markChoiceTarget(target) {
  const element = target?.element ?? target;
  const keyword = target?.keyword ?? "";
  if (!element) return;

  const nearbyNodes = collectTextNodes(element);
  const keywordPosition = findKeywordPosition(nearbyNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestChoiceMarkerBefore(nearbyNodes, keywordPosition)
    : findFirstChoiceMarker(nearbyNodes);

  if (!markerPosition) return;

  const { node, index } = markerPosition;
  const text = node.textContent || "";
  element.classList.add("docx-choice-selected");
  node.textContent = `${text.slice(0, index)}☑${text.slice(index + 1)}`;
}

function findKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };

    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstChoiceMarker(nodes);
}

function findFirstChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function findMatchedChoiceKeyword(text, keywords) {
  const normalizedText = normalizeChoiceText(text);
  return keywords.find((keyword) => {
    const normalizedKeyword = normalizeChoiceText(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword);
  });
}

function getChoiceKeywords(value, context = "") {
  const normalizedValue = normalizeChoiceText(value);
  const keywords = [];

  collectChoiceKeywordsFromText(normalizedValue, keywords);

  const bracketMatches = [...String(value || "").matchAll(/[（(]([^（）()]{2,24})[）)]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  keywords.push(...bracketMatches);

  if (normalizedValue && normalizedValue.length <= 18) {
    keywords.push(value);
  }

  if (keywords.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), keywords);
  }

  return [...new Set(keywords)]
    .map((item) => String(item || "").trim())
    .filter((item) => normalizeChoiceText(item).length >= 2)
    .sort((a, b) => normalizeChoiceText(b).length - normalizeChoiceText(a).length);
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function findFillTarget(container, fieldName) {
  const candidates = [...container.querySelectorAll("p, td, div, span")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.includes(fieldName) && /[：:]/.test(text) && text.length <= 120;
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
  return candidates[0] || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeFlexibleContext(value) {
  return escapeRegExp(value).replace(/\s+/g, "\\s*");
}

export {
  applyFillPreviewValues,
  applyDateSegmentFillValue,
  replaceDateSegmentInTarget,
  appendDateFillPart,
  scoreDateSegmentCandidate,
  applyAmountUnitFillValue,
  getScopedCandidateNodes,
  scoreAmountUnitCandidate,
  applyMarkerFillValue,
  shouldContinueFillAfterChoice,
  findMarkerFillTarget,
  applyTemplateContextBlankFillValue,
  isBlankCandidateCompatible,
  scoreBlankFillCandidate,
  applyFirstBlankFillValue,
  applyMarkerRangeFillValue,
  isUsefulFillBlank,
  chooseBestBlankMatch,
  filterCompatibleBlankMatches,
  expectsAmountBlank,
  collectBlankMatches,
  replaceBlankMatchWithValue,
  getBlankPreviewValue,
  scoreBlankLocalLabel,
  getFieldNameTokens,
  applyLabelFillValue,
  applyContextualFillValue,
  applySectionLeadFillValue,
  getSectionReplacementSourceNodes,
  findSectionLeadDomTarget,
  getSectionFollowingDomTexts,
  isNextSectionLead,
  isSectionNoRequirementOption,
  isSectionTemplateOptionParagraph,
  isSectionReplacementChoiceField,
  getSectionAnswerValue,
  shouldReplaceSectionWithAnswer,
  scoreSectionLeadCandidate,
  createSectionMatchTokens,
  getContextualFillDescriptors,
  createContextualFillDescriptor,
  findContextualFillTarget,
  replaceTargetTextWithValue,
  storeOriginalText,
  storeOriginalHtml,
  buildFilledDocxBuffer,
  exportFilledDocx,
  enableDocxTrackRevisions,
  setXmlParagraphWithFill,
  appendXmlRun,
  appendXmlInsertedRun,
  setXmlParagraphDeleted,
  appendXmlDeletedRun,
  createXmlRunProperties,
  getFillRevisionAuthor,
  shouldUnderlineFilledValue,
  applyDateSegmentFillToDocxXml,
  applyChoiceToDocxXml,
  getXmlTextNodeOffset,
  applyContextualFillToDocxXml,
  applySectionLeadFillToDocxXml,
  findSectionLeadXmlTarget,
  getSectionFollowingXmlTexts,
  removeSectionTemplateOptionParagraphs,
  resolveSectionLeadLabel,
  isSectionLeadParagraph,
  applyLabelFillToDocxXml,
  applyFirstBlankAfterFieldLabelToDocxXml,
  findBestXmlParagraphForField,
  scoreXmlParagraphForField,
  getFieldContextTexts,
  getFieldContextTokens,
  findFieldLabelIndex,
  findColonAfterIndex,
  getXmlTextNodes,
  getXmlParagraphText,
  setXmlParagraphText,
  findXmlKeywordPosition,
  findNearestXmlChoiceMarkerBefore,
  findFirstXmlChoiceMarker,
  findChoiceTarget,
  hasChoiceMarker,
  markChoiceTarget,
  findKeywordPosition,
  findNearestChoiceMarkerBefore,
  findFirstChoiceMarker,
  findMatchedChoiceKeyword,
  getChoiceKeywords,
  collectTextNodes,
  findFillTarget,
  escapeRegExp,
  escapeFlexibleContext
};


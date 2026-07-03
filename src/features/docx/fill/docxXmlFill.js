import JSZip from "jszip";

import { buildExportFileName, downloadDocxBuffer } from "../../../utils/files.js";
import { getTemplateFieldSourceText, hasFillBlank, normalizeFillMode } from "../../../utils/fields.js";
import {
  buildDateSegmentReplacement,
  collectChoiceKeywordsFromText,
  getDateSegmentBlankPattern,
  getFieldAmountValue,
  getFieldChoiceValue,
  getFillBookmarkName,
  hasDateSegmentBlank,
  isDateField,
  normalizeChoiceText,
  parseDateParts,
} from "./helpers.js";
import { normalizeAnnotationText } from "../annotate/markers.js";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
let aiRevisionId = 1000;
let fillBookmarkId = 50000;
let fillBookmarkNames = new Set();

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

function shouldContinueFillAfterChoice(field) {
  const context = `${field.answerFormat || ""} ${field.question || ""}`;
  const value = getFieldAmountValue(field);
  return hasFillBlank(context) || /金额|限价|费用|报价|%|％|元|万元/.test(context) || /[0-9]/.test(value);
}

function getFieldNameTokens(name = "") {
  return String(name)
    .split(/[\s/／|｜,，、:：()（）]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(-4);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeFlexibleContext(value) {
  return escapeRegExp(value).replace(/\s+/g, "\\s*");
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

export {
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
};

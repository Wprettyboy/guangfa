import { isReplacementField, normalizeFillMode } from "../../../utils/fields.js";

function getFillBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_FIELD_${id}` : "";
}

function getInputPointBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_INPUT_${id}` : "";
}

function getFillTargetBookmarkName(field) {
  return !isReplacementField(field) && field?.inputPoint?.bookmarkName ? field.inputPoint.bookmarkName : getFillBookmarkName(field);
}

function getFieldAmountValue(field = {}) {
  return String(field.amountValue || field.value || "").trim();
}

function getFieldChoiceValue(field = {}) {
  if (normalizeFillMode(field.fillMode, field) === "amount-choice") return String(field.choiceValue || "").trim();
  return String(field.choiceValue || field.value || "").trim();
}

function normalizeChoiceText(value) {
  return (value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/^第[一二三四五六七八九十\d]+章\s*/, "")
    .replace(/[（）()：:，,。；;\s]/g, "")
    .replace(/综合评分法/g, "综合评估法")
    .trim();
}

function collectChoiceKeywordsFromText(normalizedText, keywords) {
  if (normalizedText.includes("综合评估法")) {
    keywords.push("综合评估法", "综合评分法");
  }
  if (normalizedText.includes("最低投标价法")) {
    keywords.push("经评审的最低投标价法", "最低投标价法");
  }
  if (normalizedText.includes("不含税")) {
    keywords.push("不含税");
  } else if (normalizedText.includes("含税")) {
    keywords.push("含税");
  }
}

function hasDateSegmentBlank(text) {
  return getDateSegmentBlankPattern().test(text || "");
}

function getDateSegmentBlankPattern() {
  return /[_＿—\-\s]{0,12}年[_＿—\-\s]{0,8}月[_＿—\-\s]{0,8}日(?:[_＿—\-\s]{0,8}时[_＿—\-\s]{0,8}分)?/;
}

function buildDateSegmentFillText(source, value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return String(source || "").replace(getDateSegmentBlankPattern(), (match) => buildDateSegmentReplacement(match, parts) || match);
}

function buildDateSegmentReplacement(segment, parts) {
  if (!parts?.year || !parts.month || !parts.day) return "";
  if (dateSegmentNeedsTime(segment) && (!parts.hour || !parts.minute)) return "";
  const dateText = `${parts.year}年${parts.month}月${parts.day}日`;
  return dateSegmentNeedsTime(segment) ? `${dateText}${parts.hour}时${parts.minute}分` : dateText;
}

function dateSegmentNeedsTime(segment) {
  return /时[_＿—\-\s]{0,8}分/.test(segment || "");
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const chineseMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})(?:\s*时\s*|[:：])\s*(\d{1,2})\s*分?)?/);
  if (chineseMatch) {
    return {
      year: chineseMatch[1],
      month: chineseMatch[2],
      day: chineseMatch[3],
      hour: chineseMatch[4] || "",
      minute: chineseMatch[5] || "",
    };
  }

  const numericMatch = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2})[:：时](\d{1,2})(?:分)?)?/);
  if (numericMatch) {
    return {
      year: numericMatch[1],
      month: padDatePart(numericMatch[2]),
      day: padDatePart(numericMatch[3]),
      hour: numericMatch[4] ? padDatePart(numericMatch[4]) : "",
      minute: numericMatch[5] ? padDatePart(numericMatch[5]) : "",
    };
  }

  const spacedMatch = text.match(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})(?:\s+(\d{1,2})\s+(\d{1,2}))?/);
  if (spacedMatch) {
    return {
      year: spacedMatch[1],
      month: padDatePart(spacedMatch[2]),
      day: padDatePart(spacedMatch[3]),
      hour: spacedMatch[4] ? padDatePart(spacedMatch[4]) : "",
      minute: spacedMatch[5] ? padDatePart(spacedMatch[5]) : "",
    };
  }

  return null;
}

function padDatePart(value) {
  return String(value || "").padStart(2, "0");
}

function isDateField(field) {
  return normalizeFillMode(field?.fillMode, field) === "date" || field?.type === "日期" || /日期|年\s*月\s*日|年月日|编制时间/.test(`${field?.name || ""} ${field?.answerFormat || ""} ${field?.question || ""}`);
}

export {
  buildDateSegmentFillText,
  buildDateSegmentReplacement,
  collectChoiceKeywordsFromText,
  dateSegmentNeedsTime,
  getFieldAmountValue,
  getFieldChoiceValue,
  getFillBookmarkName,
  getFillTargetBookmarkName,
  getInputPointBookmarkName,
  getDateSegmentBlankPattern,
  hasDateSegmentBlank,
  isDateField,
  normalizeChoiceText,
  padDatePart,
  parseDateParts,
};

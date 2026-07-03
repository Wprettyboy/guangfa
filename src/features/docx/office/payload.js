import {
  getFieldAmountValue,
  getFieldChoiceValue,
  getFillTargetBookmarkName,
  hasDateSegmentBlank,
  isDateField,
  buildDateSegmentFillText,
  normalizeChoiceText,
} from "../fill/helpers.js";
import {
  getFieldDisplayText,
  getTemplateFieldSourceText,
  hasInputPoint,
  isReplacementField,
  normalizeFieldCategory,
  normalizeFillMode,
  requiresInputPoint,
} from "../../../utils/fields.js";

function buildOnlyOfficeAnnotationFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    name: getTemplateFieldSourceText(field) || field.name,
    page: field.page,
    marker: field.marker
      ? {
          text: field.marker.text || "",
        }
      : null,
  }));
}

function buildOnlyOfficeFillFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    bookmarkName: getFillTargetBookmarkName(field),
    name: getFieldDisplayText(field),
    category: normalizeFieldCategory(field.category || field.type),
    sourceText: getTemplateFieldSourceText(field),
    requiresInputPoint: requiresInputPoint(field),
    hasInputPoint: hasInputPoint(field),
    page: field.page,
    marker: field.marker?.text ? { text: field.marker.text } : null,
    answerFormat: field.answerFormat,
    question: field.question,
    value: field.value || "",
    amountValue: field.amountValue || "",
    choiceValue: field.choiceValue || "",
    fillMode: normalizeFillMode(field.fillMode, field),
    fillText: buildOnlyOfficeLiveFillText(field),
  }));
}

function buildOnlyOfficeLiveFillText(field = {}) {
  const value = getFieldAmountValue(field);
  if (!value) return "";
  if (hasInputPoint(field) && !isReplacementField(field)) return value;
  const source = getTemplateFieldSourceText(field);
  if (!source) return value;
  if (isDateField(field) && hasDateSegmentBlank(source)) return buildDateSegmentFillText(source, value) || source;
  if (/[□☐○〇▢☑✓✔]/.test(source)) return buildOnlyOfficeChoiceFillText(source, getFieldChoiceValue(field) || value);
  if (/[_＿—-]{2,}|\s{2,}/.test(source)) return source.replace(/_{2,}|＿+|—+|-{2,}|\s{2,}/, value);
  const quoteBlank = source.match(/^(.*?[“"])\s+([”"].*)$/);
  if (quoteBlank) return `${quoteBlank[1]}${value}${quoteBlank[2]}`;
  const punctBlank = source.match(/^(.*?[：:][^。；;，,）)]*?)\s+([。；;，,）)].*)$/);
  if (punctBlank) return `${punctBlank[1]}${value}${punctBlank[2]}`;
  const colonBlank = source.match(/^(.*?[：:])\s+(.*)$/);
  if (colonBlank) return `${colonBlank[1]}${value}${colonBlank[2]}`;
  if (/[：:]\s*$/.test(source)) return `${source}${value}`;
  return value;
}

function buildOnlyOfficeChoiceFillText(source, value) {
  const cleanValue = normalizeChoiceText(value);
  const base = source.replace(/[☑✓✔]/g, "□");
  const match = [...base.matchAll(/[□☐○〇▢]\s*([^□☐○〇▢☑✓✔]{1,80})/g)]
    .map((item) => ({ item, score: scoreChoiceOptionMatch(item[1], cleanValue) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || normalizeChoiceText(b.item[1]).length - normalizeChoiceText(a.item[1]).length)[0]?.item;
  return match ? `${base.slice(0, match.index)}☑${base.slice(match.index + 1)}` : value;
}

function scoreChoiceOptionMatch(optionText, normalizedValue) {
  const option = normalizeChoiceText(optionText);
  if (!option || !normalizedValue) return 0;
  if (option === normalizedValue) return 100;
  if (option.includes(normalizedValue)) return 90;
  if (normalizedValue.includes(option)) return 70;
  return 0;
}

export {
  buildOnlyOfficeAnnotationFieldPayload,
  buildOnlyOfficeChoiceFillText,
  buildOnlyOfficeFillFieldPayload,
  buildOnlyOfficeLiveFillText,
  scoreChoiceOptionMatch,
};

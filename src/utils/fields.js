const fillModeOptions = [
  { value: "short", label: "短文本" },
  { value: "paragraph", label: "长文本" },
  { value: "date", label: "日期" },
  { value: "amount", label: "金额" },
  { value: "choice", label: "选择" },
  { value: "choice-replace", label: "替换+选择" },
  { value: "amount-choice", label: "金额+选择" },
];

const choiceFillModeOptions = fillModeOptions.filter((item) => ["choice", "choice-replace", "amount-choice"].includes(item.value));

const blankFillModeOptions = fillModeOptions.filter((item) => ["short", "paragraph", "date", "amount"].includes(item.value));

const fieldCategoryOptions = ["填空", "单选项"];

function createAnnotatedField(slot, order, typeOverride) {
  const sourceText = getTemplateFieldSourceText(slot);
  const category = normalizeFieldCategory(typeOverride ?? slot.defaultType);
  return {
    id: `F-${String(order).padStart(3, "0")}`,
    slotId: slot.id,
    name: sourceText.slice(0, 30) || slot.suggestedName,
    sourceText,
    category,
    type: category,
    required: slot.required,
    status: "已标注",
    question: slot.suggestedQuestion,
    answerFormat: slot.answerFormat,
    aiInstruction: `根据模板选区原文自动填充`,
    fillMode: inferFillMode({ ...slot, sourceText, category }),
    page: slot.page,
    path: slot.path,
    marker: slot.marker ?? null,
  };
}

function createFillFieldsFromTemplate(templateFields, existingFields = []) {
  return templateFields.map((field) => {
    const existing = existingFields.find((item) => item.id === field.id || item.slotId === field.slotId || item.name === field.name);
    return {
      ...pickTemplateFillContext(field),
      value: existing?.value ?? "",
      status: existing?.status === "已确认" ? "已确认" : existing?.value ? "待确认" : "未填充",
      confidence: existing?.confidence ?? 0,
      source: existing?.source ?? "待上传资料后生成",
      evidence: existing?.evidence ?? `${getFieldDisplayText(field)}尚未执行 AI 填充，暂无溯源证据。`,
      sourceSnippetText: existing?.sourceSnippetText ?? "",
    };
  });
}

function mergeFillFieldsWithTemplate(fillFields, templateFields) {
  return fillFields.map((field) => {
    const templateField = templateFields.find(
      (item) => item.id === field.id || item.slotId === field.slotId || item.name === field.name,
    );
    return templateField ? { ...pickTemplateFillContext(templateField), ...field } : field;
  });
}

function pickTemplateFillContext(field) {
  return {
    id: field.id,
    slotId: field.slotId,
    name: field.name,
    sourceText: getTemplateFieldSourceText(field),
    category: normalizeFieldCategory(field.category || field.type),
    type: normalizeFieldCategory(field.type || field.category),
    fillMode: normalizeFillMode(field.fillMode, field),
    question: field.question,
    answerFormat: field.answerFormat,
    aiInstruction: field.aiInstruction,
    page: field.page,
    path: field.path,
    marker: field.marker ?? null,
    inputPoint: field.inputPoint ?? null,
  };
}

function normalizeTemplateFieldForRuntime(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type);
  return { ...field, category, type: category, fillMode: normalizeFillMode(field.fillMode, field) };
}

function createDynamicSlot(target, order) {
  const text = target.text?.replace(/\s+/g, " ").trim() ?? "";
  const guessedName = guessFieldName(text, order);
  const guessedType = guessFieldType(text);
  return {
    id: `dynamic-${Date.now()}-${order}`,
    label: guessedName,
    suggestedName: guessedName,
    defaultType: guessedType,
    required: true,
    page: target.page ?? 1,
    path: target.path ?? "文档选区",
    suggestedQuestion: text ? `模板上下文：${text.slice(0, 60)}` : "请补充字段说明",
    answerFormat: text || "按模板上下文填写",
    marker: target.marker ?? null,
    aiInstruction:
      guessedType === "单选项"
        ? `根据资料自动判断并选择“${guessedName}”`
        : `根据资料自动获取“${guessedName}”`,
  };
}

function getTemplateFieldSourceText(field = {}) {
  return String(
    field.sourceText ||
      field.marker?.text ||
      field.answerFormat ||
      field.question?.replace(/^模板上下文[：:]/, "") ||
      "",
  ).replace(/\s+/g, " ").trim();
}

function normalizeFieldCategory(value) {
  const category = String(value || "").trim();
  return category === "单选项" ? "单选项" : "填空";
}

function isReplacementField(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type || field.defaultType);
  return category === "单选项";
}

function requiresInputPoint(field = {}) {
  return !isReplacementField(field) && !canUseMarkedSelectionAsFillTarget(field);
}

function getFieldWriteMode(field = {}) {
  if (isReplacementField(field)) return "replace-selection";
  return hasInputPoint(field) ? "insert-at-input-point" : "fill-marked-selection";
}

function hasInputPoint(field = {}) {
  return Boolean(field.inputPoint?.bookmarkName);
}

function canUseMarkedSelectionAsFillTarget(field = {}) {
  if (isReplacementField(field) || !hasMarkedSelection(field)) return false;
  const source = getTemplateFieldSourceText(field);
  return Boolean(
    source &&
      (
        hasFillBlank(source) ||
        /[“"]\s+[”"]/.test(source) ||
        /[：:][^。；;，,）)]*\s+[。；;，,）)]/.test(source) ||
        /[：:]\s*$/.test(source) ||
        /年\s*月\s*日/.test(source)
      ),
  );
}

function hasMarkedSelection(field = {}) {
  return Boolean(field.marker?.kind || field.marker?.text || String(field.path || "").includes("选区"));
}

function getFieldDisplayText(field = {}) {
  return getTemplateFieldSourceText(field) || field.name || field.id || "未命名字段";
}

function normalizeFillMode(value, field = {}) {
  const mode = String(value || "").trim();
  const options = getFillModeOptions(field);
  const legacyMode = getLegacyFillMode(field);
  if (legacyMode && (!mode || mode === "short" || mode === "list" || mode === "table")) return legacyMode;
  return options.some((item) => item.value === mode) ? mode : inferFillMode(field);
}

function getLegacyFillMode(field = {}) {
  const legacyType = String(field.type || field.category || field.defaultType || "").trim();
  if (legacyType === "日期") return "date";
  if (legacyType === "金额") return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段") return "paragraph";
  return "";
}

function getFillModeOptions(field = {}) {
  return normalizeFieldCategory(field.category || field.type || field.defaultType) === "单选项"
    ? choiceFillModeOptions
    : blankFillModeOptions;
}

function inferFillMode(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type || field.defaultType);
  const legacyType = String(field.type || field.category || field.defaultType || "").trim();
  const text = getTemplateFieldSourceText(field) || field.label || field.name || "";
  const context = `${text} ${field.question || ""} ${field.answerFormat || ""}`.replace(/\s+/g, " ");
  if (category === "单选项") return isAmountChoiceContext(context) ? "amount-choice" : "choice";
  if (legacyType === "日期" || /日期|年\s*月\s*日|年月日|编制时间/.test(context)) return "date";
  if (legacyType === "金额" || /金额|限价|报价|费用|预算|元|万元/.test(context)) return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段" || /包括但不限于|包括|包含|不限于|清单|配置|分项|表格|主要施工内容|工作内容|采购范围|实施范围|服务范围|内容|规模|范围|概况|要求|服务内容|建设内容|实施内容|技术要求|商务要求|项目详细要求/.test(context)) return "paragraph";
  return "short";
}

function isAmountChoiceContext(context) {
  const text = String(context || "");
  return /[□☐○〇▢☑✓✔]/.test(text) && /含税|不含税/.test(text) && /金额|限价|报价|费用|预算/.test(text) && /元|万元/.test(text);
}

function getFillModeLabel(value) {
  return fillModeOptions.find((item) => item.value === value)?.label || "短文本";
}

function guessFieldName(text, order) {
  if (!text) return `字段${order}`;
  if (/□|☐|○|〇|▢/.test(text)) {
    const optionTexts = text
      .split(/□|☐|○|〇|▢/)
      .map((item) => item.replace(/[（）()]/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const commonName = inferChoiceFieldName(optionTexts);
    if (commonName) return commonName;
  }
  const beforeColon = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]+)\s*[：:]/)?.[1];
  if (beforeColon) return beforeColon.slice(0, 18);
  const placeholder = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]{2,18})(?:_{2,}|-{2,}|□+)/)?.[1];
  if (placeholder) return placeholder;
  return text.replace(/[：:：_＿\-—\s]+/g, "").slice(0, 12) || `字段${order}`;
}

function guessFieldType(text) {
  if (/□|☐|○|〇|▢/.test(text) || /二选一|单选|选择/.test(text)) return "单选项";
  return "填空";
}

function inferChoiceFieldName(options) {
  const joined = options.join(" ");
  if (joined.includes("评审办法") || joined.includes("评审方法")) return "评审办法";
  if (joined.includes("报价") || joined.includes("标价")) return "报价方式";
  if (joined.includes("资格") || joined.includes("资质")) return "资格要求";
  if (joined.includes("交付") || joined.includes("服务期") || joined.includes("工期")) return "期限要求";
  const normalized = options
    .map((item) => item.replace(/^第[一二三四五六七八九十\d]+章/, "").replace(/[，,。；;：:].*$/, "").trim())
    .filter(Boolean);
  if (normalized.length === 0) return "";
  return normalized[0].slice(0, 12) || "";
}

function hasFillBlank(text) {
  return /[_＿—-]{2,}|\s{2,}|(?<=[：:])\s+(?=元|万元|%|％|日历天|分钟|天)|(?<=的)\s+(?=%|％)/.test(text || "");
}



export {
  fillModeOptions,
  choiceFillModeOptions,
  blankFillModeOptions,
  fieldCategoryOptions,
  createAnnotatedField,
  createFillFieldsFromTemplate,
  mergeFillFieldsWithTemplate,
  pickTemplateFillContext,
  normalizeTemplateFieldForRuntime,
  createDynamicSlot,
  getTemplateFieldSourceText,
  normalizeFieldCategory,
  isReplacementField,
  requiresInputPoint,
  getFieldWriteMode,
  hasInputPoint,
  canUseMarkedSelectionAsFillTarget,
  hasMarkedSelection,
  getFieldDisplayText,
  normalizeFillMode,
  getLegacyFillMode,
  getFillModeOptions,
  inferFillMode,
  isAmountChoiceContext,
  getFillModeLabel,
  guessFieldName,
  guessFieldType,
  inferChoiceFieldName,
  hasFillBlank,
};


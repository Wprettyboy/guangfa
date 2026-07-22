function normalizeFillMode(field = {}) {
  const mode = String(field.fillMode || "").trim();
  const allowed = normalizeFieldCategory(field.category || field.type) === "单选项"
    ? ["choice", "choice-replace", "amount-choice"]
    : ["short", "paragraph", "date", "amount"];
  const legacyMode = getLegacyFillMode(field);
  if (legacyMode && (!mode || mode === "short" || mode === "list" || mode === "table")) return legacyMode;
  return allowed.includes(mode) ? mode : inferFillMode(field);
}

function getLegacyFillMode(field = {}) {
  const legacyType = String(field.type || field.category || "").trim();
  if (legacyType === "日期") return "date";
  if (legacyType === "金额") return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段") return "paragraph";
  return "";
}

function normalizeFieldCategory(value) {
  const category = String(value || "").trim();
  return category === "单选项" ? "单选项" : "填空";
}

function describeFieldContract(field = {}, fillMode = normalizeFillMode(field)) {
  const category = normalizeFieldCategory(field.category || field.type);
  const writeMode = field.writeMode || (category === "单选项" ? "replace-selection" : "insert-at-input-point");
  const writeLabel = writeMode === "replace-selection"
    ? "替换标注选区"
    : writeMode === "fill-marked-selection"
      ? "填写标注选区中的空白或标签"
      : field.hasInputPoint || field.inputPoint?.bookmarkName
      ? "写入已标记输入点"
      : "需要输入点，缺失时不得猜测位置";
  return `类别=${category}；输出=${getFillModeLabel(fillMode)}；写入=${writeLabel}`;
}

function inferFillMode(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type);
  const legacyType = String(field.type || field.category || "").trim();
  const context = [
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
    field.aiInstruction,
    field.name,
  ].filter(Boolean).join(" ");
  if (category === "单选项") return isAmountChoiceContext(context) ? "amount-choice" : "choice";
  if (legacyType === "日期" || /日期|年\s*月\s*日|年月日|编制时间/.test(context)) return "date";
  if (legacyType === "金额" || /金额|限价|报价|费用|预算|元|万元/.test(context)) return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段" || /包括但不限于|包括|包含|不限于|清单|配置|分项|表格|主要施工内容|工作内容|采购范围|实施范围|服务范围|内容|规模|范围|概况|要求|服务内容|建设内容|实施内容|技术要求|商务要求|项目详细要求/.test(context)) return "paragraph";
  return "short";
}

function getFillModeLabel(mode) {
  return {
    short: "短文本填空",
    paragraph: "长文本填空",
    date: "日期填空",
    amount: "金额填空",
    choice: "选择填空",
    "choice-replace": "替换选择填空",
    "amount-choice": "金额选择填空",
  }[mode] || "短文本填空";
}

function getFillModePromptRule(mode) {
  if (mode === "paragraph") return "长文本填空应基于知识库/上传资料整理为可写入模板的完整描述，可归纳、合并和规范措辞；不要删掉资料支持的建设规模、范围边界、数量、地点、对象等关键信息；不得输出字段标签和序号。";
  if (mode === "date") return "日期填空只输出资料明确支持的日期或时间，优先使用模板要求的中文年月日/年月日时分格式；模板有时分空位时必须输出到时、分；不得输出字段标签、解释或无依据日期。";
  if (mode === "amount") return "金额填空只输出资料明确支持的金额，保留模板需要的单位；不得输出字段标签、解释或无依据金额。";
  if (mode === "choice") return "选择填空只输出被选择的选项文本；若模板选区已列出 □/☐/○/〇/▢ 等候选项，只判断应选哪一项，不输出整段原文、不改写选项文案。";
  if (mode === "choice-replace") return "替换选择填空先按要求类型/主题判断召回片段是否有同类依据；不要把模板里的年限、数量、日期空位、证书空位当成硬性匹配条件，也不要区分资格门槛和评分项。有同类依据就整理为可替换模板选区的完整要求文本；完全没有同类依据才输出“未命中”、status 输出“需补充资料”，系统会自动转为模板中的“无xx要求”。";
  if (mode === "amount-choice") return "金额选择填空必须同时判断金额和候选项：amountValue 输出按模板单位换算后的金额纯数字，choiceValue 输出应勾选的模板选项文本；不要输出整段原文。";
  return "短文本填空只输出要写入空白处的纯值，不得包含字段标签、序号、冒号、前后固定文本、句号或解释说明。";
}

function getFillOutputJsonPrompt(mode) {
  if (mode === "amount-choice") {
    return '{"value":"金额纯数字","amountValue":"金额纯数字","choiceValue":"含税或不含税","status":"待确认","confidence":80,"source":"资料名或位置","evidence":"金额和含税状态的一句可溯源证据"}';
  }
  if (mode === "choice-replace") {
    return '{"value":"命中时为基于资料依据生成的完整要求文本；未命中时为未命中","status":"待确认","confidence":80,"source":"资料名或位置","evidence":"支撑该填充值的资料依据或未命中原因"}';
  }
  return '{"value":"字段填充值","status":"待确认","confidence":80,"source":"资料名或位置","evidence":"一句可溯源证据"}';
}

function normalizeFillModelResult(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...value };
  const rawStatus = String(value.status || "").trim();
  const status = rawStatus.toLowerCase().replace(/[\s_/-]+/g, "");
  const hasValue = String(value.value || value.amountValue || "").trim().length > 0;
  if (status === "待确认" || status === "需补充资料") return result;

  const ambiguous = new Set([
    "待确认或需补充资料",
    "待确认或补充资料",
    "需确认",
    "待审核",
    "待核实",
    "pending",
    "needsreview",
    "review",
  ]);
  const ready = new Set([
    "已确认",
    "确认",
    "已完成",
    "完成",
    "可直接填写",
    "可填充",
    "confirmed",
    "complete",
    "completed",
    "ready",
    "ok",
    "success",
  ]);
  const missing = new Set([
    "待补充资料",
    "待补充",
    "资料不足",
    "缺少资料",
    "无法确认",
    "无法填充",
    "needsinfo",
    "missing",
    "insufficient",
  ]);
  if (ambiguous.has(status)) result.status = hasValue ? "待确认" : "需补充资料";
  else if (ready.has(status)) result.status = hasValue ? "待确认" : "需补充资料";
  else if (missing.has(status)) result.status = "需补充资料";
  return result;
}

function isAmountChoiceContext(context) {
  const text = String(context || "");
  return /[□☐○〇▢☑✓✔]/.test(text) && /含税|不含税/.test(text) && /金额|限价|报价|费用|预算/.test(text) && /元|万元/.test(text);
}

function normalizeFilledValueForTemplate(field, value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (normalizeFillMode(field) === "date") return stripFillValueLabel(text, "日期|时间|编制日期");
  if (normalizeFillMode(field) === "amount") return normalizeAmountFillValue(field, text);
  if (normalizeFillMode(field) === "short" && isPackageOrSegmentShortField(field)) return stripFillValueLabel(text, "分包|分标段|标段划分|标段");
  if (field.type !== "单选项") return text;

  const context = String(field.templateContext || field.answerFormat || field.question || "").replace(/\s+/g, " ").trim();
  if (field.fillMode === "choice-replace") {
    const noRequirementOption = extractNoRequirementOption(field);
    return noRequirementOption && normalizeForSearch(text).startsWith(normalizeForSearch(noRequirementOption))
      ? noRequirementOption
      : text;
  }
  if (!/(业绩|人员|资质|资格)/.test(`${field.name || ""} ${context}`)) return text;

  const options = extractTemplateOptions(context);
  if (options.length === 0) return text;

  const exact = options.find((option) => normalizeForSearch(option) === normalizeForSearch(text));
  if (exact) return exact;

  const ranked = options
    .map((option) => ({ option, score: scoreOptionMatch(option, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.option.length - a.option.length);

  return ranked[0]?.score >= 2 ? ranked[0].option : text;
}

function normalizeAmountFillValue(field, value) {
  const text = stripFillValueLabel(value, "金额|限价|报价|费用|预算|投标保证金|询比保证金");
  if (!getTemplateAmountUnit(field)) return text;
  return normalizeTemplateAmountValue(field, text) || text;
}

function stripFillValueLabel(value, labelPattern) {
  return String(value || "").replace(new RegExp(`^(?:${labelPattern})\\s*[：:]\\s*`), "").trim();
}

function isPackageOrSegmentShortField(field = {}) {
  if (normalizeFillMode(field) !== "short") return false;
  const context = [
    field.name,
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
    field.aiInstruction,
  ].filter(Boolean).join(" ");
  return /分包|分标段|标段划分/.test(context);
}

function createDefaultPackageOrSegmentResult(evidence) {
  return {
    value: "1",
    status: "待确认",
    confidence: 80,
    source: "分包/分标段默认规则",
    evidence,
  };
}

function isCopiedFromSource(value, sourceText) {
  const needle = normalizeForSearch(value);
  if (!needle) return false;
  return normalizeForSearch(sourceText).includes(needle);
}

function isChoiceReplacementMiss(parsed = {}, value = "") {
  const text = normalizeForSearch(value || parsed?.value);
  return text.length <= 24 && /^(未命中|未找到|未检索到|没有命中|无对应原文|无匹配原文|未发现对应原文)/.test(text);
}

function extractChoiceReplacementCandidate(field = {}, knowledgeSnippets = [], materialSnippets = []) {
  const terms = getChoiceReplacementThemeTerms(field);
  if (!terms.length) return null;
  const items = [
    ...knowledgeSnippets.map((item, index) => ({ item, index, type: "knowledge" })),
    ...materialSnippets.map((item, index) => ({ item, index, type: "material" })),
  ];
  return items
    .map(({ item, index, type }) => {
      const text = String(item.text || "");
      const matched = terms
        .map((term, termIndex) => ({ term, termIndex, at: text.indexOf(term) }))
        .filter((match) => match.at >= 0)
        .sort((a, b) => a.termIndex - b.termIndex || a.at - b.at)[0];
      if (!matched) return null;
      const value = sliceChoiceReplacementText(text, matched.at);
      if (!value) return null;
      const source = type === "knowledge"
        ? `知识库${index + 1}（${item.scope === "global" ? "全局库" : "项目库"}｜${item.sourceLocation || `${item.documentName || "未命名资料"} ${formatSnippetLocation(item, index)}`}）`
        : `临时资料${index + 1}（${item.name || "未命名资料"}｜片段${item.chunkIndex || index + 1}）`;
      return {
        text: value,
        source,
        sourceSnippetText: item.sourceText || text,
        sourceDocumentId: type === "knowledge" ? item.documentId || "" : "",
        sourcePage: type === "knowledge" ? Number(item.page || 0) || 0 : 0,
        sourcePdfAvailable: type === "knowledge" && Boolean(item.sourcePdfAvailable),
        score: scoreChoiceReplacementCandidate(field, text, 100 - matched.termIndex),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function scoreChoiceReplacementCandidate(field = {}, text = "", baseScore = 0) {
  const context = [field.name, field.sourceText, field.templateContext, field.answerFormat, field.question].filter(Boolean).join(" ");
  let score = baseScore;
  if (/人员|项目经理|项目负责人|技术负责人|安全生产考核|证书|职称/.test(context)) {
    if (/供应商必须根据项目特点|项目团队至少包括|项目服务团队组成|驻场服务要求/.test(text)) score += 80;
    if (/履约能力|类似项目业绩/.test(text)) score -= 60;
  } else if (/业绩|履约能力|类似项目/.test(context)) {
    if (/履约能力|类似项目业绩|已完成类似项目业绩|合同关键页/.test(text)) score += 60;
  }
  return score;
}

function getChoiceReplacementThemeTerms(field = {}) {
  const context = [field.name, field.sourceText, field.templateContext, field.answerFormat, field.question].filter(Boolean).join(" ");
  if (/人员|项目经理|项目负责人|技术负责人|安全生产考核|证书|职称/.test(context)) return ["实施人员要求", "驻场服务要求", "项目服务团队", "本项目服务团队", "项目团队", "项目经理", "项目实施人员", "驻场服务人员", "人员保障"];
  if (/业绩|履约能力|类似项目/.test(context)) return ["履约能力", "类似项目业绩", "类似项目", "业绩案例", "合同关键页"];
  if (/资质|资格|许可证|营业执照/.test(context)) return ["资质要求", "资格要求", "安全生产许可证", "营业执照", "资质证书"];
  if (/财务|审计|报表|亏损/.test(context)) return ["财务要求", "财务状况", "审计报告", "财务报表"];
  return [];
}

function sliceChoiceReplacementText(text, start) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const offset = Math.max(0, start);
  let value = normalized.slice(offset, offset + 1000).trim();
  for (const marker of [" 5 其他商务", " （5）厂商授权", " ★四、", " 格式", " 供应商名称："]) {
    const index = value.indexOf(marker);
    if (index > 80) value = value.slice(0, index).trim();
  }
  return value;
}

function createChoiceReplacementFallbackResult(candidate) {
  return {
    value: candidate.text,
    status: "待确认",
    confidence: 78,
    source: candidate.source,
    evidence: candidate.text,
    sourceSnippetText: candidate.sourceSnippetText || candidate.text,
    sourceDocumentId: candidate.sourceDocumentId || "",
    sourcePage: candidate.sourcePage || 0,
    sourcePdfAvailable: Boolean(candidate.sourcePdfAvailable),
  };
}

function extractParagraphSourceCandidate(field = {}, modelContext = {}, knowledgeSnippets = [], materialSnippets = []) {
  const terms = getParagraphSourceTerms(field, modelContext);
  if (!terms.length) return null;
  const reference = `${modelContext.source || ""}\n${modelContext.evidence || ""}`;
  const items = [
    ...knowledgeSnippets.map((item, index) => ({ item, index, type: "knowledge" })),
    ...materialSnippets.map((item, index) => ({ item, index, type: "material" })),
  ];

  return items
    .map(({ item, index, type }) => {
      const text = String(item.text || "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      const sourceReferenced = isReferencedSource(reference, type, index + 1);
      const score = scoreParagraphSourceCandidate(text, terms, modelContext, Number(item.score || 0), sourceReferenced);
      if (score < 4) return null;
      const source = type === "knowledge"
        ? `知识库${index + 1}（${item.scope === "global" ? "全局库" : "项目库"}｜${item.sourceLocation || `${item.documentName || "未命名资料"} ${formatSnippetLocation(item, index)}`}）`
        : `临时资料${index + 1}（${item.name || "未命名资料"}｜片段${item.chunkIndex || index + 1}）`;
      return {
        text: sliceParagraphSourceText(text, terms),
        source,
        sourceSnippetText: item.sourceText || text,
        sourceDocumentId: type === "knowledge" ? item.documentId || "" : "",
        sourcePage: type === "knowledge" ? Number(item.page || 0) || 0 : 0,
        sourcePdfAvailable: type === "knowledge" && Boolean(item.sourcePdfAvailable),
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function getParagraphSourceTerms(field = {}, modelContext = {}) {
  const context = [
    field.name,
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
    field.aiInstruction,
    modelContext.retrievalQuery,
    modelContext.rawRetrievalQuery,
    modelContext.value,
    modelContext.evidence,
  ].filter(Boolean).join(" ");
  const terms = [];
  const add = (...items) => terms.push(...items);
  const addIf = (pattern, ...items) => {
    if (pattern.test(context)) add(...items);
  };

  addIf(/项目概况|工程概况|建设规模|建设内容|建筑面积|服务内容/, "项目概况", "工程概况", "建设规模", "工程建设规模", "总建筑面积", "建设内容", "服务内容");
  addIf(/采购范围|实施范围|服务范围|主要施工内容|施工图范围|工作内容|包括但不限于|分项内容/, "采购范围", "实施范围", "服务范围", "主要施工内容", "施工图范围内", "工作内容", "包括但不限于");
  addIf(/技术要求|商务要求|项目详细要求|实施内容/, "技术要求", "商务要求", "项目详细要求", "实施内容");
  addIf(/业绩|履约能力|类似项目|合同关键页|发票/, "业绩要求", "履约能力", "类似项目业绩", "类似项目", "合同关键页");
  addIf(/人员|项目经理|项目负责人|技术负责人|安全员|专职安全|项目团队|服务团队|职称|证书/, "人员要求", "实施人员要求", "项目团队", "项目负责人", "技术负责人", "专职安全生产管理人员", "职称", "证书");
  addIf(/资质|资格|许可证|营业执照|劳务资质|安全生产许可证/, "资质要求", "资格要求", "安全生产许可证", "营业执照", "劳务资质");
  addIf(/财务|审计|财务报表|亏损|纳税/, "财务要求", "财务状况", "审计报告", "财务报表", "亏损", "纳税");
  addIf(/工期|合同工期|日历天|开工|完工|进场通知/, "工期", "合同工期", "日历天", "进场通知");
  addIf(/付款|支付|进度款|结算款|质保金|缺陷责任/, "付款方式", "支付", "进度款", "结算款", "质保金", "缺陷责任");

  return [...new Map(terms
    .map((term) => [normalizeForSearch(term), term])
    .filter(([key]) => key.length >= 2)).values()];
}

function scoreParagraphSourceCandidate(text, terms, modelContext = {}, baseScore = 0, sourceReferenced = false) {
  const normalizedText = normalizeForSearch(text);
  let score = sourceReferenced ? 20 : 0;
  let matched = sourceReferenced ? 1 : 0;
  terms.forEach((term) => {
    const normalizedTerm = normalizeForSearch(term);
    if (normalizedTerm && normalizedText.includes(normalizedTerm)) {
      matched += 1;
      score += Math.min(8, normalizedTerm.length);
    }
  });
  if (isCopiedFromSource(modelContext.value, text)) {
    matched += 1;
    score += 30;
  }
  if (!/模型未返回明确证据片段/.test(String(modelContext.evidence || "")) && isCopiedFromSource(modelContext.evidence, text)) {
    matched += 1;
    score += 20;
  }
  return matched ? score + Math.min(10, Math.max(0, baseScore * 10)) : 0;
}

function isReferencedSource(reference, type, number) {
  const prefix = type === "knowledge" ? "知识库" : "(?:临时资料|上传资料)";
  return new RegExp(`${prefix}\\s*${number}(?=[（(:：\\s中提])`).test(String(reference || ""));
}

function sliceParagraphSourceText(text, terms = []) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const starts = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  return normalized.slice(start > 120 ? start : 0, start > 120 ? start + 2000 : 2000).trim();
}

function formatSnippetLocation(item = {}, index = 0) {
  return item.page ? `第${item.page}页` : `片段${item.chunkIndex || index + 1}`;
}

function sanitizeChoiceFillResult(field, parsed, value, source, evidence) {
  if (!isChoiceField(field)) return null;
  const status = String(parsed?.status || "").trim();
  if (status === "需补充资料") return createMissingChoiceResult(source, evidence || "资料不足，选择型字段不写入。");
  if (!String(value || "").trim()) return createMissingChoiceResult(source, "未返回可写入的选择值。");
  if (isNoRequirementChoiceValue(field, value)) return null;

  const reasonText = `${source || ""}\n${evidence || ""}`;

  if (looksLikeUnfilledChoiceTemplate(value) || looksLikeChoiceProofNote(value, field)) {
    return createMissingChoiceResult(source, "模型返回的是模板占位或证明材料说明，未作为有效选择写入。");
  }

  if (/模板候选原文|模板原文|模板选区|通用占位/.test(reasonText)) {
    return createMissingChoiceResult(source, "模型返回的是模板候选原文，但资料未明确支持该选择。");
  }

  if (/(需补充|无法|缺失|不匹配|不能直接|无法直接|资料不足|未明确|未找到|未检索到)/.test(reasonText)) {
    return createMissingChoiceResult(source, "模型证据显示资料不足，选择型字段不写入。");
  }

  return null;
}

function sanitizeAmountChoiceFillResult(parsed, amountValue, choiceValue, source, evidence) {
  const status = String(parsed?.status || "").trim();
  if (status === "需补充资料") return createMissingChoiceResult(source, evidence || "资料不足，金额选择字段不写入。");
  if (!amountValue) return createMissingChoiceResult(source, "未返回可按模板单位写入的金额。");
  if (!choiceValue) return createMissingChoiceResult(source, "未返回可勾选的含税/不含税选项。");
  if (/(需补充|无法|缺失|不匹配|资料不足|未明确|未找到|未检索到)/.test(`${source || ""}\n${evidence || ""}`)) {
    return createMissingChoiceResult(source, "模型证据显示资料不足，金额选择字段不写入。");
  }
  return null;
}

function normalizeTaxChoiceValue(value) {
  const text = normalizeForSearch(value);
  if (text.includes("不含税")) return "不含税";
  if (text.includes("含税")) return "含税";
  return "";
}

function normalizeTemplateAmountValue(field, value) {
  const amount = parseAmountWithUnit(value);
  if (!amount) return "";
  const targetUnit = getTemplateAmountUnit(field);
  let number = amount.number;
  const sourceMultiplier = getAmountUnitMultiplier(amount.unit);
  const targetMultiplier = getAmountUnitMultiplier(targetUnit);
  if (amount.unit && sourceMultiplier && targetMultiplier) {
    number = (number * sourceMultiplier) / targetMultiplier;
  }
  return formatAmountNumber(number);
}

function parseAmountWithUnit(value) {
  const text = String(value || "").replace(/，/g, ",");
  const match = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  const after = text.slice(match.index + match[0].length);
  const before = text.slice(0, match.index);
  const unit = after.match(getAmountUnitRegexp(true))?.[1] || before.match(getAmountUnitRegexp(false))?.[1] || "";
  return { number, unit };
}

function getTemplateAmountUnit(field = {}) {
  const context = String(field.sourceText || field.templateContext || field.answerFormat || field.question || "");
  const blankUnit = context.match(new RegExp(`(?:_{2,}|＿+|—+|-{2,}|(?<=[：:])\\s+|\\s{2,})\\s*(${amountUnitPattern()})`));
  if (blankUnit) return blankUnit[1];
  const labelUnit = context.match(new RegExp(`(?:金额|限价|报价|费用|预算)[^。；;]{0,40}[：:]\\s*(${amountUnitPattern()})`));
  return labelUnit?.[1] || "";
}

function amountUnitPattern() {
  return "[十百千]?亿(?:元)?|[十百千]?万(?:元)?|[十百千]?元|元";
}

function getAmountUnitRegexp(afterNumber) {
  const body = `(${amountUnitPattern()})`;
  return new RegExp(afterNumber ? `^\\s*${body}` : `${body}\\s*$`);
}

function getAmountUnitMultiplier(unit) {
  const text = String(unit || "").replace(/\s+/g, "");
  if (!text) return 0;
  if (text.includes("亿")) return getChineseAmountPrefixMultiplier(text.split("亿")[0]) * 100000000;
  if (text.includes("万")) return getChineseAmountPrefixMultiplier(text.split("万")[0]) * 10000;
  if (text.endsWith("元")) return getChineseAmountPrefixMultiplier(text.slice(0, -1));
  return 0;
}

function getChineseAmountPrefixMultiplier(prefix) {
  return { "": 1, 十: 10, 百: 100, 千: 1000 }[prefix] || 1;
}

function formatAmountNumber(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(6))).replace(/\.0+$/, "");
}

function isChoiceField(field = {}) {
  return normalizeFieldCategory(field.category || field.type) === "单选项" || ["choice", "choice-replace", "amount-choice"].includes(normalizeFillMode(field));
}

function createMissingChoiceResult(source, evidence) {
  return {
    value: "",
    status: "需补充资料",
    confidence: 0,
    source: source && source !== "AI 基于上传资料与知识库生成" ? source : "未找到资料依据",
    evidence,
  };
}

function createNoRequirementChoiceResult(field, sourceBundle) {
  const value = extractNoRequirementOption(field);
  if (!value) return createMissingChoiceResult("未找到资料依据", "资料未提供明确要求，且模板中未识别到“无xx要求”选项。");
  return {
    value,
    status: "待确认",
    confidence: sourceBundle && /要求/.test(sourceBundle) ? 86 : 78,
    source: "知识库未提供明确要求",
    evidence: `未在知识库/上传资料中检索到明确要求，按替换选择规则勾选“${value}”。`,
  };
}

function isNoRequirementChoiceValue(field = {}, value = "") {
  const normalized = normalizeForSearch(value);
  const option = extractNoRequirementOption(field);
  if (option && normalized.startsWith(normalizeForSearch(option))) return true;
  const context = normalizeForSearch([
    field.name,
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
  ].filter(Boolean).join(" "));
  return /^无.{0,12}要求/.test(normalized) && context.includes(normalized);
}

function extractNoRequirementOption(field = {}) {
  const context = [
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
    field.name,
  ].filter(Boolean).join(" ");
  return context.match(/无[^□☐○〇▢☑✓✔；;。，,、\s]{0,12}要求/)?.[0] || "";
}

function looksLikeUnfilledChoiceTemplate(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /[□☐○〇▢]|_{2,}|＿{2,}|—{2,}| 年 月 日|不少于\s*个|不少于 个|类似项目是指[:：]\s*(?:[。；;]|$)|具有\s*证书|具有\s*相关专业\s*级|省级及以上\s*部门|其他人员[:：]\s*(?:[。；;]|$)|（(?:业绩|人员业绩)要求）/.test(text);
}

function looksLikeChoiceProofNote(value, field = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (normalizeFillMode(field) === "choice-replace" && /(?:具有|具备|至少|不少于|近\s*\d|类似项目|安全生产许可证|劳务资质|合同金额|职称|负责人|管理人员)/.test(text)) {
    return false;
  }
  return /证明材料须提供|复印件|社保缴费证明|附以上人员|验收证明材料|合同协议|发票|身份证|聘用合同|本项目不接受退休返聘/.test(text);
}

function isTemplateOnlyFillEvidence(field, value, evidenceText, externalText) {
  if (String(field?.type || field?.category || "").includes("单选")) return false;
  if (!value || !/(模板选区|选区原文|模板原文)/.test(String(evidenceText || ""))) return false;
  const needle = normalizeForSearch(value);
  return needle.length >= 2 && !normalizeForSearch(externalText).includes(needle);
}

function extractTemplateOptions(context) {
  const source = String(context || "")
    .replace(/([□☐○〇▢☑✓✔])/g, "\n$1")
    .replace(/(无(?:业绩|人员|资质|资格)?要求[。；;]?)/g, "\n$1\n");

  return [...new Set(
    source
      .split(/\n+/)
      .map((line) => line.replace(/^[\s□☐○〇▢☑✓✔]+/, "").trim())
      .filter((line) => line.length >= 4)
      .filter((line) => /(业绩|人员|资质|资格|近年|具备|证书|许可|项目)/.test(line)),
  )];
}

function scoreOptionMatch(option, value) {
  const optionText = normalizeForSearch(option);
  const valueText = normalizeForSearch(value);
  if (!optionText || !valueText) return 0;
  if (optionText.includes(valueText) || valueText.includes(optionText)) return 10;
  return ["无", "近年", "业绩", "人员", "资质", "资格", "具备", "证书", "许可", "类似项目", "合同金额"].reduce((score, token) => {
    const normalizedToken = normalizeForSearch(token);
    return optionText.includes(normalizedToken) && valueText.includes(normalizedToken) ? score + 1 : score;
  }, 0);
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}



export {
  normalizeFillMode,
  getLegacyFillMode,
  normalizeFieldCategory,
  describeFieldContract,
  inferFillMode,
  getFillModeLabel,
  getFillModePromptRule,
  getFillOutputJsonPrompt,
  normalizeFillModelResult,
  isAmountChoiceContext,
  normalizeFilledValueForTemplate,
  normalizeAmountFillValue,
  stripFillValueLabel,
  isPackageOrSegmentShortField,
  createDefaultPackageOrSegmentResult,
  isCopiedFromSource,
  isChoiceReplacementMiss,
  extractChoiceReplacementCandidate,
  scoreChoiceReplacementCandidate,
  getChoiceReplacementThemeTerms,
  sliceChoiceReplacementText,
  createChoiceReplacementFallbackResult,
  extractParagraphSourceCandidate,
  getParagraphSourceTerms,
  scoreParagraphSourceCandidate,
  sanitizeChoiceFillResult,
  sanitizeAmountChoiceFillResult,
  normalizeTaxChoiceValue,
  normalizeTemplateAmountValue,
  parseAmountWithUnit,
  getTemplateAmountUnit,
  amountUnitPattern,
  getAmountUnitRegexp,
  getAmountUnitMultiplier,
  getChineseAmountPrefixMultiplier,
  formatAmountNumber,
  isChoiceField,
  createMissingChoiceResult,
  createNoRequirementChoiceResult,
  isNoRequirementChoiceValue,
  extractNoRequirementOption,
  looksLikeUnfilledChoiceTemplate,
  looksLikeChoiceProofNote,
  isTemplateOnlyFillEvidence,
  extractTemplateOptions,
  scoreOptionMatch,
  normalizeForSearch,
};


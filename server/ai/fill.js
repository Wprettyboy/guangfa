import { getAiRuntimeConfig, maxKnowledgeChars, maxMaterialChars } from "./config.js";
import { summarizeFieldForDebug, summarizeSnippetsForDebug, writeFillFinalDebugLog } from "./debug-log.js";
import {
  createChoiceReplacementFallbackResult,
  createDefaultPackageOrSegmentResult,
  createNoRequirementChoiceResult,
  describeFieldContract,
  extractChoiceReplacementCandidate,
  extractParagraphSourceCandidate,
  getFillModeLabel,
  getFillModePromptRule,
  getFillOutputJsonPrompt,
  getTemplateAmountUnit,
  isChoiceReplacementMiss,
  isPackageOrSegmentShortField,
  isTemplateOnlyFillEvidence,
  normalizeFillMode,
  normalizeForSearch,
  normalizeFilledValueForTemplate,
  normalizeTaxChoiceValue,
  normalizeTemplateAmountValue,
  sanitizeAmountChoiceFillResult,
  sanitizeChoiceFillResult,
} from "./fill-rules.js";
import {
  buildFieldRetrievalQuery,
  createSearchTokens,
  formatKnowledgeSnippets,
  formatMaterialSnippets,
  scoreText,
  searchKnowledgeForAi,
  selectMaterialSnippets,
} from "./knowledge-query.js";
import { callJsonModel } from "./model.js";

async function fillField(payload) {
  const field = payload?.field || {};
  const fillMode = normalizeFillMode(field);
  const promptField = { ...field, fillMode };
  const materials = Array.isArray(payload?.materials) ? payload.materials : [];
  const rawRetrievalQuery = buildFieldRetrievalQuery(promptField);
  const knowledgeOptions = { ...(payload?.knowledgeOptions || {}) };
  if (fillMode === "paragraph") knowledgeOptions.topK = Math.max(Number(knowledgeOptions.topK || 0), 10);
  const runtime = getAiRuntimeConfig();
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: rawRetrievalQuery,
    field: promptField,
    knowledgeOptions,
    debugFileName: "ai-fill-knowledge-query-last.json",
  });
  const retrievalQuery = knowledgeSearch.query || "";
  const knowledgeSnippets = knowledgeSearch.snippets;
  const materialRetrievalQuery = retrievalQuery || rawRetrievalQuery;
  const materialSnippets = selectMaterialSnippets(materials, materialRetrievalQuery, knowledgeSnippets.length > 0 ? 4 : 8);
  const materialText = formatMaterialSnippets(materialSnippets).slice(0, maxMaterialChars);
  const knowledgeText = formatKnowledgeSnippets(knowledgeSnippets).slice(0, maxKnowledgeChars);
  const sourceBundle = `${knowledgeText}\n${materialText}`;
  const debugContext = {
    field: summarizeFieldForDebug(promptField),
    fillMode,
    rawRetrievalQuery,
    retrievalQuery,
    materialRetrievalQuery,
    retrievalPlan: knowledgeSearch.plan,
    knowledgeCount: knowledgeSnippets.length,
    materialCount: materialSnippets.length,
    knowledgeSnippets: summarizeSnippetsForDebug(knowledgeSnippets),
    materialSnippets: summarizeSnippetsForDebug(materialSnippets),
  };
  const systemCitation = buildFillSourceCitation(knowledgeSnippets, materialSnippets, retrievalQuery);
  if (!materialText.trim() && !knowledgeText.trim()) {
    if (isPackageOrSegmentShortField(promptField)) {
      const result = createDefaultPackageOrSegmentResult("未检索到分包/分标段资料，按通用规则默认填写 1。");
      await writeFillFinalDebugLog(runtime, debugContext, {}, result, "package-segment-default-one-no-source");
      return result;
    }
    if (fillMode === "choice-replace") {
      const result = createNoRequirementChoiceResult(promptField, sourceBundle);
      await writeFillFinalDebugLog(runtime, debugContext, {}, result, "choice-replace-default-none-no-source");
      return result;
    }
    const result = {
      value: "",
      status: "需补充资料",
      confidence: 0,
      source: "未上传资料",
      evidence: "当前没有可用于填充的资料文本，也没有检索到知识库片段，请先上传资料或维护知识库。",
    };
    await writeFillFinalDebugLog(runtime, debugContext, {}, result, "no-source");
    return result;
  }

  const systemPrompt =
    "你是中文招投标文件自动填充助手。用户正在基于知识库/上传资料编制当前招标或采购文件。只根据知识库/上传资料回答，不要编造。不要输出思考过程。必须输出严格 JSON，不要 Markdown。模板选区原文只是待填写位置的上下文，不是资料来源。";
  const userPrompt = [
    "请为招标文件模板字段生成填充值。",
    "",
    `模板选区原文：${field.sourceText || field.templateContext || field.answerFormat || field.question || ""}`,
    `自动填充类别：${field.category || field.type || ""}`,
    `填充输出模式：${getFillModeLabel(fillMode)}`,
    `写入契约：${describeFieldContract(promptField, fillMode)}`,
    `字段说明：${field.aiInstruction || field.question || ""}`,
    `字段所在页：${field.page || ""}`,
    "",
    "输出 JSON 格式：",
    getFillOutputJsonPrompt(fillMode),
    "",
    "规则：",
    "1. 模板选区原文只用于判断要填哪个空、替换哪段话或选择哪个选项；不得把模板占位符、证明材料说明、未填写的候选项直接作为 value。",
    "2. 找不到明确依据时，value 必须为空字符串，status 为需补充资料，confidence 为 0。",
    `3. ${getFillModePromptRule(fillMode)}`,
    "4. value 只输出将被写入输入点、标注选区空白或替换选区的内容，不要附带模板字段标签、固定前后缀或解释。",
    "5. 必须先判断字段语义再填值：名称字段填名称，地点/地址字段填地点或地址，工期字段填期限，金额字段填金额，范围字段填范围；不要把资料中其他明确但语义不匹配的信息填入当前字段。",
    "6. 对业绩要求、人员要求、资质要求、财务要求等选择型字段：只能返回资料能明确支持的选项或完整替换段；不得复制模板中的空白占位、证明材料、社保/证书附件说明；资料不足时 value 为空。",
    "7. 不要输出解释性短语，例如“类似项目是指...”，除非这句话本身就是模板原文或资料原文。",
    "8. evidence 和 source 必须来自资料内容或知识库片段，不得写“模板选区原文”或把模板选区当依据。",
    "9. 知识库片段与临时资料都可作为依据；如果二者冲突，优先采用字段上下文匹配度更高、证据更明确的内容。",
    "10. 知识库片段是当前招标/采购文件的编制依据，可能来自技术文件、项目资料、上游审批、历史招采说明或命名规则；不要因为片段出现“后续”“分包”“统一使用”等上下文词就排除它。",
    "11. 对项目名称/工程名称字段，若资料写有“名称统一使用……”“项目名称为……”“工程名称为……”，应视为当前模板的权威命名依据，直接提取引号或冒号后的完整名称。",
    ...(fillMode === "amount-choice" ? [
      `12. 当前字段是“金额+勾选”复合字段，模板金额单位为“${getTemplateAmountUnit(promptField) || "未识别"}”。amountValue 必须按模板单位换算后输出，不要带单位；例如资料为 300 万元且模板单位为元，则 amountValue 为 3000000；模板单位为万元则 amountValue 为 300；模板单位为十万元/十万则 amountValue 为 30。`,
      "13. choiceValue 只能输出模板候选项中的“含税”或“不含税”。金额或含税状态任一项没有资料依据时，status 必须为需补充资料。",
    ] : []),
    ...(fillMode === "amount" ? [
      `12. 当前字段是金额填空，模板金额单位为“${getTemplateAmountUnit(promptField) || "未识别"}”。若能识别模板单位，value 必须按模板单位换算后输出，不要带单位；若模板未给单位，value 保留资料中的金额和单位。`,
    ] : []),
    ...(fillMode === "date" ? [
      "12. 当前字段是日期填空，常见模板包括“ 年 月 日”“ 年 月 日 时 分”这类日期/时间空位，以及“日期：”这类标签；模板有时分空位时 value 必须包含明确到“时、分”的时间，不要重复字段标签。",
    ] : []),
    ...(fillMode === "paragraph" ? [
      "12. 当前字段是长文本填空：value 可以基于知识库/上传资料进行归纳、合并和规范表述，但关键事实、数字、日期、名称、资质、人员、业绩等必须能被召回片段支撑；不得编造资料中没有的信息；不要复制“知识库1/临时资料1/相关度”等片段包装前缀。",
    ] : []),
    ...(fillMode === "short" && isPackageOrSegmentShortField(promptField) ? [
      "12. 当前字段是分包/分标段短文本：知识库/资料有对应分包、标段数量或编号时按原值填写；没有对应内容时填写 1。",
    ] : []),
    ...(fillMode === "choice-replace" ? [
      "14. 当前字段是“替换+选择”：只按要求类型/主题做语义匹配，例如业绩、人员、资质、财务等；模板里的年限、数量、日期空位、证书空位、候选项只是待替换格式，不是必须同时命中的硬条件。召回片段中只要有同类要求依据就视为命中，value 应整理为可直接替换模板选区的完整要求文本，status 为待确认。不得因为依据属于评分项、履约能力、实施人员要求、项目团队要求、证书加分项、证明材料说明，而判定为未命中或不能替换。只有召回片段完全没有该要求类型依据时，value 输出“未命中”，status 为需补充资料。不得套用模板选项、不得添加勾选符号；不要输出模板中的“无xx要求”，未命中由系统自动处理。",
    ] : []),
    "",
    knowledgeText ? `【知识库召回片段】\n${knowledgeText}` : "【知识库召回片段】\n未启用或未检索到相关片段。",
    "",
    materialText ? `【本次上传资料】\n${materialText}` : "【本次上传资料】\n未上传临时资料。",
  ].join("\n");

  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, fillMode === "paragraph" ? 1536 : 768, {
    debugFileName: "ai-fill-last.json",
    debugContext,
  });
  const rawValue = typeof parsed.value === "string" ? parsed.value.trim() : "";
  const evidence = typeof parsed.evidence === "string" && parsed.evidence.trim() ? parsed.evidence.trim() : "模型未返回明确证据片段。";
  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : "AI 基于上传资料与知识库生成";
  const contextualCitation = findModelReferencedCitation(knowledgeSnippets, materialSnippets, `${source}\n${evidence}`)
    || buildFillSourceCitation(knowledgeSnippets, materialSnippets, `${retrievalQuery} ${source} ${evidence}`);
  if (fillMode === "short" && isPackageOrSegmentShortField(promptField) && (!rawValue || parsed.status === "需补充资料")) {
    const result = createDefaultPackageOrSegmentResult("未在知识库/上传资料中检索到明确分包/分标段值，按通用规则默认填写 1。");
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "package-segment-default-one");
    return result;
  }
  if (fillMode === "choice-replace" && (!rawValue || parsed.status === "需补充资料" || isChoiceReplacementMiss(parsed, rawValue))) {
    const fallback = extractChoiceReplacementCandidate(promptField, knowledgeSnippets, materialSnippets);
    if (fallback) {
      const result = createChoiceReplacementFallbackResult(fallback);
      await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-replace-theme-fallback");
      return result;
    }
    const result = createNoRequirementChoiceResult(promptField, sourceBundle);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-replace-default-none");
    return result;
  }

  const amountChoice = fillMode === "amount-choice";
  if (amountChoice) {
    const amountValue = normalizeTemplateAmountValue(promptField, parsed.amountValue ?? parsed.value ?? "");
    const choiceValue = normalizeTaxChoiceValue(parsed.choiceValue ?? parsed.value ?? "");
    const guard = sanitizeAmountChoiceFillResult(parsed, amountValue, choiceValue, source, evidence);
    if (guard) {
      const result = attachSupplementCitation({
        ...guard,
        evidence: buildSupplementEvidence(guard.evidence, evidence),
      }, contextualCitation || systemCitation);
      await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "amount-choice-guard");
      return result;
    }
    const result = {
      value: amountValue,
      amountValue,
      choiceValue,
      status: parsed.status === "需补充资料" ? "需补充资料" : "待确认",
      confidence: clampConfidence(parsed.confidence),
      source,
      evidence,
    };
    const citedResult = applySystemCitation(result, contextualCitation || systemCitation);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, citedResult, "ok");
    return citedResult;
  }

  let value = normalizeFilledValueForTemplate(promptField, rawValue);
  const paragraphCitation = fillMode === "paragraph" && value
    ? extractParagraphSourceCandidate(promptField, { value, source, evidence, retrievalQuery, rawRetrievalQuery }, knowledgeSnippets, materialSnippets)
    : null;
  const resolvedCitation = contextualCitation
    || (paragraphCitation ? { source: paragraphCitation.source, text: paragraphCitation.sourceSnippetText || paragraphCitation.text } : null)
    || systemCitation;
  const choiceGuard = sanitizeChoiceFillResult(promptField, parsed, value, source, evidence);
  if (choiceGuard) {
    if (fillMode === "choice-replace") {
      const fallback = extractChoiceReplacementCandidate(promptField, knowledgeSnippets, materialSnippets);
      if (fallback) {
        const result = createChoiceReplacementFallbackResult(fallback);
        await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-replace-theme-fallback-guard");
        return result;
      }
      const result = createNoRequirementChoiceResult(promptField, sourceBundle);
      await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-replace-default-guard");
      return result;
    }
    const result = attachSupplementCitation({
      ...choiceGuard,
      evidence: buildSupplementEvidence(choiceGuard.evidence, evidence),
    }, resolvedCitation);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-guard");
    return result;
  }
  if (isTemplateOnlyFillEvidence(promptField, value, `${source}\n${evidence}`, `${knowledgeText}\n${materialText}`)) {
    const result = createSupplementResult("模型仅引用模板选区原文，未在知识库或上传资料中找到可支撑当前字段的依据。", resolvedCitation, evidence);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "template-only-evidence");
    return result;
  }
  const result = {
    value,
    status: parsed.status === "需补充资料" ? "需补充资料" : "待确认",
    confidence: clampConfidence(parsed.confidence),
    source,
    evidence,
  };
  const citedResult = applySystemCitation(result, resolvedCitation);
  await writeFillFinalDebugLog(runtime, debugContext, parsed, citedResult, "ok");
  return citedResult;
}
function buildFillSourceCitation(knowledgeSnippets = [], materialSnippets = [], query = "") {
  const tokens = createSearchTokens(query);
  const knowledge = knowledgeSnippets.map((item, index) => {
    const scopeName = item.scope === "global" ? "全局库" : "项目库";
    const location = item.page ? `第${item.page}页` : `片段${item.chunkIndex || index + 1}`;
    const text = String(item.text || "").trim();
    return {
      rank: index,
      score: Number(item.score || 0),
      source: `知识库${index + 1}（${scopeName}｜${item.documentName || "未命名资料"} ${location}）`,
      text,
      tokenScore: scoreText(text, tokens),
    };
  });
  const materials = materialSnippets.map((item, index) => ({
    rank: knowledge.length + index,
    score: Number(item.score || 0),
    source: `临时资料${index + 1}（${item.name || "未命名资料"}｜片段${item.chunkIndex || index + 1}）`,
    text: String(item.text || "").trim(),
    tokenScore: scoreText(item.text, tokens),
  }));
  return [...knowledge, ...materials]
    .filter((item) => item.text)
    .sort((a, b) => b.tokenScore - a.tokenScore || b.score - a.score || a.rank - b.rank)[0] || null;
}
function findModelReferencedCitation(knowledgeSnippets = [], materialSnippets = [], reference = "") {
  const text = String(reference || "");
  const knowledgeIndex = text.match(/知识库\s*(\d+)(?=[（(:：\s中提])/);
  if (knowledgeIndex) {
    const index = Number(knowledgeIndex[1]) - 1;
    const item = knowledgeSnippets[index];
    if (item) return buildFillSourceCitation([item], [], "");
  }
  const materialIndex = text.match(/(?:临时资料|上传资料)\s*(\d+)(?=[（(:：\s中提])/);
  if (materialIndex) {
    const index = Number(materialIndex[1]) - 1;
    const item = materialSnippets[index];
    if (item) return buildFillSourceCitation([], [item], "");
  }
  return null;
}
function applySystemCitation(result, citation) {
  if (!citation) {
    return {
      ...result,
      source: "未找到来源片段",
      evidence: "",
      sourceSnippetText: "",
    };
  }
  const text = citation.text.slice(0, 2000);
  return {
    ...result,
    source: citation.source,
    evidence: text,
    sourceSnippetText: text,
  };
}
function createSupplementResult(reason, citation, detail = "") {
  return attachSupplementCitation({
    value: "",
    status: "需补充资料",
    confidence: 0,
    source: "未找到可支撑当前字段的资料依据",
    evidence: buildSupplementEvidence(reason, detail),
  }, citation);
}
function buildSupplementEvidence(ruleReason, detail = "") {
  const cleanRule = String(ruleReason || "").replace(/\s+/g, " ").trim();
  const cleanDetail = String(detail || "").replace(/\s+/g, " ").trim();
  if (!cleanDetail || /模型未返回明确证据片段/.test(cleanDetail)) return cleanRule;
  if (cleanDetail.includes(cleanRule)) return cleanDetail;
  return `${cleanDetail}\n系统判断：${cleanRule}`;
}
function attachSupplementCitation(result, citation) {
  if (result?.status !== "需补充资料" || result?.sourceSnippetText) return result;
  if (!citation) {
    return {
      ...result,
      source: result.source || "未找到可参考来源片段",
      sourceSnippetText: "",
    };
  }
  const text = citation.text.slice(0, 2000);
  const preview = text.slice(0, 500);
  return {
    ...result,
    source: `未找到可支撑当前字段的资料依据；可参考 ${citation.source}`,
    evidence: `${result.evidence || "证据不足，无法直接写入。"}\n可参考相近原文：${preview}`,
    sourceSnippetText: text,
  };
}
function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export { fillField };

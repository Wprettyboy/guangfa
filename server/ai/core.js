import { searchKnowledgeBase } from "../knowledge-base.js";

export async function createKnowledgeChat(payload) {
  const message = String(payload?.message || "").trim().slice(0, 4000);
  if (!message) {
    const error = new Error("请输入聊天内容。");
    error.statusCode = 400;
    throw error;
  }

  const knowledgeOptions = payload?.knowledgeOptions && typeof payload.knowledgeOptions === "object" ? payload.knowledgeOptions : {};
  const kbIds = Array.isArray(knowledgeOptions.kbIds) ? knowledgeOptions.kbIds.filter(Boolean) : [];
  const runtime = getAiRuntimeConfig();
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: message,
    message,
    knowledgeOptions,
    debugFileName: "ai-chat-knowledge-query-last.json",
  });
  const knowledgeSnippets = knowledgeSearch.snippets;
  const knowledgeText = formatKnowledgeSnippets(knowledgeSnippets).slice(0, maxKnowledgeChars);
  const history = normalizeChatHistory(payload?.history);
  const sourceSnippets = formatChatSourceSnippets(knowledgeSnippets.slice(0, 1), knowledgeOptions.bases);
  const baseNames = Array.isArray(knowledgeOptions.bases)
    ? knowledgeOptions.bases.map((item) => item?.name).filter(Boolean).join("、")
    : "";
  const systemPrompt = [
    "你是中文招标文件制作助手，只用自然语言回答。",
    "禁止调用或输出 OnlyOffice 宏、writeMacro、functionCalling、工具调用、代码块或内部 API。",
    "优先依据已挂载知识库召回片段回答；资料不足时明确说明缺少依据，不要编造。",
    "回答必须简明扼要，优先一句话，最多两条要点。",
    "不要写“根据知识库召回片段”“此外”“引用来源”等溯源说明，来源由系统在回复下方展示。",
  ].join("\n");
  const userPrompt = [
    `当前挂载知识库：${baseNames || (kbIds.length ? kbIds.join("、") : "未挂载")}`,
    "",
    knowledgeText ? `【知识库召回片段】\n${knowledgeText}` : "【知识库召回片段】\n未检索到相关片段。",
    "",
    `用户问题：${message}`,
  ].join("\n");
  const reply = sanitizeChatReply(await callChatModel(runtime, [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userPrompt },
  ], 2048, {
    debugFileName: "ai-chat-last.json",
    debugContext: {
      message,
      knowledgeOptions: {
        enabled: knowledgeOptions.enabled !== false,
        projectId: knowledgeOptions.projectId || "default-project",
        kbIds,
        globalKbIds: Array.isArray(knowledgeOptions.globalKbIds) ? knowledgeOptions.globalKbIds.filter(Boolean) : [],
        topK: knowledgeOptions.topK || 8,
        bases: knowledgeOptions.bases || [],
      },
      rawRetrievalQuery: knowledgeSearch.rawQuery,
      retrievalQuery: knowledgeSearch.query,
      retrievalPlan: knowledgeSearch.plan,
      knowledgeCount: sourceSnippets.length,
      retrievedKnowledgeCount: knowledgeSnippets.length,
      knowledgeSnippets: sourceSnippets,
    },
  }));

  return {
    reply,
    knowledgeCount: sourceSnippets.length,
    snippets: sourceSnippets,
  };
}

export async function createAiKnowledgeSearch(payload) {
  const message = String(payload?.message || payload?.query || "").trim().slice(0, 4000);
  if (!message) return { query: "", plan: null, snippets: [] };
  const runtime = getAiRuntimeConfig();
  const knowledgeOptions = payload?.knowledgeOptions && typeof payload.knowledgeOptions === "object" ? payload.knowledgeOptions : payload || {};
  const result = await searchKnowledgeForAi(runtime, {
    rawQuery: message,
    message,
    knowledgeOptions,
    debugFileName: "ai-knowledge-search-query-last.json",
  });
  return {
    query: result.query,
    rawQuery: result.rawQuery,
    plan: result.plan,
    snippets: result.snippets,
  };
}

export async function fillField(payload) {
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
      "12. 当前字段是长文本填空：AI 只负责通过语义理解定位应复制的知识库/资料原文，value 必须逐字复制召回片段中的连续原文；不得总结、改写、扩写、压缩或自行组织语言；不要复制“知识库1/临时资料1/相关度”等片段包装前缀。",
    ] : []),
    ...(fillMode === "short" && isPackageOrSegmentShortField(promptField) ? [
      "12. 当前字段是分包/分标段短文本：知识库/资料有对应分包、标段数量或编号时按原值填写；没有对应内容时填写 1。",
    ] : []),
    ...(fillMode === "choice-replace" ? [
      "14. 当前字段是“替换+选择”：只按要求类型/主题做语义匹配，例如业绩、人员、资质、财务等；模板里的年限、数量、日期空位、证书空位、候选项只是待替换格式，不是必须同时命中的硬条件。召回片段中只要有同类要求原文就视为命中，value 直接摘取该资料原文，status 为待确认。不得因为原文属于评分项、履约能力、实施人员要求、项目团队要求、证书加分项、证明材料说明，而判定为未命中或不能替换。只有召回片段完全没有该要求类型的原文时，value 输出“未命中”，status 为需补充资料。不得套用模板选项、不得添加勾选符号、不得总结改写；不要输出模板中的“无xx要求”，未命中由系统自动处理。",
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
  if (fillMode === "paragraph" && value && !isCopiedFromSource(value, sourceBundle)) {
    const result = createSupplementResult("模型返回内容未能在知识库/上传资料召回片段中逐字定位，长文本填空不做语义改写。", contextualCitation || systemCitation, evidence);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "paragraph-not-copied");
    return result;
  }
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
    }, contextualCitation || systemCitation);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-guard");
    return result;
  }
  if (isTemplateOnlyFillEvidence(promptField, value, `${source}\n${evidence}`, `${knowledgeText}\n${materialText}`)) {
    const result = createSupplementResult("模型仅引用模板选区原文，未在知识库或上传资料中找到可填依据。", contextualCitation || systemCitation, evidence);
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
  const citedResult = applySystemCitation(result, contextualCitation || systemCitation);
  await writeFillFinalDebugLog(runtime, debugContext, parsed, citedResult, "ok");
  return citedResult;
}

function summarizeFieldForDebug(field = {}) {
  return {
    id: field.id,
    name: field.name,
    category: field.category || field.type,
    fillMode: field.fillMode,
    sourceText: field.sourceText || field.templateContext || field.answerFormat || "",
    question: field.question,
    aiInstruction: field.aiInstruction,
    page: field.page,
  };
}

function summarizeSnippetsForDebug(snippets = []) {
  return snippets.map((item, index) => ({
    index: index + 1,
    id: item.id,
    kbId: item.kbId,
    documentId: item.documentId,
    source: item.documentName || item.name || "未命名资料",
    scope: item.scope,
    chunkIndex: item.chunkIndex,
    page: item.page || "",
    score: item.score,
    text: String(item.text || "").slice(0, 1200),
  }));
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
    source: "未找到可直接写入原文",
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
    source: `未找到可直接写入原文；可参考 ${citation.source}`,
    evidence: `${result.evidence || "资料不足，无法直接写入。"}\n可参考相近原文：${preview}`,
    sourceSnippetText: text,
  };
}

function formatChatSourceSnippets(snippets = [], bases = []) {
  const baseNames = new Map((Array.isArray(bases) ? bases : []).map((base) => [base?.id, base?.name]).filter(([id, name]) => id && name));
  return summarizeSnippetsForDebug(snippets).map((item) => ({
    ...item,
    kbName: baseNames.get(item.kbId) || (item.scope === "global" ? "全局知识库" : "项目知识库"),
  }));
}

function normalizeChatHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
      const content = String(item?.content || "").trim().slice(0, 2000);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-8);
}

function sanitizeChatReply(reply) {
  const text = String(reply || "").trim();
  if (!text) return "未生成有效回复，请稍后重试。";
  if (/\b(writeMacro|functionCalling|Asc\.|Api\.)\b/i.test(text) || /运行宏|格式化文本|重写文本/.test(text)) {
    return "当前聊天机器人已禁用 OnlyOffice 宏和工具调用。请直接用自然语言提问，我会优先依据已挂载知识库回答。";
  }
  return text;
}

async function searchKnowledgeForAi(runtime, { rawQuery = "", field = {}, message = "", knowledgeOptions = {}, debugFileName = "ai-knowledge-query-last.json" } = {}) {
  const kbIds = Array.isArray(knowledgeOptions.kbIds) ? knowledgeOptions.kbIds.filter(Boolean) : [];
  const globalKbIds = Array.isArray(knowledgeOptions.globalKbIds) ? knowledgeOptions.globalKbIds.filter(Boolean) : [];
  const enabled = knowledgeOptions.enabled !== false && (kbIds.length > 0 || globalKbIds.length > 0);
  const fallbackQuery = String(rawQuery || message || "").replace(/\s+/g, " ").trim();
  if (!enabled || !fallbackQuery) return { snippets: [], rawQuery: fallbackQuery, query: "", plan: null };

  const plan = await createKnowledgeRetrievalPlan(runtime, { rawQuery: fallbackQuery, field, message, debugFileName });
  const query = plan.query || "";
  if (!query) return { snippets: [], rawQuery: fallbackQuery, query, plan };
  try {
    const snippets = await searchKnowledgeBase({
      query,
      projectId: knowledgeOptions.projectId || "default-project",
      kbIds,
      globalKbIds,
      includeGlobal: knowledgeOptions.includeGlobal,
      topK: knowledgeOptions.topK || 6,
    });
    return { snippets, rawQuery: fallbackQuery, query, plan };
  } catch {
    return { snippets: [], rawQuery: fallbackQuery, query, plan };
  }
}

async function createKnowledgeRetrievalPlan(runtime, { rawQuery = "", field = {}, message = "", debugFileName = "ai-knowledge-query-last.json" } = {}) {
  const systemPrompt = [
    "你是招投标文件知识库检索词提取器。",
    "任务：根据模板字段信息或用户问题，提取用于知识库检索的核心查询词。模板选区原文只表示“要填哪里”，不是资料来源。不要把模板整段原文、空位、复选框、占位说明直接作为查询。",
    "输出必须是严格 JSON，不要输出解释、Markdown 或思考过程。",
  ].join("\n");
  const userPrompt = [
    "输出 JSON：",
    '{"intent":"字段检索意图，10字以内","primaryQuery":"最适合直接传给知识库的一行短查询","mustTerms":["必须命中的核心词"],"shouldTerms":["可辅助召回的同义词/相关词"],"excludeTerms":["应避免干扰检索的模板占位词"]}',
    "",
    "通用规则：",
    "1. 只保留能帮助定位资料原文的业务词、实体词、条件词。",
    "2. 删除复选框符号、空白占位、模板格式词，例如：□、☑、年 月 日、个、类似项目是指、无xx要求、根据模板选区原文自动填充。",
    "3. 查询词要短，不超过 30 个中文字符；不要重复同一段文本。",
    "4. 如果字段是“替换+选择”，优先提取要查找的要求类型，而不是模板候选项。",
    "5. 如果模板里同时出现“有要求”和“无要求”，不要把“无要求”作为主查询；它只是兜底选项。",
    "6. 如果字段信息不足，只输出字段类别相关的规范查询词，不要臆造项目内容。",
    "",
    "招投标常用字段规范：",
    "- 业绩要求：intent=业绩要求；primaryQuery 优先包含：业绩要求 类似项目；shouldTerms 可包含：类似项目业绩、合同金额、已完成、新承接、正在实施、证明材料、发票。",
    "- 人员要求：intent=人员要求；primaryQuery 优先包含：人员要求 项目负责人 技术负责人；shouldTerms 可包含：项目经理、技术负责人、安全员、专职安全生产管理人员、证书、社保、资格证、职称。",
    "- 公司资质：intent=资质要求；primaryQuery 优先包含：资质要求 企业资质；shouldTerms 可包含：施工资质、劳务资质、安全生产许可证、营业执照、资质证书、专业承包、总承包。",
    "- 财务要求：intent=财务要求；primaryQuery 优先包含：财务要求 财务状况；shouldTerms 可包含：审计报告、财务报表、资产负债表、现金流量表、利润表、纳税、亏损、财务会计制度。",
    "- 信誉要求：intent=信誉要求；primaryQuery 优先包含：信誉要求 信用记录；shouldTerms 可包含：失信被执行人、重大税收违法、政府采购严重违法失信、信用中国、中国政府采购网。",
    "- 工期要求：intent=工期要求；primaryQuery 优先包含：工期 合同工期；shouldTerms 可包含：日历天、计划工期、开工日期、完工日期、进场通知。",
    "- 金额要求：intent=金额要求；primaryQuery 优先包含：最高限价 采购预算；shouldTerms 可包含：控制价、预算金额、采购金额、报价上限、履约保证金、磋商保证金。",
    "",
    "输入：",
    `字段名称：${field.name || (message ? "知识库问答" : "")}`,
    `字段类型：${field.category || field.type || (message ? "聊天提问" : "")}`,
    `填充模式：${field.fillMode || ""}`,
    `模板选区原文：${field.sourceText || ""}`,
    `字段说明：${field.question || ""}`,
    `用户指令：${field.aiInstruction || message || ""}`,
    `原始检索文本：${rawQuery}`,
  ].join("\n");

  let extractorError = "";
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 512, {
    debugFileName,
    debugContext: { rawQuery, field: summarizeFieldForDebug(field), message },
  }).catch((error) => {
    extractorError = error.message || "检索词提取失败";
    return {};
  });
  const plan = normalizeKnowledgeRetrievalPlan(parsed, rawQuery);
  return {
    ...plan,
    extractorError,
    query: buildKnowledgeSearchQuery(plan),
  };
}

function normalizeKnowledgeRetrievalPlan(parsed = {}, rawQuery = "") {
  return {
    intent: cleanKnowledgeQueryTerm(parsed.intent).slice(0, 10),
    primaryQuery: cleanKnowledgeQueryTerm(parsed.primaryQuery).slice(0, 30),
    mustTerms: normalizeKnowledgeTermList(parsed.mustTerms),
    shouldTerms: normalizeKnowledgeTermList(parsed.shouldTerms),
    excludeTerms: normalizeKnowledgeTermList(parsed.excludeTerms),
    rawQuery: String(rawQuery || "").replace(/\s+/g, " ").trim(),
  };
}

function normalizeKnowledgeTermList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanKnowledgeQueryTerm).filter(Boolean))].slice(0, 12);
}

function cleanKnowledgeQueryTerm(value) {
  return String(value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, " ")
    .replace(/年\s*月\s*日(?:\s*时\s*分)?/g, " ")
    .replace(/根据模板选区原文自动填充|类似项目是指|无.{0,12}要求/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKnowledgeSearchQuery(plan) {
  const parts = [plan.primaryQuery, ...plan.mustTerms, ...plan.shouldTerms]
    .map(cleanKnowledgeQueryTerm)
    .filter(Boolean)
    .filter((item) => !plan.excludeTerms.some((term) => term && normalizeForSearch(item).includes(normalizeForSearch(term))));
  const uniqueParts = [];
  for (const part of parts) {
    const normalizedPart = normalizeForSearch(part);
    if (uniqueParts.some((item) => normalizeForSearch(item).includes(normalizedPart))) continue;
    uniqueParts.push(part);
  }
  const query = uniqueParts.join(" ").slice(0, 80).trim();
  return query;
}

function buildFieldRetrievalQuery(field) {
  return [
    field.sourceText,
    field.templateContext || field.answerFormat,
    field.category || field.type,
    getFillModeLabel(normalizeFillMode(field)),
    field.aiInstruction || field.question,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatKnowledgeSnippets(snippets) {
  return snippets
    .map((item, index) => {
      const scopeName = item.scope === "global" ? "全局库" : "项目库";
      const location = item.page ? ` 第${item.page}页` : ` 片段${item.chunkIndex || index + 1}`;
      return `知识库${index + 1}（${scopeName}｜${item.documentName || "未命名资料"}${location}｜相关度${item.score || 0}）：\n${item.text || ""}`;
    })
    .join("\n\n");
}

function selectMaterialSnippets(materials, query, topK) {
  const tokens = createSearchTokens(query);
  const chunks = [];
  materials.forEach((item, materialIndex) => {
    chunkText(item.text).forEach((text, chunkIndex) => {
      const score = scoreText(text, tokens);
      chunks.push({
        materialIndex,
        chunkIndex: chunkIndex + 1,
        name: item.name || "未命名资料",
        text,
        score,
      });
    });
  });

  const ranked = chunks
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, topK);

  if (ranked.length > 0) return ranked;
  return chunks.slice(0, Math.min(topK, 2));
}

function formatMaterialSnippets(snippets) {
  return snippets
    .map((item, index) => {
      const score = Number(item.score || 0).toFixed(3);
      return `临时资料${index + 1}（${item.name}｜片段${item.chunkIndex}｜相关度${score}）：\n${item.text}`;
    })
    .join("\n\n");
}

function chunkText(text) {
  const cleanText = normalizeText(text);
  if (!cleanText) return [];
  if (cleanText.length <= materialChunkSize) return [cleanText];
  const chunks = [];
  for (let index = 0; index < cleanText.length; index += materialChunkSize - materialChunkOverlap) {
    const chunk = cleanText.slice(index, index + materialChunkSize).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function scoreText(text, tokens) {
  const normalizedText = normalizeForSearch(text);
  return tokens.reduce((sum, token) => {
    if (!token || !normalizedText.includes(token)) return sum;
    return sum + Math.max(1, token.length);
  }, 0) / 100;
}

function createSearchTokens(query) {
  const raw = String(query || "");
  const normalized = normalizeForSearch(raw);
  const parts = raw
    .split(/[\s,，。；;、:：()（）]+/)
    .map(normalizeForSearch)
    .filter((item) => item.length >= 2);
  return [...new Set([normalized, ...parts, ...expandDomainSearchTokens(normalized)].filter((item) => item.length >= 2))];
}

function expandDomainSearchTokens(value) {
  const tokens = [];
  const add = (...items) => tokens.push(...items.map(normalizeForSearch));

  if (/项目名称|工程名称|项目名|工程名|采购项目/.test(value)) add("项目名称", "工程名称");
  if (/项目概况|工程概况|建设规模|工程建设规模|建筑面积|建设内容|长文本填空/.test(value)) add("项目概况", "工程概况", "工程建设规模", "总建筑面积", "建设内容", "服务内容", "技术要求", "商务要求");
  if (/采购范围|实施范围|服务范围|主要施工内容|工作内容|包括但不限于|长文本填空/.test(value)) add("采购范围", "实施范围", "服务范围", "主要施工内容", "施工图范围内", "工作内容", "包括但不限于", "分项内容");
  if (/评审办法|评标办法|综合评分|综合评估|最低投标价/.test(value)) add("评审办法", "评标办法", "综合评分法", "综合评估法", "最低投标价法");
  if (/业绩|类似项目|合同金额|发票/.test(value)) add("业绩要求", "类似项目业绩", "合同金额");
  if (/评分|加分|加\d+分|履约能力/.test(value)) add("履约能力", "加2分", "最多加");
  if (/人员|技术负责人|安全员|项目负责人|专职安全/.test(value)) add("人员要求", "技术负责人", "专职安全生产管理人员");
  if (/资质|资格|安全生产许可证|劳务资质/.test(value)) add("资质要求", "施工劳务资质", "安全生产许可证");
  if (/财务|无亏损|亏损/.test(value)) add("财务要求", "无财务要求", "无亏损", "近三年", "近3年", "财务报表");
  if (/工期|合同工期|日历天|进场通知/.test(value)) add("工期", "合同工期", "日历天");
  if (/付款|支付|进度款|结算款|质保金|缺陷责任/.test(value)) add("付款方式", "进度款", "结算款", "质保金");
  if (/分包|分标段|标段划分/.test(value)) add("分包", "分标段", "标段划分", "分包数量", "标段数量");
  if (/金额选择|含税|不含税|最高限价|控制价|预算金额|报价|费用/.test(value)) add("最高限价", "控制价", "预算金额", "含税", "不含税", "万元", "元");

  return tokens;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}


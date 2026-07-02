import { searchKnowledgeBase } from "./knowledge-base.js";
import { mkdir, writeFile } from "node:fs/promises";

const defaultBaseUrl = "https://api.deepseek.com";
const defaultModel = "deepseek-v4-flash";
const maxKnowledgeChars = 9000;
const maxMaterialChars = 5000;
const materialChunkSize = 1000;
const materialChunkOverlap = 120;

export function aiFillMiddleware() {
  return async function handleAiFill(request, response, next) {
    if (request.method !== "POST" || !["/api/ai/fill-field", "/api/ai/format-outline-plan", "/api/ai/chat", "/api/ai/knowledge-search"].includes(request.url)) {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = request.url === "/api/ai/format-outline-plan"
        ? await createFormatOutlinePlan(payload)
        : request.url === "/api/ai/chat"
          ? await createKnowledgeChat(payload)
          : request.url === "/api/ai/knowledge-search"
            ? await createAiKnowledgeSearch(payload)
          : await fillField(payload);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "AI 处理失败",
      });
    }
  };
}

async function createKnowledgeChat(payload) {
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

async function createAiKnowledgeSearch(payload) {
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

async function createFormatOutlinePlan(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 300) : [];
  const onlyOfficeOutline = Array.isArray(payload?.onlyOfficeOutline) ? payload.onlyOfficeOutline.slice(0, 300) : [];
  const auditRules = Array.isArray(payload?.auditRules) ? payload.auditRules.map((rule) => String(rule || "").trim()).filter(Boolean).slice(0, 20) : [];
  const userInstruction = String(payload?.userInstruction || "").trim().slice(0, 1000);
  if (candidates.length === 0) {
    const error = new Error("没有可供 AI 判断的标题/大纲候选段落。");
    error.statusCode = 400;
    throw error;
  }

  const runtime = getAiRuntimeConfig();
  const systemPrompt = "你是中文 Word 文档标题体系审查助手。只判断标题/大纲层级，不改写正文文本。只输出严格 JSON。";
  const promptCandidates = candidates.map((item) => ({
    outlineIndex: item.outlineIndex,
    displayLevel: Number.isInteger(Number(item.outlineLevel)) ? `L${Number(item.outlineLevel) + 1}` : "",
    title: String(item.text || "").slice(0, 120),
    styleName: item.styleName,
    sourceIssue: item.sourceIssue,
  }));
  const userPrompt = [
    "请根据 OnlyOffice 原生导航大纲表，判断每行 displayLevel 是否需要调整。",
    "只能输出一行 JSON，不要解释，不要 Markdown，不要分析过程。",
    "只输出需要修复的段落；不需要修复时输出 {\"targets\":[]}。",
    "",
    "输出 JSON：",
    '{"targets":[{"outlineIndex":1,"operation":"demote|heading","level":0,"reason":"4字原因"}]}',
    "",
    "规则：",
    "1. outlineIndex 和 title 是定位依据，不得要求修改 title 文本。",
    "2. 只调整 displayLevel：operation=demote 表示改为正文并退出 Word 大纲。",
    "3. operation=heading 表示保留为标题但调整层级，level 使用 0/1/2，分别代表 L1/L2/L3。",
    "4. 先从本文档多数大纲项中归纳编号形态、样式名称、层级分布，再判断异常；不要套用固定“第X章/一、/1.”层级模板。",
    "5. 严禁把明显标题降为正文：短标题、章节标题、无句末标点的“一、xxx”“二、xxx”“1.xxx”“（一）xxx”应保留为标题，只能在必要时调整层级。",
    "6. 只有空标题、正文长段、说明性句子、承诺正文、单位落款才输出 demote。",
    "7. 不要新增、删除、改写段落文字。",
    "8. 只返回候选段落里的 outlineIndex。",
    "9. 不确定的项目不要输出，留给人工确认。",
    "10. reason 不超过 4 个汉字。",
    "",
    "审查规则：",
    JSON.stringify(auditRules),
    "",
    "用户调整要求：",
    userInstruction || "无",
    "",
    "OnlyOffice 原生大纲（与左侧导航显示一致）：",
    JSON.stringify(promptCandidates),
  ].join("\n");

  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 3072, {
    debugFileName: "ai-outline-last.json",
    expectedArrayKey: "targets",
    partialArrayKey: "targets",
    debugContext: { candidateCount: candidates.length, candidates: promptCandidates, onlyOfficeOutline, auditRules, userInstruction },
  });
  if (!Array.isArray(parsed.targets)) {
    return { targets: [] };
  }
  const allowedByParagraph = new Map(candidates.map((item) => [Number(item.paragraphIndex), item]));
  const allowedByOutline = new Map(candidates.map((item) => [Number(item.outlineIndex), item]));
  const targets = parsed.targets
    .map((item) => {
      const source = allowedByOutline.get(Number(item.outlineIndex)) || allowedByParagraph.get(Number(item.paragraphIndex));
      if (!source) return null;
      const paragraphIndex = Number(source.paragraphIndex);
      const operation = item.operation === "heading" ? "heading" : item.operation === "demote" ? "demote" : "keep";
      if (operation === "demote" && !isSafeOutlineDemoteTarget(source)) return null;
      const rawLevel = Number(item.level);
      return {
        paragraphIndex,
        outlineIndex: Number.isInteger(Number(source.outlineIndex)) ? Number(source.outlineIndex) : null,
        outlineLevel: Number.isInteger(Number(source.outlineLevel)) ? Number(source.outlineLevel) : null,
        text: source.text,
        operation,
        level: operation === "heading" && Number.isInteger(rawLevel) ? Math.max(0, Math.min(2, rawLevel)) : null,
        reason: String(item.reason || "").slice(0, 120),
      };
    })
    .filter((item) => item && item.operation !== "keep");

  await writeAiDebugLog("ai-outline-last-final.json", {
    createdAt: new Date().toISOString(),
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    candidateCount: candidates.length,
    modelTargets: parsed.targets,
    returnedTargets: targets,
  });

  return { targets };
}

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
      "12. 当前字段是长文本填空：AI 只负责通过语义理解定位应复制的知识库/资料原文，value 必须逐字复制召回片段中的连续原文；不得总结、改写、扩写、压缩或自行组织语言；不要复制“知识库1/临时资料1/相关度”等片段包装前缀。",
    ] : []),
    ...(fillMode === "short" && isPackageOrSegmentShortField(promptField) ? [
      "12. 当前字段是分包/分标段短文本：知识库/资料有对应分包、标段数量或编号时按原值填写；没有对应内容时填写 1。",
    ] : []),
    ...(fillMode === "choice-replace" ? [
      "14. 当前字段是“替换+选择”：先按要求类型/主题做语义匹配，例如业绩、人员、资质、财务等；模板里的年限、数量、日期空位、候选项只是待替换格式，不是必须同时命中的硬条件。召回片段中只要有同类要求原文（包括评分项、履约能力、证明材料说明等相近表述）就视为命中，value 直接摘取该资料原文，status 为待确认。只有召回片段完全没有该要求类型的原文时，value 输出“未命中”，status 为需补充资料。不得套用模板选项、不得添加勾选符号、不得总结改写；不要输出模板中的“无xx要求”，未命中由系统自动处理。",
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
  if (fillMode === "short" && isPackageOrSegmentShortField(promptField) && (!rawValue || parsed.status === "需补充资料")) {
    const result = createDefaultPackageOrSegmentResult("未在知识库/上传资料中检索到明确分包/分标段值，按通用规则默认填写 1。");
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "package-segment-default-one");
    return result;
  }
  if (fillMode === "choice-replace" && (!rawValue || parsed.status === "需补充资料" || isChoiceReplacementMiss(parsed, rawValue))) {
    const result = createNoRequirementChoiceResult(promptField, sourceBundle);
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "choice-replace-default-none");
    return result;
  }

  const amountChoice = fillMode === "amount-choice";
  const evidence = typeof parsed.evidence === "string" && parsed.evidence.trim() ? parsed.evidence.trim() : "模型未返回明确证据片段。";
  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : "AI 基于上传资料与知识库生成";
  const contextualCitation = findModelReferencedCitation(knowledgeSnippets, materialSnippets, `${source}\n${evidence}`)
    || buildFillSourceCitation(knowledgeSnippets, materialSnippets, `${retrievalQuery} ${source} ${evidence}`);
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

async function callJsonModel(runtime, systemPrompt, userPrompt, maxTokens, options = {}) {
  const { baseUrl, model, apiKey } = runtime;
  const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocalEndpoint) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  let apiResponse;
  try {
    apiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        ...(isLocalEndpoint ? { reasoning: false } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (fetchError) {
    const error = new Error(`AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
    error.statusCode = 502;
    throw error;
  }

  if (!apiResponse.ok) {
    const text = await apiResponse.text();
    const error = new Error(`AI 接口返回异常：${apiResponse.status} ${text.slice(0, 160)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = await apiResponse.json();
  const content = stripThinking(data?.choices?.[0]?.message?.content || "{}");
  const parsed = parseModelJson(content);
  if (options.partialArrayKey && !Array.isArray(parsed?.[options.partialArrayKey])) {
    const partialItems = parsePartialJsonObjects(content);
    if (partialItems.length > 0) parsed[options.partialArrayKey] = partialItems;
  }
  if (options.debugFileName) {
    await writeAiDebugLog(options.debugFileName, {
      createdAt: new Date().toISOString(),
      model,
      baseUrl,
      maxTokens,
      context: options.debugContext || {},
      systemPrompt,
      userPrompt,
      finishReason: data?.choices?.[0]?.finish_reason || "",
      usage: data?.usage || null,
      parsed,
      content,
    });
  }
  return parsed;
}

async function callChatModel(runtime, messages, maxTokens, options = {}) {
  const { baseUrl, model, apiKey } = runtime;
  const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocalEndpoint) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  let apiResponse;
  try {
    apiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(isLocalEndpoint ? { reasoning: false } : {}),
        messages,
      }),
    });
  } catch {
    const error = new Error(`AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
    error.statusCode = 502;
    throw error;
  }

  if (!apiResponse.ok) {
    const text = await apiResponse.text();
    const error = new Error(`AI 接口返回异常：${apiResponse.status} ${text.slice(0, 160)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = await apiResponse.json();
  const content = stripThinking(data?.choices?.[0]?.message?.content || "").trim();
  if (options.debugFileName) {
    await writeAiDebugLog(options.debugFileName, {
      createdAt: new Date().toISOString(),
      model,
      baseUrl,
      maxTokens,
      context: options.debugContext || {},
      messages,
      finishReason: data?.choices?.[0]?.finish_reason || "",
      usage: data?.usage || null,
      content,
    });
  }
  return content;
}

async function writeAiDebugLog(fileName, payload) {
  try {
    const logsDir = new URL("../logs/", import.meta.url);
    await mkdir(logsDir, { recursive: true });
    await writeFile(new URL(fileName, logsDir), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Debug logging must not break the user-facing AI workflow.
  }
}

async function writeFillFinalDebugLog(runtime, debugContext, parsed, result, reason) {
  await writeAiDebugLog("ai-fill-last-final.json", {
    createdAt: new Date().toISOString(),
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    context: debugContext,
    modelParsed: parsed,
    returnedResult: result,
    finalReason: reason,
  });
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

function getAiRuntimeConfig() {
  const provider = process.env.AI_PROVIDER === "cloud" ? "cloud" : process.env.AI_PROVIDER === "local" ? "local" : "";
  if (provider === "local") {
    return {
      baseUrl: process.env.LOCAL_LLM_BASE_URL || process.env.AI_BASE_URL || defaultBaseUrl,
      model: process.env.LOCAL_LLM_MODEL || process.env.AI_MODEL || defaultModel,
      apiKey: process.env.LOCAL_LLM_API_KEY || "",
    };
  }
  if (provider === "cloud") {
    return {
      baseUrl: process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || defaultBaseUrl,
      model: process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || defaultModel,
      apiKey: process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
    };
  }
  return {
    baseUrl: process.env.LOCAL_LLM_BASE_URL || process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || defaultBaseUrl,
    model: process.env.LOCAL_LLM_MODEL || process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || defaultModel,
    apiKey: process.env.LOCAL_LLM_API_KEY || process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
  };
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
  if (mode === "paragraph") return "长文本填空应输出资料中的完整描述，可为多句或一段；不要为了追求简短而删掉建设规模、范围边界、数量、地点、对象等关键信息。不得输出字段标签和序号。";
  if (mode === "date") return "日期填空只输出资料明确支持的日期或时间，优先使用模板要求的中文年月日/年月日时分格式；模板有时分空位时必须输出到时、分；不得输出字段标签、解释或无依据日期。";
  if (mode === "amount") return "金额填空只输出资料明确支持的金额，保留模板需要的单位；不得输出字段标签、解释或无依据金额。";
  if (mode === "choice") return "选择填空只输出被选择的选项文本；若模板选区已列出 □/☐/○/〇/▢ 等候选项，只判断应选哪一项，不输出整段原文、不改写选项文案。";
  if (mode === "choice-replace") return "替换选择填空先按要求类型/主题判断召回片段是否有同类原文；不要把模板里的年限、数量、日期空位当成硬性匹配条件。有同类原文就摘取资料原文作为 value；完全没有同类原文才输出“未命中”、status 输出“需补充资料”，系统会自动转为模板中的“无xx要求”。";
  if (mode === "amount-choice") return "金额选择填空必须同时判断金额和候选项：amountValue 输出按模板单位换算后的金额纯数字，choiceValue 输出应勾选的模板选项文本；不要输出整段原文。";
  return "短文本填空只输出要写入空白处的纯值，不得包含字段标签、序号、冒号、前后固定文本、句号或解释说明。";
}

function getFillOutputJsonPrompt(mode) {
  if (mode === "amount-choice") {
    return '{"value":"金额纯数字","amountValue":"金额纯数字","choiceValue":"含税或不含税","status":"待确认或需补充资料","confidence":0-100,"source":"资料名或位置","evidence":"金额和含税状态的一句可溯源证据"}';
  }
  if (mode === "choice-replace") {
    return '{"value":"命中时为摘取的资料原文；未命中时为未命中","status":"待确认或需补充资料","confidence":0-100,"source":"资料名或位置","evidence":"命中的原文依据或未命中原因"}';
  }
  return '{"value":"字段填充值","status":"待确认或需补充资料","confidence":0-100,"source":"资料名或位置","evidence":"一句可溯源证据"}';
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

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function stripThinking(content) {
  return String(content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function parsePartialJsonObjects(content) {
  const text = String(content || "");
  const items = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== "}") continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const parsed = JSON.parse(text.slice(start, index + 1));
      if (parsed && typeof parsed === "object" && (Number.isFinite(Number(parsed.paragraphIndex)) || Number.isFinite(Number(parsed.outlineIndex)))) items.push(parsed);
    } catch {}
    start = -1;
  }

  return items;
}

function isSafeOutlineDemoteTarget(candidate) {
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "空标题" || candidate?.sourceIssue === "onlyoffice-empty-outline" || candidate?.isEmptyOutline) return true;
  if (isProtectedOutlineHeading(text)) return false;
  if (/[。；;]$/.test(text)) return true;
  if (text.length > 42) return true;
  if (text.length > 24 && /[，,。；;：:]/.test(text)) return true;
  if (/供应商名称|盖章|公章|日期/.test(text)) return true;
  return false;
}

function isProtectedOutlineHeading(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || /[。；;：:]$/.test(value)) return false;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,60}$/.test(value)) return true;
  if (/^（[一二三四五六七八九十]+）\S{1,60}$/.test(value)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．]?\S{1,48}$/.test(value)) return true;
  return false;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("请求 JSON 格式错误");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

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
    if (request.method !== "POST" || !["/api/ai/fill-field", "/api/ai/format-outline-plan"].includes(request.url)) {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = request.url === "/api/ai/format-outline-plan" ? await createFormatOutlinePlan(payload) : await fillField(payload);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "AI 处理失败",
      });
    }
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
  const retrievalQuery = buildFieldRetrievalQuery(promptField);
  const knowledgeOptions = { ...(payload?.knowledgeOptions || {}) };
  if (fillMode === "paragraph" || fillMode === "list") knowledgeOptions.topK = Math.max(Number(knowledgeOptions.topK || 0), 10);
  const knowledgeSnippets = await searchKnowledgeForField(promptField, knowledgeOptions, retrievalQuery);
  const materialSnippets = selectMaterialSnippets(materials, retrievalQuery, knowledgeSnippets.length > 0 ? 4 : 8);
  const materialText = formatMaterialSnippets(materialSnippets).slice(0, maxMaterialChars);
  const knowledgeText = formatKnowledgeSnippets(knowledgeSnippets).slice(0, maxKnowledgeChars);
  const sourceBundle = `${knowledgeText}\n${materialText}`;
  const authoritativeLocation = extractAuthoritativeLocation(promptField, sourceBundle);
  if (authoritativeLocation) return authoritativeLocation;
  const authoritativeProjectName = extractAuthoritativeProjectName(promptField, sourceBundle);
  if (authoritativeProjectName) return authoritativeProjectName;

  if (!materialText.trim() && !knowledgeText.trim()) {
    return {
      value: "",
      status: "需补充资料",
      confidence: 0,
      source: "未上传资料",
      evidence: "当前没有可用于填充的资料文本，也没有检索到知识库片段，请先上传资料或维护知识库。",
    };
  }

  const runtime = getAiRuntimeConfig();
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
    "4. value 只输出将被写入输入点或替换选区的内容，不要附带模板字段标签、固定前后缀或解释。",
    "5. 必须先判断字段语义再填值：名称字段填名称，地点/地址字段填地点或地址，工期字段填期限，金额字段填金额，范围字段填范围；不要把资料中其他明确但语义不匹配的信息填入当前字段。",
    "6. 对业绩要求、人员要求、资质要求等选择型字段：只能返回资料能明确支持的选项或完整替换段；不得复制模板中的空白占位、证明材料、社保/证书附件说明；资料不足时 value 为空。",
    "7. 不要输出解释性短语，例如“类似项目是指...”，除非这句话本身就是模板原文或资料原文。",
    "8. evidence 和 source 必须来自资料内容或知识库片段，不得写“模板选区原文”或把模板选区当依据。",
    "9. 知识库片段与临时资料都可作为依据；如果二者冲突，优先采用字段上下文匹配度更高、证据更明确的内容。",
    "10. 知识库片段是当前招标/采购文件的编制依据，可能来自技术文件、项目资料、上游审批、历史招采说明或命名规则；不要因为片段出现“后续”“分包”“统一使用”等上下文词就排除它。",
    "11. 对项目名称/工程名称字段，若资料写有“名称统一使用……”“项目名称为……”“工程名称为……”，应视为当前模板的权威命名依据，直接提取引号或冒号后的完整名称。",
    ...(fillMode === "amount-choice" ? [
      `12. 当前字段是“金额+勾选”复合字段，模板金额单位为“${getTemplateAmountUnit(promptField) || "未识别"}”。amountValue 必须按模板单位换算后输出，不要带单位；例如资料为 300 万元且模板单位为元，则 amountValue 为 3000000；资料为 3000000 元且模板单位为万元，则 amountValue 为 300。`,
      "13. choiceValue 只能输出模板候选项中的“含税”或“不含税”。金额或含税状态任一项没有资料依据时，status 必须为需补充资料。",
    ] : []),
    "",
    knowledgeText ? `【知识库召回片段】\n${knowledgeText}` : "【知识库召回片段】\n未启用或未检索到相关片段。",
    "",
    materialText ? `【本次上传资料】\n${materialText}` : "【本次上传资料】\n未上传临时资料。",
  ].join("\n");

  const debugContext = {
    field: summarizeFieldForDebug(promptField),
    fillMode,
    retrievalQuery,
    knowledgeCount: knowledgeSnippets.length,
    materialCount: materialSnippets.length,
    knowledgeSnippets: summarizeSnippetsForDebug(knowledgeSnippets),
    materialSnippets: summarizeSnippetsForDebug(materialSnippets),
  };
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, fillMode === "paragraph" || fillMode === "list" ? 1536 : 768, {
    debugFileName: "ai-fill-last.json",
    debugContext,
  });
  const amountChoice = fillMode === "amount-choice";
  const evidence = typeof parsed.evidence === "string" && parsed.evidence.trim() ? parsed.evidence.trim() : "模型未返回明确证据片段。";
  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : "AI 基于上传资料与知识库生成";
  if (amountChoice) {
    const amountValue = normalizeTemplateAmountValue(promptField, parsed.amountValue ?? parsed.value ?? "");
    const choiceValue = normalizeTaxChoiceValue(parsed.choiceValue ?? parsed.value ?? "");
    const guard = sanitizeAmountChoiceFillResult(parsed, amountValue, choiceValue, source, evidence);
    if (guard) {
      await writeFillFinalDebugLog(runtime, debugContext, parsed, guard, "amount-choice-guard");
      return guard;
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
    await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "ok");
    return result;
  }

  const value = normalizeFilledValueForTemplate(promptField, typeof parsed.value === "string" ? parsed.value.trim() : "");
  const choiceGuard = sanitizeChoiceFillResult(promptField, parsed, value, source, evidence);
  if (choiceGuard) {
    await writeFillFinalDebugLog(runtime, debugContext, parsed, choiceGuard, "choice-guard");
    return choiceGuard;
  }
  if (isTemplateOnlyFillEvidence(promptField, value, `${source}\n${evidence}`, `${knowledgeText}\n${materialText}`)) {
    const result = {
      value: "",
      status: "需补充资料",
      confidence: 0,
      source: "未找到资料依据",
      evidence: "模型仅引用模板选区原文，未在知识库或上传资料中找到可填依据。",
    };
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
  await writeFillFinalDebugLog(runtime, debugContext, parsed, result, "ok");
  return result;
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
    source: item.documentName || item.name || "未命名资料",
    scope: item.scope,
    chunkIndex: item.chunkIndex,
    page: item.page || "",
    score: item.score,
    text: String(item.text || "").slice(0, 1200),
  }));
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

async function searchKnowledgeForField(field, options, query = "") {
  if (options.enabled === false) return [];
  if (!query.trim()) return [];
  try {
    return await searchKnowledgeBase({
      query,
      projectId: options.projectId || "default-project",
      kbIds: Array.isArray(options.kbIds) ? options.kbIds : [],
      topK: options.topK || 6,
    });
  } catch {
    return [];
  }
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
  return ["short", "paragraph", "list", "choice", "table", "amount-choice"].includes(mode) ? mode : inferFillMode(field);
}

function normalizeFieldCategory(value) {
  const category = String(value || "").trim();
  return !category || category === "短文本" ? "填空" : category;
}

function describeFieldContract(field = {}, fillMode = normalizeFillMode(field)) {
  const category = normalizeFieldCategory(field.category || field.type);
  const writeMode = field.writeMode || (category === "替换" || category === "单选项" ? "replace-selection" : "insert-at-input-point");
  const writeLabel = writeMode === "replace-selection"
    ? "替换标注选区"
    : field.hasInputPoint || field.inputPoint?.bookmarkName
      ? "写入已标记输入点"
      : "需要输入点，缺失时不得猜测位置";
  return `类别=${category}；输出=${getFillModeLabel(fillMode)}；写入=${writeLabel}`;
}

function inferFillMode(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type);
  const context = [
    field.sourceText,
    field.templateContext,
    field.answerFormat,
    field.question,
    field.aiInstruction,
    field.name,
  ].filter(Boolean).join(" ");
  if (isAmountChoiceContext(context)) return "amount-choice";
  if (category === "单选项" || /□|☐|○|〇|▢|☑|✓|✔|单选|多选|是否|有无/.test(context)) return "choice";
  if (category === "表格字段" || /表格|清单表|明细表|报价表|分项表/.test(context)) return "table";
  if (/包括但不限于|包括|包含|不限于|清单|配置|分项|主要施工内容|工作内容|采购范围|实施范围|服务范围/.test(context)) return "list";
  if (/内容|规模|范围|概况|要求|服务内容|建设内容|实施内容|技术要求|商务要求|项目详细要求/.test(context)) return "paragraph";
  return "short";
}

function getFillModeLabel(mode) {
  return {
    short: "短值填空",
    paragraph: "段落填空",
    list: "清单填空",
    choice: "选择填空",
    table: "表格填空",
    "amount-choice": "金额选择填空",
  }[mode] || "短值填空";
}

function getFillModePromptRule(mode) {
  if (mode === "paragraph") return "段落填空应输出资料中的完整描述，可为多句或一段；不要为了追求简短而删掉建设规模、范围边界、数量、地点、对象等关键信息。不得输出字段标签和序号。";
  if (mode === "list") return "清单填空应完整覆盖资料中的分项内容，保留“包括但不限于”对应的范围、分项或施工内容；可使用顿号、分号或原资料序号，不要压缩成一个短名词。不得输出字段标签和序号。";
  if (mode === "choice") return "选择填空只输出被选择的选项文本；若模板选区已列出 □/☐/○/〇/▢ 等候选项，只判断应选哪一项，不输出整段原文、不改写选项文案。";
  if (mode === "amount-choice") return "金额选择填空必须同时判断金额和候选项：amountValue 输出按模板单位换算后的金额纯数字，choiceValue 输出应勾选的模板选项文本；不要输出整段原文。";
  if (mode === "table") return "表格填空按当前单元格需要输出，保持简洁，但不得省略资料中该单元格必需的信息。";
  return "短值填空只输出要写入空白处的纯值，不得包含字段标签、序号、冒号、前后固定文本、句号或解释说明。";
}

function getFillOutputJsonPrompt(mode) {
  if (mode === "amount-choice") {
    return '{"value":"金额纯数字","amountValue":"金额纯数字","choiceValue":"含税或不含税","status":"待确认或需补充资料","confidence":0-100,"source":"资料名或位置","evidence":"金额和含税状态的一句可溯源证据"}';
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
  if (field.type !== "单选项") return text;

  const context = String(field.templateContext || field.answerFormat || field.question || "").replace(/\s+/g, " ").trim();
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

function sanitizeChoiceFillResult(field, parsed, value, source, evidence) {
  if (!isChoiceField(field)) return null;
  const status = String(parsed?.status || "").trim();
  if (status === "需补充资料") return createMissingChoiceResult(source, evidence || "资料不足，选择型字段不写入。");
  if (!String(value || "").trim()) return createMissingChoiceResult(source, "未返回可写入的选择值。");

  const reasonText = `${source || ""}\n${evidence || ""}`;

  if (looksLikeUnfilledChoiceTemplate(value) || looksLikeChoiceProofNote(value)) {
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
  if (targetUnit === "元" && amount.unit === "万元") number *= 10000;
  if (targetUnit === "万元" && amount.unit === "元") number /= 10000;
  return formatAmountNumber(number);
}

function parseAmountWithUnit(value) {
  const text = String(value || "").replace(/，/g, ",");
  const match = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  const unitText = text.slice(Math.max(0, match.index - 4), match.index + match[0].length + 4);
  const unit = /万元|万/.test(unitText) ? "万元" : /元/.test(unitText) ? "元" : "";
  return { number, unit };
}

function getTemplateAmountUnit(field = {}) {
  const context = String(field.sourceText || field.templateContext || field.answerFormat || field.question || "");
  const blankUnit = context.match(/(?:_{2,}|＿+|—+|-{2,}|\s{2,})\s*(万元|元)/);
  if (blankUnit) return blankUnit[1];
  const labelUnit = context.match(/(?:金额|限价|报价|费用|预算)[^。；;]{0,40}[：:]\s*(万元|元)/);
  return labelUnit?.[1] || "";
}

function formatAmountNumber(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(6))).replace(/\.0+$/, "");
}

function isChoiceField(field = {}) {
  return normalizeFieldCategory(field.category || field.type) === "单选项" || normalizeFillMode(field) === "choice";
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

function looksLikeUnfilledChoiceTemplate(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /[□☐○〇▢]|_{2,}|＿{2,}|—{2,}| 年 月 日|不少于\s*个|不少于 个|类似项目是指[:：]\s*[。；;]?|具有\s*证书|具有\s*相关专业\s*级|省级及以上\s*部门|其他人员[:：]\s*[。；;]?|（(?:业绩|人员业绩)要求）/.test(text);
}

function looksLikeChoiceProofNote(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return /证明材料须提供|复印件|社保缴费证明|附以上人员|验收证明材料|合同协议|发票|身份证|聘用合同|本项目不接受退休返聘/.test(text);
}

function isTemplateOnlyFillEvidence(field, value, evidenceText, externalText) {
  if (String(field?.type || field?.category || "").includes("单选")) return false;
  if (!value || !/(模板选区|选区原文|模板原文)/.test(String(evidenceText || ""))) return false;
  const needle = normalizeForSearch(value);
  return needle.length >= 2 && !normalizeForSearch(externalText).includes(needle);
}

function extractAuthoritativeLocation(field, sourceText) {
  const fieldText = normalizeForSearch([
    field?.sourceText,
    field?.templateContext,
    field?.category,
    field?.type,
    field?.question,
    field?.aiInstruction,
  ].filter(Boolean).join(" "));
  if (!/(建设地点|项目地点|工程地点|实施地点|服务地点|地址|地点)/.test(fieldText)) return null;

  const source = String(sourceText || "");
  const patterns = [
    /(?:位于|坐落于)\s*([^，。；;\n]{4,60})/,
    /(?:建设地点|项目地点|工程地点|实施地点|服务地点|地址)\s*(?:为|是|：|:)?\s*([^，。；;\n]{4,60})/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = cleanLocationValue(match?.[1]);
    if (!value) continue;
    return {
      value,
      status: "待确认",
      confidence: 94,
      source: "知识库地点信息",
      evidence: `资料明确写明项目地点为“${value}”。`,
    };
  }
  return null;
}

function cleanLocationValue(value) {
  const text = String(value || "")
    .replace(/^(本项目|项目|工程)/, "")
    .replace(/(?:，|。|；|;).*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /(项目名称|工程名称|统一使用)/.test(text)) return "";
  return text.length >= 4 ? text : "";
}

function extractAuthoritativeProjectName(field, sourceText) {
  const fieldText = normalizeForSearch([
    field?.sourceText,
    field?.templateContext,
    field?.category,
    field?.type,
    field?.question,
    field?.aiInstruction,
  ].filter(Boolean).join(" "));
  if (!/(项目名称|工程名称|采购项目名称|项目名|工程名)/.test(fieldText)) return null;

  const source = String(sourceText || "");
  const patterns = [
    /(?:项目|工程|采购项目|分包工程)?名称\s*统一使用\s*[“"']([^”"'\n。；;]+)[”"']/,
    /(?:项目名称|工程名称|采购项目名称)\s*(?:为|是|：|:)\s*[“"']?([^”"'\n。；;]+?)(?:[”"']|。|；|;|\n|$)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = match?.[1]?.replace(/\s+/g, " ").trim();
    if (!value || value.length < 4) continue;
    return {
      value,
      status: "待确认",
      confidence: 96,
      source: "知识库命名规则",
      evidence: `资料明确写明名称统一使用“${value}”。`,
    };
  }
  return null;
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
  if (/项目概况|工程概况|建设规模|工程建设规模|建筑面积|建设内容|段落填空/.test(value)) add("项目概况", "工程概况", "工程建设规模", "总建筑面积", "建设内容", "服务内容", "技术要求", "商务要求");
  if (/采购范围|实施范围|服务范围|主要施工内容|工作内容|包括但不限于|清单填空/.test(value)) add("采购范围", "实施范围", "服务范围", "主要施工内容", "施工图范围内", "工作内容", "包括但不限于", "分项内容");
  if (/评审办法|评标办法|综合评分|综合评估|最低投标价/.test(value)) add("评审办法", "评标办法", "综合评分法", "综合评估法", "最低投标价法");
  if (/业绩|类似项目|合同金额|发票/.test(value)) add("业绩要求", "类似项目业绩", "合同金额");
  if (/人员|技术负责人|安全员|项目负责人|专职安全/.test(value)) add("人员要求", "技术负责人", "专职安全生产管理人员");
  if (/资质|资格|安全生产许可证|劳务资质/.test(value)) add("资质要求", "施工劳务资质", "安全生产许可证");
  if (/工期|合同工期|日历天|进场通知/.test(value)) add("工期", "合同工期", "日历天");
  if (/付款|支付|进度款|结算款|质保金|缺陷责任/.test(value)) add("付款方式", "进度款", "结算款", "质保金");
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

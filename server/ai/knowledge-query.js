import { searchKnowledgeBase } from "../knowledge/documents.js";

import { getAiRuntimeConfig, materialChunkOverlap, materialChunkSize } from "./config.js";

import { summarizeFieldForDebug } from "./debug-log.js";

import { getFillModeLabel, normalizeFillMode, normalizeForSearch } from "./fill-rules.js";

import { callJsonModel } from "./model.js";



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

async function searchKnowledgeForAi(runtime, { rawQuery = "", field = {}, message = "", knowledgeOptions = {}, debugFileName = "ai-knowledge-query-last.json" } = {}) {
  const kbIds = Array.isArray(knowledgeOptions.kbIds) ? knowledgeOptions.kbIds.filter(Boolean) : [];
  const globalKbIds = Array.isArray(knowledgeOptions.globalKbIds) ? knowledgeOptions.globalKbIds.filter(Boolean) : [];
  const enabled = knowledgeOptions.enabled !== false && (kbIds.length > 0 || globalKbIds.length > 0);
  const fallbackQuery = String(rawQuery || message || "").replace(/\s+/g, " ").trim();
  if (!enabled || !fallbackQuery) return { snippets: [], rawQuery: fallbackQuery, query: "", plan: null };

  const plan = await createKnowledgeRetrievalPlan(runtime, { rawQuery: fallbackQuery, field, message, debugFileName });
  const query = plan.query || "";
  if (!query) return { snippets: [], rawQuery: fallbackQuery, query, plan };
  const snippets = await searchKnowledgeBase({
    query,
    projectId: knowledgeOptions.projectId || "default-project",
    kbIds,
    globalKbIds,
    includeGlobal: knowledgeOptions.includeGlobal,
    topK: knowledgeOptions.topK || 6,
  });
  return { snippets, rawQuery: fallbackQuery, query, plan };
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

  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
    debugFileName,
    debugContext: { rawQuery, field: summarizeFieldForDebug(field), message },
  });
  const plan = normalizeKnowledgeRetrievalPlan(parsed, rawQuery);
  return {
    ...plan,
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
  return query || buildFallbackKnowledgeSearchQuery(plan.rawQuery);
}

function buildFallbackKnowledgeSearchQuery(rawQuery = "") {
  return cleanKnowledgeQueryTerm(rawQuery)
    .replace(/自动字段|模板标记|提示词|填空|短文本填空|长文本填空|只输出可替换模板标记的值/g, " ")
    .replace(/[{}《》【】"'“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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
      const location = item.sourceLocation || `${item.documentName || "未命名资料"}${item.page ? ` 第${item.page}页` : ` 片段${item.chunkIndex || index + 1}`}`;
      return `知识库${index + 1}（${scopeName}｜${location}｜相关度${item.score || 0}）：\n${item.text || ""}`;
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



export {
  buildFieldRetrievalQuery,
  createAiKnowledgeSearch,
  createSearchTokens,
  formatKnowledgeSnippets,
  formatMaterialSnippets,
  scoreText,
  searchKnowledgeForAi,
  selectMaterialSnippets,
};


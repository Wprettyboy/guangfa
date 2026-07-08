import { maxKnowledgeChars, getAiRuntimeConfig } from "../ai/config.js";
import { summarizeSnippetsForDebug } from "../ai/debug-log.js";
import { formatKnowledgeSnippets, searchKnowledgeForAi } from "../ai/knowledge-query.js";
import { callJsonModel } from "../ai/model.js";

const defaultChildTemplates = [
  { title: "功能概述", level: 2 },
  { title: "业务流程与业务场景描述", level: 2 },
  { title: "具体功能列表", level: 2 },
];

async function identifySolutionModules(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const sectionTitle = cleanText(payload.sectionTitle || "详细功能设计");
  const childTemplates = normalizeChildTemplates(payload.childTemplates);
  const userInstruction = cleanText(payload.userInstruction).slice(0, 2000);
  const knowledgeOptions = normalizeKnowledgeOptions(payload.knowledgeOptions);
  const query = [sectionTitle, childTemplates.map((item) => item.title).join(" "), userInstruction, "功能模块 系统模块 详细功能设计"]
    .filter(Boolean)
    .join(" ");
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: query,
    message: query,
    knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 10) },
    debugFileName: "solution-writing-identify-query-last.json",
  });
  const snippets = knowledgeSearch.snippets.slice(0, 10);
  const knowledgeText = formatKnowledgeSnippets(snippets).slice(0, maxKnowledgeChars);
  const systemPrompt = [
    "你是政企软件方案文档的高级产品经理。",
    "任务：只根据背景资料识别需要写入详细功能设计章节的功能模块。",
    "不要生成章节正文，不要改模板结构，不要编造资料中没有依据的模块。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
  const userPrompt = [
    "输出 JSON：",
    '{"modules":[{"name":"模块名称","description":"一句话说明模块职责","reason":"为什么资料支持该模块","sourceRefs":["知识库1"]}]}',
    "",
    `目标章节：${sectionTitle}`,
    `章节模板：${childTemplates.map((item) => item.title).join("、")}`,
    `用户补充要求：${userInstruction || "无"}`,
    "",
    knowledgeText ? `【背景资料】\n${knowledgeText}` : "【背景资料】\n未检索到资料。若用户补充要求不足，请返回空数组。",
    "",
    "规则：",
    "1. 模块名称使用业务可读名称，不要写泛泛的“模块一”。",
    "2. 同义模块要合并，不要重复。",
    "3. sourceRefs 只能填写背景资料中的“知识库N”编号。",
    "4. 资料不足时 modules 返回空数组。",
  ].join("\n");
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 2048, {
    debugFileName: "solution-writing-identify-last.json",
    debugContext: {
      sectionTitle,
      childTemplates,
      userInstruction,
      knowledgeOptions,
      rawRetrievalQuery: knowledgeSearch.rawQuery,
      retrievalQuery: knowledgeSearch.query,
      retrievalPlan: knowledgeSearch.plan,
      knowledgeSnippets: summarizeSnippetsForDebug(snippets),
    },
  });
  const sourceLabels = snippets.map((_, index) => `知识库${index + 1}`);
  return {
    modules: normalizeModules(parsed.modules, sourceLabels),
    query: knowledgeSearch.query,
    snippets: summarizeSolutionSnippets(snippets, knowledgeOptions.bases),
  };
}

async function generateSolutionModuleSections(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const module = normalizeModule(payload.module, 0);
  if (!module.name) {
    const error = new Error("请选择要生成的功能模块。");
    error.statusCode = 400;
    throw error;
  }
  const sectionTitle = cleanText(payload.sectionTitle || "详细功能设计");
  const childTemplates = normalizeChildTemplates(payload.childTemplates);
  const userInstruction = cleanText(payload.userInstruction).slice(0, 2000);
  const knowledgeOptions = normalizeKnowledgeOptions(payload.knowledgeOptions);
  const query = [module.name, module.description, sectionTitle, childTemplates.map((item) => item.title).join(" "), userInstruction]
    .filter(Boolean)
    .join(" ");
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: query,
    message: query,
    knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 10) },
    debugFileName: "solution-writing-generate-query-last.json",
  });
  const snippets = knowledgeSearch.snippets.slice(0, 10);
  const knowledgeText = formatKnowledgeSnippets(snippets).slice(0, maxKnowledgeChars);
  const systemPrompt = [
    "你是政企软件方案文档的高级产品经理。",
    "任务：按给定章节模板，为单个功能模块规划每个子标题应该如何展开写作。",
    "你输出的是写作规划、拓展方向、内容组织建议和专业化表达建议，不是可直接粘贴进方案的最终正文。",
    "保持模板子章节不增不减；依据不足时说明应补充哪些资料，不要编造成熟正文。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
  const userPrompt = [
    "输出 JSON：",
    '{"moduleName":"模块名称","sections":[{"templateTitle":"功能概述","heading":"功能概述","content":"写作规划：本标题下建议写哪些内容、按什么顺序展开、怎样写得专业充实"}],"warnings":["可为空"]}',
    "",
    `目标章节：${sectionTitle}`,
    `模块名称：${module.name}`,
    `模块说明：${module.description || "无"}`,
    `用户补充要求：${userInstruction || "无"}`,
    "",
    "必须按以下模板标题逐项输出 sections：",
    childTemplates.map((item, index) => `${index + 1}. ${item.title}`).join("\n"),
    "",
    knowledgeText ? `【背景资料】\n${knowledgeText}` : "【背景资料】\n未检索到资料。",
    "",
    "规划要求：",
    "1. 每个 content 只写“这个标题下应该怎么写”的规划建议，不要直接写最终方案正文。",
    "2. 规划建议要说明建议覆盖的要点、展开顺序、专业化表达方向、可引用的资料要点。",
    "3. 对“具体功能列表”，规划应说明功能点如何分组、每类功能应写哪些能力、是否需要补充约束或边界。",
    "4. 对“业务流程与业务场景描述”，规划应说明应覆盖哪些角色、触发场景、流程节点、异常场景和闭环关系。",
    "5. 对“功能概述”，规划应说明模块定位、建设目标、核心能力、管理价值和与其他模块的关系。",
    "6. 不输出提示词、内部分析、资料片段编号堆砌；不要改动模板标题语义。",
  ].join("\n");
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 4096, {
    debugFileName: "solution-writing-generate-last.json",
    debugContext: {
      sectionTitle,
      module,
      childTemplates,
      userInstruction,
      knowledgeOptions,
      rawRetrievalQuery: knowledgeSearch.rawQuery,
      retrievalQuery: knowledgeSearch.query,
      retrievalPlan: knowledgeSearch.plan,
      knowledgeSnippets: summarizeSnippetsForDebug(snippets),
    },
  });
  const sections = normalizeGeneratedSections(parsed.sections, childTemplates);
  return {
    moduleName: cleanText(parsed.moduleName || module.name),
    sections,
    text: buildSolutionModuleText(cleanText(parsed.moduleName || module.name), sections),
    warnings: normalizeStringList(parsed.warnings).slice(0, 5),
    query: knowledgeSearch.query,
    snippets: summarizeSolutionSnippets(snippets, knowledgeOptions.bases),
  };
}

function buildSolutionModuleText(moduleName, sections) {
  const lines = [moduleName];
  sections.forEach((section) => {
    lines.push("", section.heading || section.templateTitle, section.content || "需结合项目资料补充。");
  });
  return lines.join("\n").trim();
}

function normalizeGeneratedSections(sections, childTemplates) {
  const rows = Array.isArray(sections) ? sections : [];
  return childTemplates.map((template) => {
    const matched = rows.find((row) => normalizeTitle(row?.templateTitle || row?.heading) === normalizeTitle(template.title));
    return {
      templateTitle: template.title,
      heading: cleanText(matched?.heading || template.title),
      content: cleanMultilineText(matched?.content || "需结合项目资料补充该标题的写作要点。"),
    };
  });
}

function normalizeModules(modules, sourceLabels) {
  const seen = new Set();
  return (Array.isArray(modules) ? modules : [])
    .map((item, index) => normalizeModule(item, index, sourceLabels))
    .filter((item) => {
      const key = normalizeTitle(item.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function normalizeModule(item = {}, index = 0, sourceLabels = []) {
  const name = cleanText(item.name).slice(0, 80);
  return {
    id: cleanText(item.id) || `SOL-M${String(index + 1).padStart(3, "0")}`,
    name,
    description: cleanText(item.description).slice(0, 300),
    reason: cleanText(item.reason).slice(0, 300),
    sourceRefs: normalizeStringList(item.sourceRefs).filter((ref) => sourceLabels.length === 0 || sourceLabels.includes(ref)).slice(0, 6),
  };
}

function normalizeChildTemplates(childTemplates) {
  const rows = (Array.isArray(childTemplates) ? childTemplates : [])
    .map((item) => ({
      title: cleanTitle(item?.title || item?.displayTitle),
      level: Number.isFinite(Number(item?.level)) ? Number(item.level) : 0,
      number: cleanText(item?.number),
    }))
    .filter((item) => item.title);
  return rows.length > 0 ? rows.slice(0, 12) : defaultChildTemplates;
}

function normalizeKnowledgeOptions(options = {}) {
  const value = options && typeof options === "object" ? options : {};
  return {
    enabled: value.enabled !== false,
    projectId: value.projectId || "default-project",
    kbIds: Array.isArray(value.kbIds) ? value.kbIds.filter(Boolean) : [],
    globalKbIds: Array.isArray(value.globalKbIds) ? value.globalKbIds.filter(Boolean) : [],
    topK: value.topK || 10,
    bases: Array.isArray(value.bases) ? value.bases : [],
  };
}

function summarizeSolutionSnippets(snippets = [], bases = []) {
  const baseNames = new Map((Array.isArray(bases) ? bases : []).map((base) => [base?.id, base?.name]).filter(([id, name]) => id && name));
  return summarizeSnippetsForDebug(snippets).map((item) => ({
    ...item,
    kbName: baseNames.get(item.kbId) || (item.scope === "global" ? "全局知识库" : "项目知识库"),
  }));
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map(cleanText)
    .filter(Boolean);
}

function cleanTitle(value) {
  return cleanText(value).replace(/^\d+(?:\.\d+)*\s*/, "").trim();
}

function normalizeTitle(value) {
  return cleanTitle(value).replace(/\s+/g, "").toLowerCase();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export {
  buildSolutionModuleText,
  generateSolutionModuleSections,
  identifySolutionModules,
};

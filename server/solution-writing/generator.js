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
    "标题样式由 Word 自动编号控制，模块名称不要输出 3.1、3.1.1、（一）这类章节编号。",
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
    "5. 模块名称只写纯标题文本，例如“值班管理模块”，不要写“3.1 值班管理模块”。",
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
    "标题样式由 Word 自动编号控制，moduleName、templateTitle、heading 都不要输出 3.1、3.1.1、（一）这类章节编号。",
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
    childTemplates.map((item) => `- ${item.title}`).join("\n"),
    "",
    knowledgeText ? `【背景资料】\n${knowledgeText}` : "【背景资料】\n未检索到资料。",
    "",
    "规划要求：",
    "1. 每个 content 只写“这个标题下应该怎么写”的规划建议，不要直接写最终方案正文。",
    "2. 规划建议要说明建议覆盖的要点、展开顺序、专业化表达方向、可引用的资料要点。",
    "3. 对“具体功能列表”，规划应说明功能点如何分组、每类功能应写哪些能力、是否需要补充约束或边界。",
    "4. 对“业务流程与业务场景描述”，规划应说明应覆盖哪些角色、触发场景、流程节点、异常场景和闭环关系。",
    "5. 对“功能概述”，规划应说明模块定位、建设目标、核心能力、管理价值和与其他模块的关系。",
    "6. 不输出章节编号；标题只写纯标题文本，例如“功能概述”，不要写“3.1.1 功能概述”。",
    "7. 不输出提示词、内部分析、资料片段编号堆砌；不要改动模板标题语义。",
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
    moduleName: cleanTitle(parsed.moduleName || module.name),
    sections,
    text: buildSolutionModuleText(cleanTitle(parsed.moduleName || module.name), sections),
    warnings: normalizeStringList(parsed.warnings).slice(0, 5),
    query: knowledgeSearch.query,
    snippets: summarizeSolutionSnippets(snippets, knowledgeOptions.bases),
  };
}

async function generateSolutionTaskPlan(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const outlineText = cleanMultilineText(payload.outlineText).slice(0, 20000);
  const categories = normalizeTaskPlanCategories(payload.categories);
  const userInstruction = cleanText(payload.userInstruction).slice(0, 2000);
  const knowledgeOptions = normalizeKnowledgeOptions(payload.knowledgeOptions);
  const taskDensity = normalizeTaskDensity(payload.taskDensity);
  if (!categories.length) {
    const error = new Error("请先读取方案大纲并生成任务规划输入。");
    error.statusCode = 400;
    throw error;
  }

  const plannedCategories = [];
  const warnings = [];
  for (const category of categories) {
    const planned = await generateTaskCategoryPlan(runtime, {
      outlineText,
      category,
      userInstruction,
      knowledgeOptions,
      taskDensity,
    });
    plannedCategories.push(planned);
    warnings.push(...planned.warnings);
  }

  return {
    categories: plannedCategories,
    stats: {
      categoryCount: plannedCategories.length,
      taskCount: plannedCategories.reduce((sum, category) => sum + category.tasks.length, 0),
      taskDensity,
    },
    taskDensity,
    warnings: normalizeStringList(warnings).slice(0, 12),
  };
}

async function testSolutionTaskKnowledge(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const knowledgeOptions = normalizeKnowledgeOptions(payload.knowledgeOptions);
  const categories = normalizeTaskPlanCategories(payload.categories);
  const query = buildTaskKnowledgeQuery({
    outlineText: cleanMultilineText(payload.outlineText),
    categories,
    userInstruction: cleanText(payload.userInstruction),
  });
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: query,
    message: query,
    knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 6) },
    debugFileName: "solution-writing-task-knowledge-test.json",
  });
  const snippets = knowledgeSearch.snippets.slice(0, 8);
  return {
    ok: true,
    query: knowledgeSearch.query,
    selectedBases: knowledgeOptions.bases || [],
    snippetCount: snippets.length,
    snippets: summarizeSolutionSnippets(snippets, knowledgeOptions.bases),
  };
}

async function generateTaskCategoryPlan(runtime, { outlineText, category, userInstruction, knowledgeOptions, taskDensity }) {
  const query = buildTaskKnowledgeQuery({ outlineText, categories: [category], userInstruction });
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: query,
    message: query,
    knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 8) },
    debugFileName: `solution-writing-task-plan-knowledge-${safeDebugName(category.title)}.json`,
  });
  const snippets = knowledgeSearch.snippets.slice(0, 8);
  const knowledgeText = formatKnowledgeSnippets(snippets).slice(0, Math.min(maxKnowledgeChars, 12000));
  const densityRule = getTaskDensityRule(taskDensity);
  const systemPrompt = [
    "你是政企方案落地执行的高级方案工程师和项目任务规划专家。",
    "任务：根据完整方案大纲、当前一级任务类别、每个标题及标题下原文，生成可执行任务规划。",
    "完整大纲只作为全局架构约束，不能改大纲，不能跨章节抢写其他标题内容。",
    "同一个一级类别内，任务必须按输入标题顺序规划，并承接前序规划产出以避免重复；进入新一级类别后前序上下文视为已重置。",
    "每个输入标题至少输出 1 个任务；原文不足时输出待确认/待补充任务，不要编造未体现的业务内容。",
    "无论选择哪种模式，都禁止为了扩充篇幅新增本次建设范围外的功能、模块、接口、设备、流程、指标或承诺。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
  const userPrompt = [
    "输出 JSON：",
    '{"title":"一级类别名","sourceHeading":"来源一级标题","tasks":[{"sourceHeading":"来源标题","taskTitle":"任务名称","planningSummary":"说明这个标题下应如何分层写：先详细描述什么，再详细描述什么，最后如何形成交付或验收","objective":"任务目标","exclusiveBoundary":{"include":["写什么"],"exclude":["不写什么"],"handoffToChildren":["下沉给子标题的内容"]},"executionPoints":["按顺序执行或写作的要点"],"deliverables":["交付物"],"dependsOn":["依赖任务"],"producesForNext":["产出给后续"]}],"warnings":["可为空"]}',
    "",
    "【完整方案大纲】",
    outlineText || "未读取到完整大纲。",
    "",
    `【当前一级任务类别】${category.sourceHeading || category.title}`,
    `类别边界：${category.boundary?.include || ""}；${category.boundary?.exclude || ""}`,
    `类别上下文规则：${category.contextRule || "类别内传递，跨类别重置。"}`,
    `规划模式：${densityRule.label}`,
    `模式要求：${densityRule.prompt}`,
    `用户补充要求：${userInstruction || "无"}`,
    "",
    knowledgeText ? `【知识库补充资料】\n${knowledgeText}` : "【知识库补充资料】\n未召回到补充资料，任务规划只基于标题与原文。",
    "",
    "【按顺序规划以下标题】",
    category.tasks.map((task, index) => [
      `${index + 1}. 来源标题：${task.sourceHeading}`,
      `标题路径：${Array.isArray(task.headingPath) ? task.headingPath.join(" / ") : ""}`,
      `标题下原文：${task.sourceText || "未读取到原文；请基于标题生成待确认任务。"}`,
      `前序规划输入：${task.previousPlanSummary || "本类别第一个规划单元。"}`,
      `规划焦点：${normalizeStringList(task.planningFocus).join("；")}`,
      `排他边界：写什么=${normalizeStringList(task.exclusiveBoundary?.include).join("；")}；不写什么=${normalizeStringList(task.exclusiveBoundary?.exclude).join("；")}`,
    ].join("\n")).join("\n\n"),
    "",
    "生成规则：",
    "1. tasks 必须覆盖上面每个来源标题，不能少于输入标题数量；适中/丰富模式的拆分必须体现为 tasks 数组里的多条对象，不能只堆在 executionPoints 里。",
    "2. sourceHeading 必须使用输入中的来源标题原文；同一标题拆成多个任务时 sourceHeading 保持相同。",
    "3. taskTitle 不要输出章节编号。",
    "4. planningSummary 要先说明当前标题在整体方案架构中的作用，再说明本标题下内容应如何分层展开：先详细描述什么、再详细描述什么、最后如何落到交付或验收。",
    "5. exclusiveBoundary 必须明确写什么、不写什么；有下级标题时要说明哪些内容下沉给子标题。",
    "6. dependsOn 只能引用本类别前序任务；本类别第一个任务可为空数组。",
    "7. producesForNext 要写清楚给后续标题规划传递什么上下文。",
    "8. 不能为了凑字数添加原文和知识库都没有体现的建设内容；需要扩展时只能扩展表达、验收、实施步骤、风险边界和交付要求。",
  ].join("\n");
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 8192, {
    debugFileName: `solution-writing-task-plan-${safeDebugName(category.title)}.json`,
    debugContext: {
      categoryTitle: category.title,
      sourceHeading: category.sourceHeading,
      taskCount: category.tasks.length,
      hasOutlineText: Boolean(outlineText),
      taskDensity,
      knowledgeOptions,
      knowledgeSnippets: summarizeSnippetsForDebug(snippets),
    },
  });
  return normalizeTaskPlanCategoryResult(parsed, category, taskDensity);
}

async function generateSolutionDraftContent(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const taskPlan = normalizeDraftTaskPlan(payload.taskPlan);
  const globalPrompt = cleanMultilineText(payload.globalPrompt).slice(0, 4000);
  const knowledgeOptions = normalizeKnowledgeOptions(payload.knowledgeOptions);
  if (!taskPlan.categories.length) {
    const error = new Error("请先在任务规划模块生成任务，再进行方案编制。");
    error.statusCode = 400;
    throw error;
  }
  const categories = [];
  const warnings = [];
  for (const category of taskPlan.categories) {
    const drafted = await generateDraftCategory(runtime, {
      category,
      globalPrompt,
      knowledgeOptions,
    });
    categories.push(drafted);
    warnings.push(...drafted.warnings);
  }
  return {
    categories,
    stats: {
      categoryCount: categories.length,
      sectionCount: categories.reduce((sum, category) => sum + category.sections.length, 0),
    },
    warnings: normalizeStringList(warnings).slice(0, 12),
  };
}

async function generateDraftCategory(runtime, { category, globalPrompt, knowledgeOptions }) {
  const query = [
    category.title,
    category.tasks.map((task) => [task.sourceHeading, task.planningSummary, task.objective, normalizeStringList(task.deliverables).join(" ")].join(" ")).join(" "),
    globalPrompt,
  ].filter(Boolean).join(" ");
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: query,
    message: query,
    knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 8) },
    debugFileName: `solution-writing-draft-knowledge-${safeDebugName(category.title)}.json`,
  });
  const snippets = knowledgeSearch.snippets.slice(0, 8);
  const knowledgeText = formatKnowledgeSnippets(snippets).slice(0, Math.min(maxKnowledgeChars, 12000));
  const systemPrompt = [
    "你是成熟的政企方案编制专家。",
    "任务：承接任务规划结果，把任务转写成可放入方案文档的正文草稿。",
    "必须遵守用户给定的全局提示词中的 AI 角色、文档类型和背景设定。",
    "不要输出 Markdown，不要输出内部分析，不要编造任务规划与知识库之外的内容。",
    "输出必须是严格 JSON。",
  ].join("\n");
  const userPrompt = [
    "输出 JSON：",
    '{"title":"类别标题","sections":[{"sourceHeading":"来源标题","title":"正文小标题","content":"方案正文草稿"}],"warnings":["可为空"]}',
    "",
    `【全局提示词】\n${globalPrompt || "按正式政企技术方案语气生成，表达专业、清晰、可落地。"}`,
    "",
    `【当前任务类别】${category.sourceHeading || category.title}`,
    "",
    "【任务规划】",
    category.tasks.map((task, index) => [
      `${index + 1}. 来源标题：${task.sourceHeading}`,
      `AI规划摘要：${task.planningSummary || ""}`,
      `任务目标：${task.objective || ""}`,
      `AI要干什么：${normalizeStringList(task.executionPoints).join("；")}`,
      `约束：${normalizeStringList(task.exclusiveBoundary?.include).join("；")}；${normalizeStringList(task.exclusiveBoundary?.exclude).join("；")}`,
      `交付物：${normalizeStringList(task.deliverables).join("；")}`,
    ].join("\n")).join("\n\n"),
    "",
    knowledgeText ? `【知识库补充资料】\n${knowledgeText}` : "【知识库补充资料】\n未召回到补充资料。",
    "",
    "生成规则：",
    "1. 每个任务至少生成一个 sections 项。",
    "2. sourceHeading 必须对应任务来源标题。",
    "3. content 写成方案正文，不要再写任务清单。",
    "4. 如资料不足，正文中使用审慎表达，不要编造具体参数。",
  ].join("\n");
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, 8192, {
    debugFileName: `solution-writing-draft-${safeDebugName(category.title)}.json`,
    debugContext: {
      categoryTitle: category.title,
      taskCount: category.tasks.length,
      hasGlobalPrompt: Boolean(globalPrompt),
      knowledgeSnippets: summarizeSnippetsForDebug(snippets),
    },
  });
  return normalizeDraftCategoryResult(parsed, category);
}

function buildSolutionModuleText(moduleName, sections) {
  const lines = [moduleName];
  sections.forEach((section) => {
    lines.push("", section.heading || section.templateTitle, section.content || "需结合项目资料补充。");
  });
  return lines.join("\n").trim();
}

function normalizeTaskPlanCategories(categories) {
  return (Array.isArray(categories) ? categories : [])
    .map((category, index) => ({
      id: cleanText(category?.id) || `task-category-${index + 1}`,
      title: cleanTitle(category?.title || category?.sourceHeading || `任务类别${index + 1}`),
      sourceHeading: cleanText(category?.sourceHeading || category?.title),
      boundary: {
        include: cleanText(category?.boundary?.include),
        exclude: cleanText(category?.boundary?.exclude),
      },
      contextRule: cleanText(category?.contextRule),
      tasks: normalizeTaskPlanInputTasks(category?.tasks),
    }))
    .filter((category) => category.tasks.length)
    .slice(0, 20);
}

function normalizeTaskDensity(value) {
  const density = cleanText(value).toLowerCase();
  if (["moderate", "medium", "适中"].includes(density)) return "moderate";
  if (["rich", "full", "丰富"].includes(density)) return "rich";
  return "concise";
}

function getTaskDensityRule(density) {
  if (density === "rich") {
    return {
      label: "丰富",
      maxTasksPerHeading: 4,
      prompt: [
        "用于需要更充实篇幅的方案编制。",
        "每个标题至少 1 个任务；当原文或知识库中存在多个建设点、角色、流程、数据、接口、配置、验收要求时，优先围绕同一 sourceHeading 拆成 2-4 个任务对象。",
        "拆分逻辑优先按“先说明建设背景/业务对象，再说明功能或流程设计，再说明数据/接口/配置，再说明测试验收和交付边界”展开。",
        "丰富只能细化本次建设范围内的设计、实现、配置、联调、测试、交付、培训、验收、风险边界，不得新增资料没有体现的功能或模块。",
        "如果资料不足，不要硬扩功能，改为补充待确认事项、验收口径、实施边界和交付说明。",
      ].join(""),
    };
  }
  if (density === "moderate") {
    return {
      label: "适中",
      maxTasksPerHeading: 2,
      prompt: [
        "用于常规正式方案编制。",
        "每个标题至少 1 个任务；当原文明确包含多个事项时，优先围绕同一 sourceHeading 拆成 1-2 个任务对象。",
        "拆分逻辑优先按“先说明内容对象和目标，再说明执行动作和交付验收”展开。",
        "适度补充执行步骤、交付物、验收关注点和前置依赖，但不得扩展本次建设范围外功能。",
      ].join(""),
    };
  }
  return {
    label: "简单",
    maxTasksPerHeading: 1,
    prompt: [
      "用于简单方案编制。",
      "原则上每个标题生成 1 个任务，只保留必要目标、关键动作和交付物。",
      "除非原文明确分成多个独立事项，否则不要拆分出额外任务。",
    ].join(""),
  };
}

function buildTaskKnowledgeQuery({ outlineText, categories, userInstruction }) {
  const categoryText = (Array.isArray(categories) ? categories : [])
    .map((category) => [
      category.title,
      category.sourceHeading,
      category.tasks?.slice(0, 12).map((task) => [task.sourceHeading, task.sourceText].filter(Boolean).join(" ")).join(" "),
    ].filter(Boolean).join(" "))
    .join(" ");
  return [
    cleanText(userInstruction),
    cleanText(categoryText),
    cleanText(outlineText).slice(0, 3000),
    "方案编制 任务规划 执行任务 技术方案 项目实施",
  ].filter(Boolean).join(" ");
}

function normalizeTaskPlanInputTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => ({
      id: cleanText(task?.id) || `task-${index + 1}`,
      sourceHeading: cleanText(task?.sourceHeading || task?.title),
      sourceText: cleanMultilineText(task?.sourceText).slice(0, 4000),
      headingPath: normalizeStringList(task?.headingPath).slice(0, 12),
      planningFocus: normalizeStringList(task?.planningFocus).slice(0, 8),
      previousPlanSummary: cleanText(task?.previousPlanSummary).slice(0, 1000),
      exclusiveBoundary: {
        include: normalizeStringList(task?.exclusiveBoundary?.include).slice(0, 8),
        exclude: normalizeStringList(task?.exclusiveBoundary?.exclude).slice(0, 8),
        handoffToChildren: normalizeStringList(task?.exclusiveBoundary?.handoffToChildren).slice(0, 8),
      },
    }))
    .filter((task) => task.sourceHeading)
    .slice(0, 80);
}

function normalizeTaskPlanCategoryResult(parsed, fallbackCategory, taskDensity = "concise") {
  const densityRule = getTaskDensityRule(taskDensity);
  const inputTasks = fallbackCategory.tasks;
  const rows = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  const tasks = inputTasks.flatMap((inputTask, index) => {
    const sourceHeading = inputTask.sourceHeading;
    const matchedRows = findTaskRowsForHeading(rows, sourceHeading);
    const fallbackRows = matchedRows.length ? matchedRows : [rows[index] || {}];
    return fallbackRows
      .slice(0, densityRule.maxTasksPerHeading)
      .map((matched, splitIndex) => normalizeTaskPlanRow({
        matched,
        inputTask,
        sourceHeading,
        index,
        splitIndex,
      }));
  });
  return {
    id: fallbackCategory.id,
    title: cleanTitle(parsed?.title || fallbackCategory.title),
    sourceHeading: cleanText(parsed?.sourceHeading || fallbackCategory.sourceHeading),
    boundary: fallbackCategory.boundary,
    contextRule: fallbackCategory.contextRule,
    tasks,
    warnings: normalizeStringList(parsed?.warnings).slice(0, 5),
  };
}

function findTaskRowsForHeading(rows, sourceHeading) {
  const exact = rows.filter((row) => cleanText(row?.sourceHeading) === sourceHeading);
  if (exact.length) return exact;
  const normalized = normalizeTitle(sourceHeading);
  return rows.filter((row) => normalizeTitle(row?.sourceHeading) === normalized);
}

function normalizeTaskPlanRow({ matched, inputTask, sourceHeading, index, splitIndex }) {
  const taskTitle = cleanTitle(matched.taskTitle || inputTask.title || sourceHeading);
  const idSuffix = splitIndex > 0 ? `-${splitIndex + 1}` : "";
  return {
    id: `${inputTask.id || `task-${index + 1}`}${idSuffix}`,
    title: taskTitle ? `规划${taskTitle}对应执行任务` : `规划${cleanTitle(sourceHeading)}对应执行任务`,
    sourceHeading,
    sourceText: inputTask.sourceText || "未读取到标题下原文。",
    bodyState: inputTask.sourceText ? "已有标题原文" : "原文待读取",
    headingPath: inputTask.headingPath || [],
    planningFocus: inputTask.planningFocus || [],
    previousPlanSummary: inputTask.previousPlanSummary || "",
    planningSummary: cleanMultilineText(matched.planningSummary || matched.objective || "AI 未返回规划摘要。"),
    objective: cleanMultilineText(matched.objective || `形成“${cleanTitle(sourceHeading)}”对应的执行任务规划。`),
    exclusiveBoundary: {
      include: withFallbackList(matched.exclusiveBoundary?.include, inputTask.exclusiveBoundary?.include).slice(0, 8),
      exclude: withFallbackList(matched.exclusiveBoundary?.exclude, inputTask.exclusiveBoundary?.exclude).slice(0, 8),
      handoffToChildren: withFallbackList(matched.exclusiveBoundary?.handoffToChildren, inputTask.exclusiveBoundary?.handoffToChildren).slice(0, 8),
    },
    executionPoints: withFallbackList(matched.executionPoints, ["确认标题原文要求", "拆解执行步骤", "明确验收关注点"]).slice(0, 10),
    deliverables: withFallbackList(matched.deliverables, ["任务边界说明", "执行要点清单", "验收关注点清单"]).slice(0, 10),
    dependsOn: normalizeStringList(matched.dependsOn).slice(0, 8),
    producesForNext: normalizeStringList(matched.producesForNext).slice(0, 8),
  };
}

function normalizeDraftTaskPlan(taskPlan = {}) {
  return {
    categories: normalizeTaskPlanCategories(taskPlan.categories).map((category) => {
      const sourceCategory = (Array.isArray(taskPlan.categories) ? taskPlan.categories : [])
        .find((item) => cleanText(item?.sourceHeading || item?.title) === cleanText(category.sourceHeading || category.title));
      return {
        ...category,
        tasks: (Array.isArray(sourceCategory?.tasks) ? sourceCategory.tasks : category.tasks)
          .map((task, index) => ({
            id: cleanText(task?.id) || `task-${index + 1}`,
            title: cleanTitle(task?.title || task?.taskTitle || task?.sourceHeading || `任务${index + 1}`),
            sourceHeading: cleanText(task?.sourceHeading || task?.title),
            planningSummary: cleanMultilineText(task?.planningSummary).slice(0, 1200),
            objective: cleanMultilineText(task?.objective).slice(0, 1200),
            executionPoints: normalizeStringList(task?.executionPoints).slice(0, 10),
            deliverables: normalizeStringList(task?.deliverables).slice(0, 10),
            exclusiveBoundary: {
              include: normalizeStringList(task?.exclusiveBoundary?.include).slice(0, 8),
              exclude: normalizeStringList(task?.exclusiveBoundary?.exclude).slice(0, 8),
            },
          }))
          .filter((task) => task.sourceHeading)
          .slice(0, 60),
      };
    }).filter((category) => category.tasks.length).slice(0, 12),
  };
}

function normalizeDraftCategoryResult(parsed, fallbackCategory) {
  const sourceHeadings = fallbackCategory.tasks.map((task) => task.sourceHeading);
  const rows = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const sections = sourceHeadings.map((sourceHeading, index) => {
    const matched = rows.find((row) => cleanText(row?.sourceHeading) === sourceHeading) || rows[index] || {};
    const task = fallbackCategory.tasks[index] || {};
    return {
      id: task.id || `draft-${index + 1}`,
      sourceHeading,
      title: cleanTitle(matched.title || task.title || sourceHeading),
      content: cleanMultilineText(matched.content || `需结合“${sourceHeading}”继续补充方案正文。`),
    };
  });
  return {
    id: fallbackCategory.id,
    title: cleanTitle(parsed?.title || fallbackCategory.title),
    sourceHeading: cleanText(fallbackCategory.sourceHeading || fallbackCategory.title),
    sections,
    warnings: normalizeStringList(parsed?.warnings).slice(0, 5),
  };
}

function withFallbackList(value, fallback) {
  const rows = normalizeStringList(value);
  return rows.length ? rows : normalizeStringList(fallback);
}

function safeDebugName(value) {
  return cleanTitle(value).replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 40) || "category";
}

function normalizeGeneratedSections(sections, childTemplates) {
  const rows = Array.isArray(sections) ? sections : [];
  return childTemplates.map((template) => {
    const matched = rows.find((row) => normalizeTitle(row?.templateTitle || row?.heading) === normalizeTitle(template.title));
    return {
      templateTitle: template.title,
      heading: cleanTitle(matched?.heading || template.title),
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
  const name = cleanTitle(item.name).slice(0, 80);
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
  return cleanText(value)
    .replace(/^(?:\d+\.\d+(?:\.\d+)*\s*|\d+[、.．\s]+|[一二三四五六七八九十]+[、.．\s]+)/, "")
    .replace(/^[（(](?:\d+|[一二三四五六七八九十]+)[）)]\s*/, "")
    .trim();
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
  generateSolutionDraftContent,
  generateSolutionModuleSections,
  generateSolutionTaskPlan,
  identifySolutionModules,
  testSolutionTaskKnowledge,
};

import { getAiRuntimeConfig } from "../ai/config.js";
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
  const knowledgeText = formatKnowledgeSnippets(snippets);
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
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
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
  const knowledgeText = formatKnowledgeSnippets(snippets);
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
  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
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
  validatePrecisePlanningTargets(categories);

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
  const systemPrompt = [
    "你是政企方案落地执行的高级方案工程师和项目任务规划专家。",
    "任务：根据完整方案大纲、当前一级任务类别、每个标题及标题下原文，生成可执行任务规划。",
    "完整大纲只作为全局架构约束，不能改大纲，不能跨章节抢写其他标题内容。",
    "同一个一级类别内，任务必须按输入标题顺序规划，并承接前序规划产出以避免重复；进入新一级类别后前序上下文视为已重置。",
    "每个输入标题至少输出 1 个任务；原文不足时输出待确认/待补充任务，不要编造未体现的业务内容。",
    "无论选择哪种模式，都禁止为了扩充篇幅新增本次建设范围外的功能、模块、接口、设备、流程、指标或承诺。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
  const tasks = [];
  const warnings = [];
  const batches = chunkRows(category.tasks, 6);
  for (const [batchIndex, batchTasks] of batches.entries()) {
    const batchCategory = { ...category, tasks: batchTasks };
    const query = buildTaskKnowledgeQuery({ outlineText, categories: [batchCategory], userInstruction });
    const knowledgeSearch = await searchKnowledgeForAi(runtime, {
      rawQuery: query,
      message: query,
      knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 8) },
      debugFileName: `solution-writing-task-plan-knowledge-${safeDebugName(category.title)}-${batchIndex + 1}.json`,
    });
    const snippets = knowledgeSearch.snippets.slice(0, 8);
    const knowledgeText = formatKnowledgeSnippets(snippets);
    const userPrompt = buildTaskPlanBatchPrompt({
      outlineText,
      category: batchCategory,
      userInstruction,
      taskDensity,
      knowledgeText,
      priorPlanningContext: buildPriorPlanningContext(tasks),
    });
    const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
      debugFileName: `solution-writing-task-plan-${safeDebugName(category.title)}-${batchIndex + 1}.json`,
      debugContext: {
        categoryTitle: category.title,
        sourceHeading: category.sourceHeading,
        targetIds: batchTasks.map((task) => task.targetId),
        taskCount: batchTasks.length,
        hasOutlineText: Boolean(outlineText),
        taskDensity,
        knowledgeOptions,
        knowledgeSnippets: summarizeSnippetsForDebug(snippets),
      },
    });
    const normalized = normalizeTaskPlanCategoryResult(parsed, batchCategory, taskDensity);
    tasks.push(...normalized.tasks);
    warnings.push(...normalized.warnings);
  }
  return {
    id: category.id,
    title: category.title,
    sourceHeading: category.sourceHeading,
    boundary: category.boundary,
    contextRule: category.contextRule,
    tasks,
    warnings: normalizeStringList(warnings).slice(0, 5),
  };
}

function buildTaskPlanBatchPrompt({ outlineText, category, userInstruction, taskDensity, knowledgeText, priorPlanningContext = "" }) {
  const densityRule = getTaskDensityRule(taskDensity);
  return [
    "输出 JSON：",
    '{"title":"一级类别名","sourceHeading":"来源一级标题","tasks":[{"targetId":"paragraph-33","sourceHeading":"来源标题","taskTitle":"任务名称","planningSummary":"说明这个标题下应如何分层写及所依据的原文或知识库事实","objective":"任务目标","exclusiveBoundary":{"include":["写什么"],"exclude":["不写什么"],"handoffToChildren":["下沉给子标题的内容"]},"executionPoints":["按顺序执行或写作的要点"],"deliverables":["交付物"],"dependsOn":["依赖任务"],"producesForNext":["产出给后续"]}],"warnings":["可为空"]}',
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
    priorPlanningContext ? `【本类别前批已形成的规划】\n${priorPlanningContext}` : "【本类别前批已形成的规划】\n本批次为该类别首批。",
    "",
    knowledgeText ? `【知识库补充资料】\n${knowledgeText}` : "【知识库补充资料】\n未召回到补充资料，任务规划只基于标题与原文。",
    "",
    "【按顺序规划以下标题】",
    category.tasks.map((task, index) => [
      `${index + 1}. targetId：${task.targetId}`,
      `来源标题：${task.sourceHeading}`,
      `标题路径：${Array.isArray(task.headingPath) ? task.headingPath.join(" / ") : ""}`,
      `标题下原文：${task.sourceText || "未读取到原文；请基于标题生成待确认任务。"}`,
      `前序规划输入：${task.previousPlanSummary || "本类别第一个规划单元。"}`,
      `规划焦点：${normalizeStringList(task.planningFocus).join("；")}`,
      `排他边界：写什么=${normalizeStringList(task.exclusiveBoundary?.include).join("；")}；不写什么=${normalizeStringList(task.exclusiveBoundary?.exclude).join("；")}`,
    ].join("\n")).join("\n\n"),
    "",
    "生成规则：",
    "1. tasks 必须覆盖上面每个来源标题，不能少于输入标题数量；适中/丰富模式的拆分必须体现为 tasks 数组里的多条对象，不能只堆在 executionPoints 里。",
    "2. targetId 和 sourceHeading 必须逐字使用对应输入值；同一标题拆成多个任务时，两者保持相同。不得遗漏目标、添加未知目标或把一个目标的内容配给另一个标题。",
    "3. taskTitle 不要输出章节编号。",
    "4. planningSummary 要先说明当前标题在整体方案架构中的作用，再说明本标题下内容应如何分层展开：先详细描述什么、再详细描述什么、最后如何落到交付或验收。",
    "5. exclusiveBoundary 必须明确写什么、不写什么；有下级标题时要说明哪些内容下沉给子标题。",
    "6. dependsOn 只能引用本类别前序任务；本类别第一个任务可为空数组。",
    "7. producesForNext 要写清楚给后续标题规划传递什么上下文。",
    "8. 丰富模式先从标题原文、知识库、标题路径和上下文中识别可独立展开的事实维度，再决定生成 1-4 个任务；各任务的 planningSummary、objective 和 executionPoints 必须有实质差异，不能复制同一规划凑数量。",
    "9. 不能为了凑字数添加原文和知识库都没有体现的建设内容；需要扩展时只能在当前标题边界内深化有依据的场景、规则、流程、数据关系、实施步骤、验收和风险边界。",
  ].join("\n");
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
  validatePreciseDraftTargets(taskPlan.categories);
  const categories = [];
  const warnings = [];
  for (const category of taskPlan.categories) {
    const drafted = await generateDraftCategory(runtime, {
      category,
      globalPrompt,
      knowledgeOptions,
      taskDensity: taskPlan.taskDensity,
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

async function generateDraftCategory(runtime, { category, globalPrompt, knowledgeOptions, taskDensity }) {
  const targetGroups = groupDraftTasksByTarget(category.tasks);
  const systemPrompt = [
    "你是成熟的政企方案编制专家。",
    "任务：承接同一标题下聚合后的任务规划，把它们整合成一份可放入该标题正文区的方案草稿。",
    "必须遵守用户给定的全局提示词中的 AI 角色、文档类型和背景设定。",
    "以标题原文和知识库为事实边界，结合标题路径、父子分工和前后文承接关系展开，不得跨标题抢写或编造资料外内容。",
    "不要输出 Markdown，不要输出内部分析。",
    "输出必须是严格 JSON。",
  ].join("\n");
  const sections = [];
  const warnings = [];
  const batches = chunkRows(targetGroups, 4);
  for (const [batchIndex, targets] of batches.entries()) {
    const query = buildDraftKnowledgeQuery({ category, targets, globalPrompt });
    const knowledgeSearch = await searchKnowledgeForAi(runtime, {
      rawQuery: query,
      message: query,
      knowledgeOptions: { ...knowledgeOptions, topK: Math.max(Number(knowledgeOptions.topK || 0), 8) },
      debugFileName: `solution-writing-draft-knowledge-${safeDebugName(category.title)}-${batchIndex + 1}.json`,
    });
    const snippets = knowledgeSearch.snippets.slice(0, 8);
    const knowledgeText = formatKnowledgeSnippets(snippets);
    const userPrompt = buildDraftBatchPrompt({
      category,
      targets,
      globalPrompt,
      knowledgeText,
      taskDensity,
      priorDraftContext: buildPriorDraftContext(sections),
    });
    const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
      debugFileName: `solution-writing-draft-${safeDebugName(category.title)}-${batchIndex + 1}.json`,
      debugContext: {
        categoryTitle: category.title,
        targetIds: targets.map((target) => target.targetId),
        taskCount: targets.reduce((sum, target) => sum + target.tasks.length, 0),
        hasGlobalPrompt: Boolean(globalPrompt),
        taskDensity,
        knowledgeSnippets: summarizeSnippetsForDebug(snippets),
      },
    });
    const normalized = normalizeDraftCategoryResult(parsed, {
      ...category,
      tasks: targets.flatMap((target) => target.tasks),
    });
    sections.push(...normalized.sections);
    warnings.push(...normalized.warnings);
  }
  return {
    id: category.id,
    title: category.title,
    sourceHeading: category.sourceHeading || category.title,
    sections,
    warnings: normalizeStringList(warnings).slice(0, 5),
  };
}

function buildDraftKnowledgeQuery({ category, targets, globalPrompt }) {
  const targetText = targets.map((target) => [
    target.sourceHeading,
    target.headingPath.join(" "),
    cleanMultilineText(target.sourceText).slice(0, 1600),
    target.previousPlanSummary.join(" ").slice(0, 400),
    target.exclusiveBoundary.include.join(" ").slice(0, 400),
    target.exclusiveBoundary.handoffToChildren.join(" ").slice(0, 400),
    target.tasks.map((task) => [
      task.planningSummary,
      task.objective,
      normalizeStringList(task.executionPoints).join(" "),
      normalizeStringList(task.deliverables).join(" "),
    ].join(" ")).join(" ").slice(0, 1200),
  ].filter(Boolean).join(" ")).join(" ");
  return [
    category.title,
    category.sourceHeading,
    targetText,
    globalPrompt,
    "方案正文 业务场景 功能流程 规则 数据 交付 验收",
  ].filter(Boolean).join(" ").slice(0, 16000);
}

function buildDraftBatchPrompt({ category, targets, globalPrompt, knowledgeText, taskDensity, priorDraftContext = "" }) {
  const densityRule = getTaskDensityRule(taskDensity);
  const draftDensityPrompt = getDraftDensityPrompt(taskDensity);
  return [
    "输出 JSON：",
    '{"title":"类别标题","sections":[{"targetId":"paragraph-33","sourceHeading":"来源标题原文","title":"正文标题纯文本","content":"合并该目标全部规划后形成的一份方案正文"}],"warnings":["可为空"]}',
    "",
    `【全局提示词】\n${globalPrompt || "按正式政企技术方案语气生成，表达专业、清晰、可落地。"}`,
    "",
    `【当前任务类别】${category.sourceHeading || category.title}`,
    `【规划模式】${densityRule.label}`,
    `【正文丰富度要求】${draftDensityPrompt}`,
    "",
    priorDraftContext ? `【本类别前批已生成内容摘要】\n${priorDraftContext}` : "【本类别前批已生成内容摘要】\n本批次为该类别首批。",
    "",
    "【本批次精确写入目标】",
    targets.map(formatDraftTargetPrompt).join("\n\n"),
    "",
    knowledgeText ? `【知识库补充资料】\n${knowledgeText}` : "【知识库补充资料】\n未召回到补充资料，只能依据标题原文与任务规划写作。",
    "",
    "生成规则：",
    "1. 对上面每个 targetId 恰好返回一个 sections 项，不得遗漏、重复或添加未知 targetId；targetId 和 sourceHeading 必须逐字复制输入值。",
    "2. 同一目标下即使有多个规划任务，也必须整合成一份连贯正文；任务用于提供不同写作维度，不能按任务复制多份相似段落。",
    "3. content 必须是可直接放入当前标题正文区的正式方案文字，不写任务清单、写作建议、资料编号或“需继续补充”占位语。",
    "4. 丰富模式应按证据选择有价值的细节：结合适用对象与场景、角色与触发条件、处理步骤与业务规则、输入输出与数据流转、异常处理与闭环、协同关系、配置实施及验收要求；只写与当前标题语义和证据相符的维度，不套固定结构。",
    "5. 优先使用标题下原文的事实，再用知识库补充同范围细节；不得杜撰具体数量、性能指标、接口名称、产品能力或承诺。资料不足时使用审慎的范围描述，并在 warnings 说明缺口。",
    "6. 严格遵守标题路径与父子边界：父标题写定位、总体关系和能力边界，下级标题负责的细节只作衔接；叶子标题再深入具体场景、动作、规则和闭环。不得重复本类别前批或本批其他标题的正文。",
    "7. 结合 dependsOn、前序规划输入和 producesForNext 做自然承接，但不要在正文中暴露任务字段名。title 不要输出章节编号。",
  ].join("\n");
}

function getDraftDensityPrompt(density) {
  if (density === "rich") {
    return "每个 targetId 仍只输出一份正文，但应综合该目标下全部规划任务，并依据标题原文和知识库中可区分的事实维度组织多个自然段。优先展开适用场景、角色与触发、流程规则、输入输出、数据流转、异常闭环、配置实施和验收要求中与当前标题相关的部分；不得套固定模板或重复同一事实。";
  }
  if (density === "moderate") {
    return "每个 targetId 只输出一份正文，围绕目标、主要动作、边界和交付验收形成适度展开的连贯内容，不重复规划任务。";
  }
  return "每个 targetId 只输出一份简明正文，保留必要事实、核心动作和边界，不为增加篇幅扩写。";
}

function formatDraftTargetPrompt(target, index) {
  return [
    `${index + 1}. targetId：${target.targetId}`,
    `sourceHeading：${target.sourceHeading}`,
    `标题路径：${target.headingPath.join(" / ") || target.sourceHeading}`,
    `标题下原文：${target.sourceText || "未读取到原文。"}`,
    `前序承接：${target.previousPlanSummary.join("；") || "无"}`,
    `写作范围：${target.exclusiveBoundary.include.join("；") || "仅限当前标题"}`,
    `排除范围：${target.exclusiveBoundary.exclude.join("；") || "不得跨标题扩写"}`,
    `下沉给子标题：${target.exclusiveBoundary.handoffToChildren.join("；") || "无"}`,
    `前置依赖：${target.dependsOn.join("；") || "无"}`,
    `给后续标题的衔接：${target.producesForNext.join("；") || "无"}`,
    "聚合后的任务规划：",
    target.tasks.map((task, taskIndex) => [
      `  ${taskIndex + 1}) ${task.title || task.sourceHeading}`,
      `  规划摘要：${task.planningSummary || ""}`,
      `  目标：${task.objective || ""}`,
      `  展开要点：${normalizeStringList(task.executionPoints).join("；")}`,
      `  交付与验收：${normalizeStringList(task.deliverables).join("；")}`,
    ].join("\n")).join("\n"),
  ].join("\n");
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
        "丰富不是固定生成多份任务，而是依据标题原文、知识库证据、标题路径、上下级边界和前后文决定拆分深度。",
        "每个标题生成 1-4 个任务：只有一个明确事项时保持 1 个；存在多个有依据且可独立展开的业务对象、场景、角色、流程、规则、数据或验收维度时再拆成 2-4 个。",
        "先识别标题语义再策划细节：概述类侧重定位、目标、核心能力和边界；流程类侧重角色、触发、主流程、异常与闭环；功能类侧重功能分组、业务规则、输入输出与协同；实施或保障类侧重步骤、控制点、交付和验收。",
        "每个拆分任务必须有不同的写作焦点和内容边界，并明确引用标题原文或知识库中哪些事实作为展开依据，禁止把同一份通用内容换标题重复输出。",
        "父标题只形成统领性说明，并把下级标题负责的细节写入 handoffToChildren；叶子标题可结合已给证据深入到场景、动作、规则、数据流转、异常处理和验收闭环。",
        "知识库只用于补强当前标题范围内的事实和专业表达，不得引入不属于本章节或本次建设范围的功能、参数、接口、指标和承诺。",
        "资料不足时保持 1 个任务并明确待确认信息，不要用背景、流程、验收等固定套路硬凑数量。",
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
      category.contextRule,
      category.tasks?.slice(0, 12).map((task) => [
        task.sourceHeading,
        normalizeStringList(task.headingPath).join(" "),
        cleanMultilineText(task.sourceText).slice(0, 2000),
        task.previousPlanSummary,
        normalizeStringList(task.planningFocus).join(" "),
        normalizeStringList(task.exclusiveBoundary?.include).join(" "),
        normalizeStringList(task.exclusiveBoundary?.handoffToChildren).join(" "),
      ].filter(Boolean).join(" ")).join(" "),
    ].filter(Boolean).join(" "))
    .join(" ");
  return [
    cleanText(userInstruction),
    cleanText(categoryText).slice(0, 12000),
    cleanText(outlineText).slice(0, 3000),
    "方案编制 任务规划 执行任务 技术方案 项目实施",
  ].filter(Boolean).join(" ");
}

function normalizeTaskPlanInputTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => {
      const replaceTarget = normalizeSolutionReplaceTarget(task?.replaceTarget);
      return {
        id: cleanText(task?.id) || `task-${index + 1}`,
        targetId: buildParagraphTargetId(replaceTarget),
        sourceHeading: cleanText(task?.sourceHeading || task?.title),
        sourceText: cleanMultilineText(task?.sourceText).slice(0, 4000),
        replaceTarget,
        headingPath: normalizeStringList(task?.headingPath).slice(0, 12),
        planningFocus: normalizeStringList(task?.planningFocus).slice(0, 8),
        previousPlanSummary: cleanText(task?.previousPlanSummary).slice(0, 1000),
        exclusiveBoundary: {
          include: normalizeStringList(task?.exclusiveBoundary?.include).slice(0, 8),
          exclude: normalizeStringList(task?.exclusiveBoundary?.exclude).slice(0, 8),
          handoffToChildren: normalizeStringList(task?.exclusiveBoundary?.handoffToChildren).slice(0, 8),
        },
      };
    })
    .filter((task) => task.sourceHeading)
    .slice(0, 80);
}

function normalizeTaskPlanCategoryResult(parsed, fallbackCategory, taskDensity = "concise") {
  const densityRule = getTaskDensityRule(taskDensity);
  const inputTasks = fallbackCategory.tasks;
  const rows = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  const inputsByTargetId = new Map();
  inputTasks.forEach((task) => {
    if (!task.targetId) {
      throwGenerationValidationError(`任务“${task.sourceHeading}”缺少保存的精确标题位置。`);
    }
    if (inputsByTargetId.has(task.targetId)) {
      throwGenerationValidationError(`任务规划输入包含重复目标：${task.targetId}`);
    }
    inputsByTargetId.set(task.targetId, task);
  });
  const seenRows = new Set();
  rows.forEach((row) => {
    const targetId = cleanText(row?.targetId);
    const inputTask = inputsByTargetId.get(targetId);
    if (!targetId) throwGenerationValidationError("任务规划返回了缺少 targetId 的任务。");
    if (!inputTask) throwGenerationValidationError(`任务规划返回了未知目标：${targetId}`);
    if (cleanText(row?.sourceHeading) !== inputTask.sourceHeading) {
      throwGenerationValidationError(`任务规划目标 ${targetId} 的 sourceHeading 与保存标题不一致。`);
    }
    const rowKey = [targetId, cleanText(row?.taskTitle), cleanMultilineText(row?.planningSummary), cleanMultilineText(row?.objective)].join("\u0000");
    if (seenRows.has(rowKey)) throwGenerationValidationError(`任务规划目标 ${targetId} 返回了重复任务。`);
    seenRows.add(rowKey);
  });
  const tasks = inputTasks.flatMap((inputTask, index) => {
    const sourceHeading = inputTask.sourceHeading;
    const matchedRows = rows.filter((row) => cleanText(row?.targetId) === inputTask.targetId);
    if (!matchedRows.length) {
      throwGenerationValidationError(`任务规划缺少目标：${inputTask.targetId}（${sourceHeading}）`);
    }
    if (matchedRows.length > densityRule.maxTasksPerHeading) {
      throwGenerationValidationError(`任务规划目标 ${inputTask.targetId} 超出${densityRule.label}模式允许的任务数量。`);
    }
    return matchedRows
      .slice(0, densityRule.maxTasksPerHeading)
      .map((matched, splitIndex) => normalizeTaskPlanRow({
        matched,
        inputTask,
        sourceHeading,
        targetId: inputTask.targetId,
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

function normalizeTaskPlanRow({ matched, inputTask, sourceHeading, targetId, index, splitIndex }) {
  const taskTitle = cleanTitle(matched.taskTitle);
  const planningSummary = cleanMultilineText(matched.planningSummary);
  const objective = cleanMultilineText(matched.objective);
  const executionPoints = normalizeStringList(matched.executionPoints).slice(0, 10);
  const deliverables = normalizeStringList(matched.deliverables).slice(0, 10);
  if (!taskTitle || !planningSummary || !objective || !executionPoints.length || !deliverables.length) {
    throwGenerationValidationError(`任务规划目标 ${targetId} 返回内容不完整，必须包含任务名称、规划摘要、目标、执行要点和交付物。`);
  }
  const idSuffix = splitIndex > 0 ? `-${splitIndex + 1}` : "";
  return {
    id: `${inputTask.id || `task-${index + 1}`}${idSuffix}`,
    targetId,
    title: taskTitle ? `规划${taskTitle}对应执行任务` : `规划${cleanTitle(sourceHeading)}对应执行任务`,
    sourceHeading,
    sourceText: inputTask.sourceText || "未读取到标题下原文。",
    bodyState: inputTask.sourceText ? "已有标题原文" : "原文待读取",
    headingPath: inputTask.headingPath || [],
    replaceTarget: inputTask.replaceTarget || null,
    planningFocus: inputTask.planningFocus || [],
    previousPlanSummary: inputTask.previousPlanSummary || "",
    planningSummary,
    objective,
    exclusiveBoundary: {
      include: withFallbackList(matched.exclusiveBoundary?.include, inputTask.exclusiveBoundary?.include).slice(0, 8),
      exclude: withFallbackList(matched.exclusiveBoundary?.exclude, inputTask.exclusiveBoundary?.exclude).slice(0, 8),
      handoffToChildren: withFallbackList(matched.exclusiveBoundary?.handoffToChildren, inputTask.exclusiveBoundary?.handoffToChildren).slice(0, 8),
    },
    executionPoints,
    deliverables,
    dependsOn: normalizeStringList(matched.dependsOn).slice(0, 8),
    producesForNext: normalizeStringList(matched.producesForNext).slice(0, 8),
  };
}

function normalizeDraftTaskPlan(taskPlan = {}) {
  const rawCategories = Array.isArray(taskPlan.categories) ? taskPlan.categories : [];
  return {
    taskDensity: normalizeTaskDensity(taskPlan.taskDensity || taskPlan.stats?.taskDensity),
    categories: rawCategories.slice(0, 20).map((category, categoryIndex) => ({
      id: cleanText(category?.id) || `task-category-${categoryIndex + 1}`,
      title: cleanTitle(category?.title || category?.sourceHeading || `任务类别${categoryIndex + 1}`),
      sourceHeading: cleanText(category?.sourceHeading || category?.title),
      boundary: {
        include: cleanText(category?.boundary?.include),
        exclude: cleanText(category?.boundary?.exclude),
      },
      contextRule: cleanText(category?.contextRule),
      tasks: (Array.isArray(category?.tasks) ? category.tasks : [])
          .map((task, index) => {
            const replaceTarget = normalizeSolutionReplaceTarget(task?.replaceTarget);
            return {
              id: cleanText(task?.id) || `task-${index + 1}`,
              targetId: buildParagraphTargetId(replaceTarget),
              title: cleanTitle(task?.title || task?.taskTitle || task?.sourceHeading || `任务${index + 1}`),
              sourceHeading: cleanText(task?.sourceHeading || task?.title),
              sourceText: cleanMultilineText(task?.sourceText).slice(0, 4000),
              bodyState: cleanText(task?.bodyState),
              headingPath: normalizeStringList(task?.headingPath).slice(0, 12),
              replaceTarget,
              planningFocus: normalizeStringList(task?.planningFocus).slice(0, 8),
              previousPlanSummary: cleanText(task?.previousPlanSummary).slice(0, 1000),
              planningSummary: cleanMultilineText(task?.planningSummary).slice(0, 1200),
              objective: cleanMultilineText(task?.objective).slice(0, 1200),
              executionPoints: normalizeStringList(task?.executionPoints).slice(0, 10),
              deliverables: normalizeStringList(task?.deliverables).slice(0, 10),
              dependsOn: normalizeStringList(task?.dependsOn).slice(0, 8),
              producesForNext: normalizeStringList(task?.producesForNext).slice(0, 8),
              exclusiveBoundary: {
                include: normalizeStringList(task?.exclusiveBoundary?.include).slice(0, 8),
                exclude: normalizeStringList(task?.exclusiveBoundary?.exclude).slice(0, 8),
                handoffToChildren: normalizeStringList(task?.exclusiveBoundary?.handoffToChildren).slice(0, 8),
              },
            };
          })
          .slice(0, 80),
    })).filter((category) => category.tasks.length),
  };
}

function normalizeDraftCategoryResult(parsed, fallbackCategory) {
  const targets = groupDraftTasksByTarget(fallbackCategory.tasks);
  const targetsById = new Map(targets.map((target) => [target.targetId, target]));
  const rows = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const rowsById = new Map();
  rows.forEach((row) => {
    const targetId = cleanText(row?.targetId);
    if (!targetId) throwGenerationValidationError("方案正文返回了缺少 targetId 的内容。");
    const target = targetsById.get(targetId);
    if (!target) throwGenerationValidationError(`方案正文返回了未知目标：${targetId}`);
    if (rowsById.has(targetId)) throwGenerationValidationError(`方案正文目标 ${targetId} 返回了重复内容。`);
    if (cleanText(row?.sourceHeading) !== target.sourceHeading) {
      throwGenerationValidationError(`方案正文目标 ${targetId} 的 sourceHeading 与保存标题不一致。`);
    }
    if (!cleanMultilineText(row?.content)) {
      throwGenerationValidationError(`方案正文目标 ${targetId} 返回了空内容。`);
    }
    if (isDraftPlaceholderContent(row.content)) {
      throwGenerationValidationError(`方案正文目标 ${targetId} 只返回了待补充占位内容。`);
    }
    rowsById.set(targetId, row);
  });
  const missingTarget = targets.find((target) => !rowsById.has(target.targetId));
  if (missingTarget) {
    throwGenerationValidationError(`方案正文缺少目标：${missingTarget.targetId}（${missingTarget.sourceHeading}）`);
  }
  const sections = targets.map((target) => {
    const matched = rowsById.get(target.targetId);
    return {
      id: target.targetId,
      targetId: target.targetId,
      sourceHeading: target.sourceHeading,
      replaceTarget: target.replaceTarget,
      title: cleanTitle(matched.title || target.sourceHeading),
      content: cleanMultilineText(matched.content),
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

function validatePrecisePlanningTargets(categories) {
  const seen = new Set();
  categories.forEach((category) => {
    category.tasks.forEach((task) => {
      if (!task.targetId) {
        throwGenerationValidationError(`任务“${task.sourceHeading}”缺少保存的精确标题位置。`);
      }
      if (seen.has(task.targetId)) {
        throwGenerationValidationError(`任务规划输入包含重复目标：${task.targetId}`);
      }
      seen.add(task.targetId);
    });
  });
}

function validatePreciseDraftTargets(categories) {
  const seen = new Map();
  categories.forEach((category) => {
    groupDraftTasksByTarget(category.tasks).forEach((target) => {
      if (seen.has(target.targetId)) {
        throwGenerationValidationError(`方案正文输入包含跨类别重复目标：${target.targetId}`);
      }
      seen.set(target.targetId, category.id);
    });
  });
}

function buildParagraphTargetId(replaceTarget) {
  const paragraphIndex = Number(replaceTarget?.styleRef?.paragraphIndex);
  return Number.isInteger(paragraphIndex) && paragraphIndex >= 0 ? `paragraph-${paragraphIndex}` : "";
}

function groupDraftTasksByTarget(tasks = []) {
  const groups = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const replaceTarget = normalizeSolutionReplaceTarget(task?.replaceTarget);
    const targetId = buildParagraphTargetId(replaceTarget);
    const sourceHeading = cleanText(task?.sourceHeading);
    if (!targetId) {
      throwGenerationValidationError(`任务“${sourceHeading || cleanText(task?.title) || "未命名"}”缺少保存的精确标题位置。`);
    }
    if (!sourceHeading) throwGenerationValidationError(`目标 ${targetId} 缺少 sourceHeading。`);
    if (replaceTarget.title && cleanText(replaceTarget.title) !== sourceHeading) {
      throwGenerationValidationError(`目标 ${targetId} 的任务标题与保存标题不一致。`);
    }
    const existing = groups.get(targetId);
    if (existing && existing.sourceHeading !== sourceHeading) {
      throwGenerationValidationError(`目标 ${targetId} 关联了多个不同来源标题。`);
    }
    const group = existing || {
      targetId,
      sourceHeading,
      replaceTarget,
      sourceText: "",
      headingPath: normalizeStringList(task?.headingPath || replaceTarget.headingPath).slice(0, 12),
      previousPlanSummary: [],
      exclusiveBoundary: { include: [], exclude: [], handoffToChildren: [] },
      dependsOn: [],
      producesForNext: [],
      tasks: [],
    };
    group.sourceText = mergeTextValues(group.sourceText, cleanMultilineText(task?.sourceText).slice(0, 4000));
    group.previousPlanSummary = mergeStringLists(group.previousPlanSummary, [task?.previousPlanSummary]);
    group.exclusiveBoundary.include = mergeStringLists(group.exclusiveBoundary.include, task?.exclusiveBoundary?.include);
    group.exclusiveBoundary.exclude = mergeStringLists(group.exclusiveBoundary.exclude, task?.exclusiveBoundary?.exclude);
    group.exclusiveBoundary.handoffToChildren = mergeStringLists(group.exclusiveBoundary.handoffToChildren, task?.exclusiveBoundary?.handoffToChildren);
    group.dependsOn = mergeStringLists(group.dependsOn, task?.dependsOn);
    group.producesForNext = mergeStringLists(group.producesForNext, task?.producesForNext);
    group.tasks.push({ ...task, targetId, replaceTarget });
    groups.set(targetId, group);
  });
  return Array.from(groups.values());
}

function buildPriorPlanningContext(tasks = []) {
  return tasks.slice(-12).map((task) => [
    task.sourceHeading,
    task.planningSummary,
    normalizeStringList(task.producesForNext).join("；"),
  ].filter(Boolean).join("：")).join("\n").slice(0, 4000);
}

function buildPriorDraftContext(sections = []) {
  return sections.slice(-4).map((section) => [
    section.sourceHeading,
    cleanMultilineText(section.content).slice(0, 300),
  ].filter(Boolean).join("：")).join("\n").slice(0, 1800);
}

function isDraftPlaceholderContent(value) {
  const text = cleanText(value).replace(/[“”"']/g, "");
  if (text.length > 120) return false;
  return /^(?:需结合|待结合|需根据|待根据).*(?:补充|完善)(?:该标题的)?(?:方案)?(?:正文|内容|写作要点)?[。.！!]*$/.test(text)
    || /^(?:待补充|暂无资料|资料不足|待确认)[。.！!]*$/.test(text);
}

function mergeTextValues(current, next) {
  if (!next || current === next) return current;
  return [current, next].filter(Boolean).join("\n");
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function throwGenerationValidationError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  throw error;
}

function withFallbackList(value, fallback) {
  const rows = normalizeStringList(value);
  return rows.length ? rows : normalizeStringList(fallback);
}

function normalizeSolutionReplaceTarget(target) {
  if (!target || typeof target !== "object") return null;
  const styleRef = normalizeSolutionStyleRef(target.styleRef);
  const bodyStyleRef = normalizeSolutionStyleRef(target.bodyStyleRef);
  const title = cleanText(target.title);
  const rawBodyParagraphCount = target.bodyParagraphCount;
  const bodyParagraphCount = rawBodyParagraphCount == null || String(rawBodyParagraphCount).trim() === ""
    ? null
    : Number(rawBodyParagraphCount);
  return title || styleRef
    ? {
      title,
      headingPath: normalizeStringList(target.headingPath).slice(0, 12),
      styleRef,
      bodyStyleRef,
      bodyParagraphCount: Number.isInteger(bodyParagraphCount) && bodyParagraphCount >= 0 ? bodyParagraphCount : null,
    }
    : null;
}

function normalizeSolutionStyleRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const paragraphIndex = Number(ref.paragraphIndex);
  if (!Number.isFinite(paragraphIndex)) return null;
  return {
    paragraphIndex,
    outlineIndex: Number.isFinite(Number(ref.outlineIndex)) ? Number(ref.outlineIndex) : null,
    title: cleanText(ref.title),
    text: cleanText(ref.text),
    level: Number.isFinite(Number(ref.level)) ? Number(ref.level) : null,
    styleName: cleanText(ref.styleName),
  };
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

function mergeStringLists(primary, fallback) {
  const merged = [...normalizeStringList(primary), ...normalizeStringList(fallback)];
  return Array.from(new Set(merged));
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
  buildDraftBatchPrompt,
  buildDraftKnowledgeQuery,
  buildParagraphTargetId,
  buildSolutionModuleText,
  buildTaskPlanBatchPrompt,
  generateSolutionDraftContent,
  generateSolutionModuleSections,
  generateSolutionTaskPlan,
  getTaskDensityRule,
  getDraftDensityPrompt,
  groupDraftTasksByTarget,
  identifySolutionModules,
  normalizeDraftCategoryResult,
  normalizeDraftTaskPlan,
  normalizeTaskPlanCategoryResult,
  testSolutionTaskKnowledge,
  validatePreciseDraftTargets,
};

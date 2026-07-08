function buildTaskPlanningPreview(outlineItems = []) {
  const rows = normalizeOutlineRows(outlineItems);
  if (!rows.length) return { categories: [], stats: getTaskPlanStats([]), outlineText: "" };

  const rootLevel = Math.min(...rows.map((item) => item.level));
  const outlineText = buildOutlineText(rows, rootLevel);
  const categories = [];
  let currentCategory = null;
  const stack = [];

  rows.forEach((item, position) => {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    const headingPath = [...stack.map((parent) => parent.title), item.title];

    if (item.level === rootLevel) {
      currentCategory = createCategory(item, categories.length);
      categories.push(currentCategory);
      stack.push(item);
      return;
    }

    if (!currentCategory) {
      currentCategory = createFallbackCategory(categories.length);
      categories.push(currentCategory);
    }

    const previousTask = currentCategory.tasks[currentCategory.tasks.length - 1] || null;
    const task = createTask(item, {
      headingPath,
      childTitles: getChildTitles(rows, position),
      previousTask,
      outlineText,
    });
    currentCategory.tasks.push(task);
    stack.push(item);
  });

  const filteredCategories = categories.filter((category) => category.tasks.length > 0);
  return {
    categories: filteredCategories,
    stats: getTaskPlanStats(filteredCategories),
    outlineText,
  };
}

function normalizeOutlineRows(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, position) => ({
      id: String(item.index ?? position),
      title: String(item.title || item.displayTitle || "").trim(),
      level: Number.isFinite(Number(item.level)) ? Number(item.level) : 0,
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : position,
      bodyText: String(item.bodyText || "").trim(),
    }))
    .filter((item) => item.title)
    .sort((a, b) => a.index - b.index);
}

function createCategory(item, position) {
  const title = stripHeadingNumber(item.title);
  return {
    id: `task-category-${item.id || position}`,
    title,
    sourceHeading: item.title,
    boundary: {
      include: `围绕“${title}”一级章节下的全部标题生成执行任务。`,
      exclude: "不承接其他一级章节的实施、运维、管理或保障类任务。",
    },
    contextRule: "本类别内按大纲顺序传递前序规划；进入下一个一级类别后，前序规划上下文重置。",
    tasks: [],
  };
}

function createFallbackCategory(position) {
  return {
    id: `task-category-uncategorized-${position}`,
    title: "未归类任务",
    sourceHeading: "未识别到一级标题",
    boundary: {
      include: "承接未挂靠到一级标题下的标题节点。",
      exclude: "不合并到其他已识别一级章节。",
    },
    contextRule: "未归类节点只在本组内传递前序规划。",
    tasks: [],
  };
}

function createTask(item, { headingPath, childTitles, previousTask, outlineText }) {
  const title = stripHeadingNumber(item.title);
  const handoffToChildren = childTitles.slice(0, 4).map((childTitle) => `具体内容下沉到“${stripHeadingNumber(childTitle)}”任务处理`);
  const parentTitle = headingPath.length > 1 ? stripHeadingNumber(headingPath[headingPath.length - 2]) : "";
  const sourceText = item.bodyText || "当前前端预览仅读取到标题；后续接 OnlyOffice 正文区间后，这里展示该标题下对应原文。";
  const previousPlanSummary = previousTask
    ? `上个已规划标题：${previousTask.sourceHeading}；已形成：${previousTask.producesForNext.join("、")}。当前标题规划时需要承接这些产出，避免重复。`
    : "本类别第一个规划单元，无前序规划输入。";
  return {
    id: `task-${item.id}`,
    title: `规划${title}对应执行任务`,
    sourceHeading: item.title,
    sourceText,
    headingPath,
    bodyState: item.bodyText ? "已有标题原文" : "原文待读取",
    globalArchitecture: outlineText,
    planningFocus: [
      `先判断“${title}”在整体方案架构中的作用。`,
      "再基于本标题和标题下原文规划这部分应该写清楚什么、怎么写、形成哪些执行任务。",
      "规划结果必须符合完整大纲结构，不跨章节抢写其他标题内容。",
    ],
    previousPlanSummary,
    exclusiveBoundary: {
      include: [
        `基于“${title}”及其对应原文生成任务。`,
        "任务需要说明执行目标、关键动作和交付结果。",
      ],
      exclude: [
        parentTitle ? `不重复“${parentTitle}”已经覆盖的总体内容。` : "不重复类别总体说明。",
        childTitles.length ? "不抢写下级标题负责的细节。" : "不扩展原文没有体现的内容。",
      ],
      handoffToChildren,
    },
    previousContextUsed: previousTask
      ? `承接前序任务“${previousTask.title}”产出的 ${previousTask.produces.join("、")}。`
      : "本类别首个子任务，承接一级任务类别边界启动。",
    objective: `形成“${title}”对应的可执行任务安排。`,
    executionPoints: [
      "判断这部分需要 AI 规划哪些执行任务。",
      "提炼任务动作、交付物和验收关注点。",
      "原文不足时标记需要补充或确认的内容。",
    ],
    deliverables: ["任务边界说明", `${title}执行要点`, "验收关注点清单"],
    produces: [`${title}任务边界`, `${title}执行依据`],
    producesForNext: [`${title}规划边界`, `${title}执行任务清单`, `${title}交付物要求`],
    dependsOn: previousTask ? [previousTask.title] : [],
  };
}

function buildOutlineText(rows, rootLevel) {
  return rows
    .map((item) => {
      const depth = Math.max(0, item.level - rootLevel);
      return `${"  ".repeat(depth)}- ${item.title}`;
    })
    .join("\n");
}

function getChildTitles(rows, position) {
  const item = rows[position];
  if (!item) return [];
  const descendants = [];
  for (let index = position + 1; index < rows.length; index += 1) {
    const next = rows[index];
    if (next.level <= item.level) break;
    descendants.push(next);
  }
  if (!descendants.length) return [];
  const directLevel = Math.min(...descendants.map((child) => child.level));
  return descendants.filter((child) => child.level === directLevel).map((child) => child.title);
}

function getTaskPlanStats(categories) {
  const tasks = categories.flatMap((category) => category.tasks);
  const maxDepth = tasks.reduce((max, task) => Math.max(max, task.headingPath.length), 0);
  return {
    categoryCount: categories.length,
    taskCount: tasks.length,
    maxDepth,
    pendingBodyCount: tasks.filter((task) => task.bodyState === "原文待读取").length,
  };
}

function stripHeadingNumber(title) {
  return String(title || "")
    .replace(/^(?:\d+\.\d+(?:\.\d+)*\s*|\d+[、.．\s]+|[一二三四五六七八九十]+[、.．\s]+)/, "")
    .replace(/^[（(](?:\d+|[一二三四五六七八九十]+)[）)]\s*/, "")
    .trim();
}

export {
  buildTaskPlanningPreview,
};

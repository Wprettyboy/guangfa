function buildTaskPlanningPreview(outlineItems = []) {
  const rows = normalizeOutlineRows(outlineItems);
  if (!rows.length) return { categories: [], stats: getTaskPlanStats([]) };

  const rootLevel = Math.min(...rows.map((item) => item.level));
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
    });
    currentCategory.tasks.push(task);
    stack.push(item);
  });

  const filteredCategories = categories.filter((category) => category.tasks.length > 0);
  return {
    categories: filteredCategories,
    stats: getTaskPlanStats(filteredCategories),
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
    tasks: [],
  };
}

function createTask(item, { headingPath, childTitles, previousTask }) {
  const title = stripHeadingNumber(item.title);
  const handoffToChildren = childTitles.slice(0, 4).map((childTitle) => `具体内容下沉到“${stripHeadingNumber(childTitle)}”任务处理`);
  const parentTitle = headingPath.length > 1 ? stripHeadingNumber(headingPath[headingPath.length - 2]) : "";
  return {
    id: `task-${item.id}`,
    title: `完成${title}相关执行任务`,
    sourceHeading: item.title,
    headingPath,
    bodyState: item.bodyText ? "已有正文" : "正文待读取",
    exclusiveBoundary: {
      include: [
        `围绕“${title}”标题及正文要求拆解执行事项。`,
        "明确本标题对应的执行步骤、交付物和验收关注点。",
      ],
      exclude: [
        parentTitle ? `不重复上级“${parentTitle}”的总体范围说明。` : "不重复一级类别的总体说明。",
        childTitles.length ? "不提前展开下级标题的具体执行细节。" : "不扩展文档未体现的额外功能范围。",
      ],
      handoffToChildren,
    },
    previousContextUsed: previousTask
      ? `承接前序任务“${previousTask.title}”产出的 ${previousTask.produces.join("、")}。`
      : "本类别首个子任务，承接一级任务类别边界启动。",
    objective: `形成“${title}”对应的可执行任务安排。`,
    executionPoints: [
      "确认标题正文中的任务边界和执行对象。",
      "拆解具体执行步骤、责任输入和验收关注点。",
      "对正文不足的部分标记为待补充或待确认。",
    ],
    deliverables: ["任务边界说明", `${title}执行要点`, "验收关注点清单"],
    produces: [`${title}任务边界`, `${title}执行依据`],
    dependsOn: previousTask ? [previousTask.title] : [],
  };
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
    pendingBodyCount: tasks.filter((task) => task.bodyState === "正文待读取").length,
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraftBatchPrompt,
  buildDraftKnowledgeQuery,
  buildParagraphTargetId,
  getDraftDensityPrompt,
  getTaskDensityRule,
  groupDraftTasksByTarget,
  normalizeDraftCategoryResult,
  normalizeDraftTaskPlan,
  normalizeTaskPlanCategoryResult,
  validatePreciseDraftTargets,
} from "../server/solution-writing/generator.js";

function createReplaceTarget(paragraphIndex, title) {
  return {
    title,
    headingPath: [title],
    styleRef: { paragraphIndex, title },
    bodyStyleRef: { paragraphIndex: paragraphIndex + 1, title: `${title} 正文` },
    bodyParagraphCount: 1,
  };
}

function createPlanningInput(paragraphIndex, sourceHeading) {
  const replaceTarget = createReplaceTarget(paragraphIndex, sourceHeading);
  return {
    id: `task-${paragraphIndex}`,
    targetId: buildParagraphTargetId(replaceTarget),
    sourceHeading,
    sourceText: `${sourceHeading} 原文事实`,
    headingPath: ["详细功能设计", sourceHeading],
    replaceTarget,
    planningFocus: ["根据原文和知识库拆分有依据的细节"],
    previousPlanSummary: "承接前序边界，不重复前文。",
    exclusiveBoundary: {
      include: ["只写当前标题"],
      exclude: ["不写相邻标题"],
      handoffToChildren: ["子标题负责具体步骤"],
    },
  };
}

function createDraftTask(input, suffix) {
  return {
    ...input,
    id: `${input.id}-${suffix}`,
    title: `${input.sourceHeading}-${suffix}`,
    planningSummary: `${suffix}对应的独立规划事实`,
    objective: `${suffix}目标`,
    executionPoints: [`${suffix}执行要点`],
    deliverables: [`${suffix}交付物`],
    dependsOn: [],
    producesForNext: [`${suffix}边界`],
  };
}

test("rich task planning keeps model-evidenced splits instead of forcing three tasks", () => {
  const input = createPlanningInput(33, "3.1 功能概述");
  const category = {
    id: "category-3",
    title: "详细功能设计",
    sourceHeading: "3 详细功能设计",
    boundary: {},
    contextRule: "类别内承接",
    tasks: [input],
  };
  const oneTask = {
    targetId: input.targetId,
    sourceHeading: input.sourceHeading,
    taskTitle: "模块定位与边界",
    planningSummary: "知识库仅支持一个明确建设维度。",
    objective: "形成模块定位说明。",
    executionPoints: ["说明模块定位、适用对象和能力边界。"],
    deliverables: ["模块定位与边界说明"],
  };

  const single = normalizeTaskPlanCategoryResult({ tasks: [oneTask] }, category, "rich");
  assert.equal(single.tasks.length, 1);
  assert.equal(single.tasks[0].targetId, "paragraph-33");

  const split = normalizeTaskPlanCategoryResult({
    tasks: [
      oneTask,
      { ...oneTask, taskTitle: "业务流程闭环", planningSummary: "知识库还支持独立的流程事实。" },
    ],
  }, category, "rich");
  assert.equal(split.tasks.length, 2);

  assert.throws(
    () => normalizeTaskPlanCategoryResult({ tasks: [] }, category, "rich"),
    /任务规划缺少目标/,
  );
  assert.throws(
    () => normalizeTaskPlanCategoryResult({ tasks: [{ ...oneTask, targetId: "paragraph-999" }] }, category, "rich"),
    /未知目标/,
  );
  assert.throws(
    () => normalizeTaskPlanCategoryResult({ tasks: [{ ...oneTask, planningSummary: "" }] }, category, "rich"),
    /返回内容不完整/,
  );
});

test("draft generation groups plans by precise target and requires one exact response", () => {
  const firstInput = createPlanningInput(33, "3.1 功能概述");
  const secondInput = createPlanningInput(48, "4.1 功能概述");
  const tasks = [
    createDraftTask(firstInput, "场景"),
    createDraftTask(firstInput, "流程"),
    createDraftTask(firstInput, "验收"),
    createDraftTask(secondInput, "接口"),
  ];
  const targets = groupDraftTasksByTarget(tasks);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].tasks.length, 3);
  assert.equal(targets[1].tasks.length, 1);

  const category = {
    id: "category-draft",
    title: "详细功能设计",
    sourceHeading: "3 详细功能设计",
    tasks,
  };
  const reversedResponse = {
    title: "详细功能设计",
    sections: [
      {
        targetId: secondInput.targetId,
        sourceHeading: secondInput.sourceHeading,
        title: "功能概述",
        content: "第二个精确目标的正文。",
      },
      {
        targetId: firstInput.targetId,
        sourceHeading: firstInput.sourceHeading,
        title: "功能概述",
        content: "三项规划聚合后的一份丰富正文。",
      },
    ],
  };
  const normalized = normalizeDraftCategoryResult(reversedResponse, category);
  assert.equal(normalized.sections.length, 2);
  assert.deepEqual(normalized.sections.map((section) => section.targetId), ["paragraph-33", "paragraph-48"]);
  assert.equal(normalized.sections[0].content, "三项规划聚合后的一份丰富正文。");

  assert.throws(
    () => normalizeDraftCategoryResult({ sections: reversedResponse.sections.slice(0, 1) }, category),
    /方案正文缺少目标/,
  );
  assert.throws(
    () => normalizeDraftCategoryResult({ sections: [reversedResponse.sections[1], reversedResponse.sections[1]] }, { ...category, tasks: tasks.slice(0, 3) }),
    /返回了重复内容/,
  );
  assert.throws(
    () => normalizeDraftCategoryResult({ sections: [{ ...reversedResponse.sections[1], targetId: "paragraph-999" }] }, { ...category, tasks: tasks.slice(0, 3) }),
    /未知目标/,
  );
  assert.throws(
    () => normalizeDraftCategoryResult({ sections: [{ ...reversedResponse.sections[1], content: "" }] }, { ...category, tasks: tasks.slice(0, 3) }),
    /返回了空内容/,
  );
  assert.throws(
    () => normalizeDraftCategoryResult({ sections: [{ ...reversedResponse.sections[1], sourceHeading: "其他标题" }] }, { ...category, tasks: tasks.slice(0, 3) }),
    /sourceHeading 与保存标题不一致/,
  );
  assert.throws(
    () => normalizeDraftCategoryResult({ sections: [{ ...reversedResponse.sections[1], content: "需结合项目资料补充该标题的方案正文。" }] }, { ...category, tasks: tasks.slice(0, 3) }),
    /待补充占位内容/,
  );
});

test("rich draft prompt requests detailed paragraphs without multiplying sections", () => {
  const input = createPlanningInput(33, "3.1 功能概述");
  const targets = groupDraftTasksByTarget([
    createDraftTask(input, "场景"),
    createDraftTask(input, "流程"),
    createDraftTask(input, "验收"),
  ]);
  const prompt = buildDraftBatchPrompt({
    category: { title: "详细功能设计", sourceHeading: "3 详细功能设计" },
    targets,
    globalPrompt: "使用正式技术方案语气。",
    knowledgeText: "知识库事实：支持值班流程闭环。",
    taskDensity: "rich",
  });

  assert.match(prompt, /每个 targetId 恰好返回一个 sections 项/);
  assert.match(prompt, /多个自然段/);
  assert.match(prompt, /知识库事实：支持值班流程闭环/);
  assert.doesNotMatch(prompt, /每个标题生成 1-4 个任务/);
  assert.match(getDraftDensityPrompt("rich"), /仍只输出一份正文/);
  assert.match(getTaskDensityRule("rich").prompt, /标题原文、知识库证据、标题路径、上下级边界和前后文/);
  assert.match(getTaskDensityRule("rich").prompt, /资料不足时保持 1 个任务/);
});

test("draft task normalization keeps same-named categories on their own exact targets", () => {
  const first = createPlanningInput(10, "1.1 功能概述");
  const second = createPlanningInput(20, "2.1 功能概述");
  const normalized = normalizeDraftTaskPlan({
    taskDensity: "rich",
    categories: [
      { id: "category-a", title: "详细设计", sourceHeading: "详细设计", tasks: [createDraftTask(first, "场景")] },
      { id: "category-b", title: "详细设计", sourceHeading: "详细设计", tasks: [createDraftTask(second, "流程")] },
    ],
  });

  assert.deepEqual(normalized.categories.map((category) => category.tasks[0].targetId), ["paragraph-10", "paragraph-20"]);
  assert.doesNotThrow(() => validatePreciseDraftTargets(normalized.categories));

  normalized.categories[1].tasks[0].replaceTarget = createReplaceTarget(10, second.sourceHeading);
  assert.throws(() => validatePreciseDraftTargets(normalized.categories), /跨类别重复目标/);
});

test("draft knowledge query preserves every target in a full batch", () => {
  const targets = [10, 20, 30, 40].map((paragraphIndex) => {
    const input = createPlanningInput(paragraphIndex, `${paragraphIndex}.1 功能概述`);
    const target = groupDraftTasksByTarget([createDraftTask(input, `标记-${paragraphIndex}`)])[0];
    target.sourceText = `目标标记-${paragraphIndex} ${"正文".repeat(2000)}`;
    return target;
  });
  const query = buildDraftKnowledgeQuery({ category: { title: "详细设计" }, targets, globalPrompt: "正式方案" });

  targets.forEach((target) => assert.match(query, new RegExp(`目标标记-${target.replaceTarget.styleRef.paragraphIndex}`)));
});

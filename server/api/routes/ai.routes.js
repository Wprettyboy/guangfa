import { createKnowledgeChat } from "../../ai/chat.js";
import { fillField } from "../../ai/fill.js";
import { createFormatOutlinePlan } from "../../ai/format-outline.js";
import { createAiKnowledgeSearch } from "../../ai/knowledge-query.js";
import { generateSolutionModuleSections, generateSolutionTaskPlan, identifySolutionModules } from "../../solution-writing/generator.js";
import { defineRoute } from "../registry.js";

const aiBodyLimitBytes = 2 * 1024 * 1024;

function registerAiRoutes() {
  defineRoute({
    id: "ai.fill.field",
    method: "POST",
    path: "/api/ai/fill-field",
    tags: ["ai"],
    summary: "AI 填充单个字段",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { field: "object?", knowledgeOptions: "object?", fields: "array?" },
    responses: { 200: "object" },
    handler: ({ body }) => fillField(body),
  });

  defineRoute({
    id: "ai.format.outline.plan",
    method: "POST",
    path: "/api/ai/format-outline-plan",
    tags: ["ai", "format"],
    summary: "生成格式大纲修复计划",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { candidates: "array?", outline: "object?", userInstruction: "string?" },
    responses: { 200: "object" },
    handler: ({ body }) => createFormatOutlinePlan(body),
  });

  defineRoute({
    id: "ai.chat",
    method: "POST",
    path: "/api/ai/chat",
    tags: ["ai"],
    summary: "知识库聊天",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { message: "string", history: "array?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => createKnowledgeChat(body),
  });

  defineRoute({
    id: "ai.knowledge.search",
    method: "POST",
    path: "/api/ai/knowledge-search",
    tags: ["ai", "knowledge"],
    summary: "AI 知识库检索",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { query: "string?", field: "object?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => createAiKnowledgeSearch(body),
  });

  defineRoute({
    id: "ai.solution.identifyModules",
    method: "POST",
    path: "/api/ai/solution-identify-modules",
    tags: ["ai", "solution-writing"],
    summary: "方案编写识别功能模块",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { sectionTitle: "string?", childTemplates: "array?", userInstruction: "string?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => identifySolutionModules(body),
  });

  defineRoute({
    id: "ai.solution.generateSections",
    method: "POST",
    path: "/api/ai/solution-generate-sections",
    tags: ["ai", "solution-writing"],
    summary: "方案编写生成模块写作规划",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { sectionTitle: "string?", childTemplates: "array?", module: "object?", userInstruction: "string?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => generateSolutionModuleSections(body),
  });

  defineRoute({
    id: "ai.solution.planTasks",
    method: "POST",
    path: "/api/ai/solution-plan-tasks",
    tags: ["ai", "solution-writing"],
    summary: "方案编写生成执行任务规划",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { outlineText: "string?", categories: "array?", userInstruction: "string?" },
    responses: { 200: "object" },
    handler: ({ body }) => generateSolutionTaskPlan(body),
  });
}

export { registerAiRoutes };

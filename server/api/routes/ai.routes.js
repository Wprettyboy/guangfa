import { createKnowledgeChat } from "../../ai/chat.js";
import { fillField } from "../../ai/fill.js";
import { createFormatOutlinePlan } from "../../ai/format-outline.js";
import { createAiKnowledgeSearch } from "../../ai/knowledge-query.js";
import { generateSolutionDraftContent, generateSolutionModuleSections, generateSolutionTaskPlan, identifySolutionModules, testSolutionTaskKnowledge } from "../../solution-writing/generator.js";
import { generateSolutionPlantumlImage, readSolutionPlantumlImageDocx, readSolutionPlantumlImageFile } from "../../solution-writing/plantuml-image.js";
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
    body: { outlineText: "string?", categories: "array?", userInstruction: "string?", knowledgeOptions: "object?", taskDensity: "string?" },
    responses: { 200: "object" },
    handler: ({ body }) => generateSolutionTaskPlan(body),
  });

  defineRoute({
    id: "ai.solution.taskKnowledgeTest",
    method: "POST",
    path: "/api/ai/solution-task-knowledge-test",
    tags: ["ai", "solution-writing", "knowledge"],
    summary: "方案任务规划知识库召回测试",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { outlineText: "string?", categories: "array?", userInstruction: "string?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => testSolutionTaskKnowledge(body),
  });

  defineRoute({
    id: "ai.solution.draftContent",
    method: "POST",
    path: "/api/ai/solution-draft-content",
    tags: ["ai", "solution-writing"],
    summary: "方案编制根据任务规划生成正文草稿",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { taskPlan: "object?", globalPrompt: "string?", knowledgeOptions: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => generateSolutionDraftContent(body),
  });

  defineRoute({
    id: "ai.solution.plantumlImage",
    method: "POST",
    path: "/api/ai/solution-plantuml-image",
    tags: ["ai", "solution-writing"],
    summary: "方案编写基于当前文档生成 PlantUML 配图",
    bodyLimitBytes: aiBodyLimitBytes,
    body: { prompt: "string", selectedTitle: "string?", selectedBodyText: "string?", outlineItems: "array?", outlineText: "string?" },
    responses: { 200: "object" },
    handler: ({ body }) => generateSolutionPlantumlImage(body),
  });

  defineRoute({
    id: "ai.solution.plantumlImage.file",
    method: "GET",
    path: "/api/solution-plantuml-images/:imageId/file",
    tags: ["ai", "solution-writing"],
    summary: "读取方案 AI 生成配图预览文件",
    responses: { 200: "binary" },
    handler: async ({ params }) => {
      const file = await readSolutionPlantumlImageFile(params.imageId);
      if (!file) {
        const error = new Error("AI 生成配图不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: file.contentType,
        headers: {
          "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
        },
      };
    },
  });

  defineRoute({
    id: "ai.solution.plantumlImage.docx",
    method: "GET",
    path: "/api/solution-plantuml-images/:imageId/docx",
    tags: ["ai", "solution-writing"],
    summary: "读取方案 AI 生成配图 DOCX 片段",
    responses: { 200: "binary" },
    handler: async ({ params }) => {
      const file = await readSolutionPlantumlImageDocx(params.imageId);
      if (!file) {
        const error = new Error("AI 生成配图不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
        },
      };
    },
  });
}

export { registerAiRoutes };

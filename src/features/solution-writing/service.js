import { apiRequest } from "../../services/apiClient.js";

async function identifySolutionModules(payload) {
  return postSolutionWriting("/api/ai/solution-identify-modules", payload, "功能模块识别失败");
}

async function generateSolutionModuleSections(payload) {
  return postSolutionWriting("/api/ai/solution-generate-sections", payload, "方案章节生成失败");
}

async function generateSolutionTaskPlan(payload) {
  return postSolutionWriting("/api/ai/solution-plan-tasks", payload, "任务规划生成失败");
}

async function testSolutionTaskKnowledge(payload) {
  return postSolutionWriting("/api/ai/solution-task-knowledge-test", payload, "任务规划知识库测试失败");
}

async function generateSolutionDraftContent(payload) {
  return postSolutionWriting("/api/ai/solution-draft-content", payload, "方案编制生成失败");
}

async function generateSolutionPlantumlImage(payload) {
  return postSolutionWriting("/api/ai/solution-plantuml-image", payload, "AI 生图失败");
}

async function renderSolutionPlantuml(payload) {
  return postSolutionWriting("/api/plantuml/render", payload, "PlantUML 渲染失败");
}

async function postSolutionWriting(url, payload, fallbackMessage) {
  return apiRequest(url, {
    method: "POST",
    json: payload || {},
    timeoutMs: 180_000,
    fallbackMessage,
  });
}

export {
  generateSolutionDraftContent,
  generateSolutionModuleSections,
  generateSolutionPlantumlImage,
  generateSolutionTaskPlan,
  identifySolutionModules,
  renderSolutionPlantuml,
  testSolutionTaskKnowledge,
};

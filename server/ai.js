import { createKnowledgeChat } from "./ai/chat.js";
import { fillField } from "./ai/fill.js";
import { createFormatOutlinePlan } from "./ai/format-outline.js";
import { createAiKnowledgeSearch } from "./ai/knowledge-query.js";
import { generateSolutionModuleSections, identifySolutionModules } from "./solution-writing/generator.js";

const aiRoutes = new Set([
  "/api/ai/fill-field",
  "/api/ai/format-outline-plan",
  "/api/ai/chat",
  "/api/ai/knowledge-search",
  "/api/ai/solution-identify-modules",
  "/api/ai/solution-generate-sections",
]);

export function aiFillMiddleware() {
  return async function handleAiFill(request, response, next) {
    if (request.method !== "POST" || !aiRoutes.has(request.url)) {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = request.url === "/api/ai/format-outline-plan"
        ? await createFormatOutlinePlan(payload)
        : request.url === "/api/ai/chat"
          ? await createKnowledgeChat(payload)
          : request.url === "/api/ai/knowledge-search"
            ? await createAiKnowledgeSearch(payload)
            : request.url === "/api/ai/solution-identify-modules"
              ? await identifySolutionModules(payload)
              : request.url === "/api/ai/solution-generate-sections"
                ? await generateSolutionModuleSections(payload)
                : await fillField(payload);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "AI 处理失败",
      });
    }
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("请求 JSON 格式错误");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

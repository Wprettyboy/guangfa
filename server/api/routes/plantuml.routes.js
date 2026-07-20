import { renderSolutionPlantumlSource } from "../../solution-writing/plantuml-image.js";
import { defineRoute } from "../registry.js";

function registerPlantumlRoutes() {
  defineRoute({
    id: "plantuml.render",
    method: "POST",
    path: "/api/plantuml/render",
    tags: ["plantuml", "solution-writing"],
    summary: "渲染手动粘贴的 PlantUML 源码",
    roles: ["editor"],
    bodyLimitBytes: 256 * 1024,
    body: { source: "string", title: "string?" },
    responses: {
      200: "object",
      502: { schema: "object", description: "PlantUML 渲染服务不可用" },
    },
    handler: ({ body, principal }) => renderSolutionPlantumlSource(body, principal),
  });
}

export { registerPlantumlRoutes };

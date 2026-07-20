import { registerAiRoutes } from "./routes/ai.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerDraftRoutes } from "./routes/draft.routes.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.routes.js";
import { registerOfficeRoutes } from "./routes/office.routes.js";
import { registerPlantumlRoutes } from "./routes/plantuml.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerTemplateRoutes } from "./routes/templates.routes.js";
import { createApiMiddleware } from "./router.js";

let registered = false;

function ensureApiRoutesRegistered() {
  if (registered) return;
  registerAiRoutes();
  registerAuthRoutes();
  registerDraftRoutes();
  registerKnowledgeRoutes();
  registerOfficeRoutes();
  registerPlantumlRoutes();
  registerSettingsRoutes();
  registerTemplateRoutes();
  registered = true;
}

function apiMiddleware(options = {}) {
  ensureApiRoutesRegistered();
  return createApiMiddleware({
    notFoundPrefixes: [
      "/api/_meta/",
      "/api/ai/",
      "/api/draft",
      "/api/knowledge-bases",
      "/api/knowledge-documents/",
      "/api/knowledge-images/",
      "/api/knowledge-tables/",
      "/api/office/",
      "/api/plantuml/",
      "/api/settings/",
      "/api/template-libraries",
      "/api/template-types",
      "/api/templates",
    ],
    ...options,
  });
}

export { apiMiddleware, ensureApiRoutesRegistered };

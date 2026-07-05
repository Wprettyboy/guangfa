import { registerKnowledgeRoutes } from "./routes/knowledge.routes.js";
import { createApiMiddleware } from "./router.js";

let registered = false;

function ensureApiRoutesRegistered() {
  if (registered) return;
  registerKnowledgeRoutes();
  registered = true;
}

function apiMiddleware() {
  ensureApiRoutesRegistered();
  return createApiMiddleware({
    notFoundPrefixes: [
      "/api/_meta/",
      "/api/knowledge-bases",
      "/api/knowledge-documents/",
    ],
  });
}

export { apiMiddleware, ensureApiRoutesRegistered };

import { registerKnowledgeRoutes } from "./routes/knowledge.routes.js";
import { registerOfficeRoutes } from "./routes/office.routes.js";
import { createApiMiddleware } from "./router.js";

let registered = false;

function ensureKnowledgeApiRoutesRegistered() {
  if (registered) return;
  registerKnowledgeRoutes();
  registerOfficeRoutes();
  registered = true;
}

function knowledgeApiMiddleware(options = {}) {
  ensureKnowledgeApiRoutesRegistered();
  return createApiMiddleware({
    notFoundPrefixes: [
      "/api/_meta/",
      "/api/knowledge-bases",
      "/api/knowledge-chunks/",
      "/api/knowledge-document-images/",
      "/api/knowledge-documents/",
      "/api/knowledge-images/",
      "/api/knowledge-tables/",
      "/api/office/",
    ],
    ...options,
  });
}

export { ensureKnowledgeApiRoutesRegistered, knowledgeApiMiddleware };

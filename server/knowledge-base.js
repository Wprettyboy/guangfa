import { apiMiddleware } from "./api/index.js";
import { searchKnowledgeBase } from "./knowledge/documents.js";

function knowledgeBaseMiddleware() {
  return apiMiddleware();
}

export { knowledgeBaseMiddleware, searchKnowledgeBase };

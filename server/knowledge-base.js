import { apiMiddleware } from "./api/index.js";
import { searchKnowledgeBase } from "./knowledge/search-provider.js";

function knowledgeBaseMiddleware() {
  return apiMiddleware();
}

export { knowledgeBaseMiddleware, searchKnowledgeBase };

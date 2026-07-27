import { searchKnowledgeBase as searchLocalKnowledgeBase } from "./documents.js";
import { isKnowledgeServiceConfigured, searchKnowledgeService } from "./service-client.js";

function searchKnowledgeBase(payload) {
  return isKnowledgeServiceConfigured()
    ? searchKnowledgeService(payload)
    : searchLocalKnowledgeBase(payload);
}

export { searchKnowledgeBase };

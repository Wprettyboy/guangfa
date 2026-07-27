import path from "node:path";

const defaultKnowledgeDataDir = path.resolve(process.cwd(), "data", "knowledge");
const knowledgeDataDir = path.resolve(process.env.KNOWLEDGE_DATA_DIR || defaultKnowledgeDataDir);
const knowledgeDatabasePath = process.env.KNOWLEDGE_DATABASE_PATH
  ? path.resolve(process.env.KNOWLEDGE_DATABASE_PATH)
  : "";

export { knowledgeDataDir, knowledgeDatabasePath };

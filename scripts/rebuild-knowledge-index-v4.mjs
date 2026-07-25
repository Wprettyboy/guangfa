import { getKnowledgeDatabase } from "../server/knowledge/db.js";
import { rebuildKnowledgeIndexV4 } from "../server/knowledge/indexer.js";

const database = await getKnowledgeDatabase();
try {
  const manifest = await rebuildKnowledgeIndexV4(database);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  database.close();
}

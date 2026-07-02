async function readKnowledgeBases() {
  try {
    const response = await fetch("/api/knowledge-bases");
    if (!response.ok) return [];
    const bases = await response.json();
    return Array.isArray(bases) ? bases : [];
  } catch {
    return [];
  }
}

async function postKnowledgeBase(payload) {
  const response = await fetch("/api/knowledge-bases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "知识库创建失败");
  return result;
}

async function postKnowledgeDocument(kbId, material) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: material.name,
      size: material.size,
      text: material.text,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "资料入库失败");
  return result;
}

async function removeKnowledgeDocument(kbId, documentId) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "资料删除失败");
  return result;
}

async function removeKnowledgeBase(kbId) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "知识库删除失败");
  return result;
}



export {
  readKnowledgeBases,
  postKnowledgeBase,
  postKnowledgeDocument,
  removeKnowledgeDocument,
  removeKnowledgeBase,
};


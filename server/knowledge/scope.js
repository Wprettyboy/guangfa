function resolveKnowledgeSearchScope(payload, metadata, defaultProjectId) {
  const projectId = payload.projectId || defaultProjectId;
  const selectedKbIds = Array.isArray(payload.kbIds) ? payload.kbIds.filter(Boolean) : [];
  const selectedGlobalKbIds = Array.isArray(payload.globalKbIds) ? payload.globalKbIds.filter(Boolean) : [];
  const explicitKbIds = [...new Set([...selectedKbIds, ...selectedGlobalKbIds])];
  if (explicitKbIds.length === 0) {
    return {
      projectId,
      allowedKbIds: new Set(),
      eligibleChunks: [],
      liveChunkIds: new Set(),
    };
  }

  const explicitSet = new Set(explicitKbIds);
  const allowedKbIds = new Set(
    metadata.knowledgeBases
      .filter((kb) => explicitSet.has(kb.id) && isSelectableKnowledgeBase(kb, projectId, defaultProjectId))
      .map((kb) => kb.id),
  );
  const eligibleChunks = metadata.chunks.filter((chunk) => allowedKbIds.has(chunk.kbId));

  return {
    projectId,
    allowedKbIds,
    eligibleChunks,
    liveChunkIds: new Set(eligibleChunks.map((chunk) => chunk.id)),
  };
}

function isSelectableKnowledgeBase(kb, projectId, defaultProjectId) {
  if (!kb) return false;
  if (kb.scope === "global") return true;
  return (kb.projectId || defaultProjectId) === projectId;
}

export { resolveKnowledgeSearchScope };

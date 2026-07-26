import { apiRequest } from "./apiClient.js";

async function readKnowledgeBases() {
  const bases = await apiRequest("/api/knowledge-bases", {
    fallbackMessage: "知识库读取失败",
  });
  return Array.isArray(bases) ? bases : [];
}

async function postKnowledgeBase(payload) {
  return apiRequest("/api/knowledge-bases", {
    method: "POST",
    json: payload,
    fallbackMessage: "知识库创建失败",
  });
}

async function postKnowledgeDocument(kbId, material) {
  return apiRequest(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    method: "POST",
    headers: { "Idempotency-Key": createUploadOperationId() },
    json: {
      name: material.name,
      fileName: material.fileName || material.name,
      fileType: material.fileType || "",
      size: material.size,
      fileBase64: material.fileBase64,
    },
    timeoutMs: 2 * 60 * 1000,
    fallbackMessage: "资料入库失败",
  });
}

async function removeKnowledgeDocument(kbId, documentId) {
  return apiRequest(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    fallbackMessage: "资料删除失败",
  });
}

async function removeKnowledgeBase(kbId) {
  return apiRequest(`/api/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
    fallbackMessage: "知识库删除失败",
  });
}

async function searchKnowledgeTables(payload) {
  const result = await apiRequest("/api/knowledge-tables/search", {
    method: "POST",
    json: payload || {},
    fallbackMessage: "知识库表格读取失败",
  });
  return Array.isArray(result) ? result : [];
}

async function searchKnowledgeImages(payload) {
  const result = await apiRequest("/api/knowledge-images/search", {
    method: "POST",
    json: payload || {},
    fallbackMessage: "知识库图片读取失败",
  });
  return Array.isArray(result) ? result : [];
}

async function retryKnowledgeDocumentImages(kbId, documentId) {
  return apiRequest(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(documentId)}/retry-images`, {
    method: "POST",
    fallbackMessage: "图片语义解析重试失败",
  });
}

async function searchKnowledgeBase(payload) {
  const result = await apiRequest("/api/knowledge-bases/search", {
    method: "POST",
    json: payload || {},
    fallbackMessage: "知识库检索失败",
  });
  return {
    items: Array.isArray(result?.items) ? result.items : [],
    diagnostics: result?.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : null,
  };
}

async function readKnowledgeTableEvidence(chunkId) {
  return apiRequest(`/api/knowledge-chunks/${encodeURIComponent(chunkId)}/table`, {
    fallbackMessage: "表格原始结构读取失败",
  });
}

async function createKnowledgeDocumentOfficePreview(documentId) {
  return apiRequest(`/api/knowledge-documents/${encodeURIComponent(documentId)}/office-preview`, {
    method: "POST",
    timeoutMs: 120_000,
    fallbackMessage: "原始 DOCX 预览初始化失败",
  });
}

async function openKnowledgeImageEvidence(imageId) {
  const preview = window.open("about:blank", "_blank");
  if (!preview) throw new Error("浏览器阻止了图片证据窗口，请允许弹出窗口后重试。");
  preview.opener = null;
  preview.document.body.textContent = "正在加载图片证据...";
  try {
    const blob = await apiRequest(`/api/knowledge-document-images/${encodeURIComponent(imageId)}/file`, {
      responseType: "blob",
      fallbackMessage: "图片证据读取失败",
    });
    const url = URL.createObjectURL(blob);
    preview.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (error) {
    preview.close();
    throw error;
  }
}

function createUploadOperationId() {
  return globalThis.crypto?.randomUUID?.() || `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export {
  readKnowledgeBases,
  postKnowledgeBase,
  postKnowledgeDocument,
  createKnowledgeDocumentOfficePreview,
  openKnowledgeImageEvidence,
  removeKnowledgeDocument,
  removeKnowledgeBase,
  retryKnowledgeDocumentImages,
  readKnowledgeTableEvidence,
  searchKnowledgeBase,
  searchKnowledgeTables,
  searchKnowledgeImages,
};


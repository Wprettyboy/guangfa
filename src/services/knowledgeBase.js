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
    timeoutMs: 120_000,
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

async function openKnowledgeSourcePdf(documentId, page = 1) {
  const preview = window.open("about:blank", "_blank");
  if (!preview) throw new Error("浏览器阻止了原文 PDF 窗口，请允许弹出窗口后重试。");
  preview.opener = null;
  preview.document.body.textContent = "正在加载原文 PDF...";
  try {
    const blob = await apiRequest(`/api/knowledge-documents/${encodeURIComponent(documentId)}/source-pdf`, {
      responseType: "blob",
      fallbackMessage: "原文 PDF 读取失败",
    });
    const url = URL.createObjectURL(blob);
    preview.location.replace(`${url}#page=${Math.max(1, Number(page) || 1)}`);
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
  openKnowledgeSourcePdf,
  removeKnowledgeDocument,
  removeKnowledgeBase,
  searchKnowledgeTables,
  searchKnowledgeImages,
};


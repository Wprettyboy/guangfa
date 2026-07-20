import { apiRequest } from "../../services/apiClient.js";

function normalizePromptText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPlaceholderAiField(card) {
  const prompt = normalizePromptText(card.prompt);
  const context = `自动字段：${card.name}；模板标记：${card.token}${prompt ? `；提示词：${prompt}` : ""}`;
  const field = {
    id: card.id,
    name: card.name,
    sourceText: card.name,
    templateContext: context,
    category: "填空",
    type: "填空",
    question: prompt || `请从资料中提取“${card.name}”的字段值。`,
    answerFormat: card.name,
    aiInstruction: prompt
      ? `根据知识库或上传资料自动获取“${card.name}”。补充提示：${prompt}。只输出可替换模板标记的值。`
      : `根据知识库或上传资料自动获取“${card.name}”，只输出可替换模板标记的值。`,
    writeMode: "replace-placeholder-bookmark",
    hasInputPoint: true,
    inputPoint: { bookmarkName: card.anchors[0]?.bookmarkName || "" },
    page: card.anchors[0]?.page || 1,
  };
  return field;
}

async function requestPlaceholderAiFill(card, { materials, knowledgeOptions }) {
  const result = await apiRequest("/api/ai/fill-field", {
    method: "POST",
    json: {
      field: buildPlaceholderAiField(card),
      materials,
      knowledgeOptions,
    },
    fallbackMessage: "AI 填充失败",
  });
  return {
    value: result.value || "",
    status: result.status || (result.value ? "待确认" : "需补充资料"),
    confidence: result.confidence || 0,
    source: result.source || "AI 基于上传资料生成",
    aiReason: result.aiReason || result.reason || "",
    evidence: result.evidence || "AI 未返回明确证据。",
    sourceSnippetText: result.sourceSnippetText || "",
  };
}

function markPlaceholderFillFailure(fill, writeResult) {
  return {
    ...fill,
    status: "需补充资料",
    confidence: 0,
    source: "OnlyOffice 写入失败",
    aiReason: fill.aiReason || "",
    evidence: writeResult?.error || "未收到 OnlyOffice 自动字段写入回执，请确认填充预览已打开并重新尝试。",
    sourceSnippetText: fill.sourceSnippetText || "",
  };
}

function createPlaceholderFillError(error, previousValue = "") {
  return {
    value: previousValue,
    status: "需补充资料",
    confidence: 0,
    source: "AI 填充失败",
    aiReason: "",
    evidence: error?.message || "请检查模型配置、网络或上传资料。",
    sourceSnippetText: "",
  };
}

function createManualPlaceholderFill(value, currentFill = {}) {
  return {
    ...currentFill,
    value,
    status: "待确认",
    confidence: currentFill.confidence || 100,
    source: currentFill.source || "人工修改",
    aiReason: currentFill.aiReason || "",
    evidence: currentFill.evidence || "用户手动填写并写入自动字段。",
  };
}

function createEditedPlaceholderFill(value) {
  return {
    value,
    status: value.trim() ? "待确认" : "未填充",
    confidence: value.trim() ? 100 : 0,
    source: value.trim() ? "人工修改" : "待上传资料后生成",
    aiReason: "",
    evidence: value.trim() ? "用户手动修改自动字段填充值。" : "",
    sourceSnippetText: "",
  };
}

export {
  createEditedPlaceholderFill,
  createManualPlaceholderFill,
  createPlaceholderFillError,
  markPlaceholderFillFailure,
  requestPlaceholderAiFill,
};

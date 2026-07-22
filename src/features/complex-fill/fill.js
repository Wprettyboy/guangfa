import {
  compareComplexFillAnchors,
  normalizeComplexFillAnchors,
  normalizeComplexFillFields,
} from "./anchors.js";
import { apiRequest } from "../../services/apiClient.js";

function buildComplexFillOutputRequirement(field = {}) {
  return [field.contentRequirement, field.formatRequirement]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

function labelComplexFillAnchorPages(anchors = []) {
  return anchors.map((anchor) => {
    const page = Math.max(1, Number(anchor?.page || 1) || 1);
    return {
      ...anchor,
      page,
      pageLabel: `第 ${page} 页`,
    };
  });
}

function buildComplexFillCards(fields = [], anchors = [], fills = {}) {
  const normalizedAnchors = normalizeComplexFillAnchors(anchors);
  return normalizeComplexFillFields(fields)
    .map((field) => {
      const fieldAnchors = labelComplexFillAnchorPages(
        normalizedAnchors.filter((anchor) => anchor.fieldId === field.id).sort(compareComplexFillAnchors),
      );
      if (fieldAnchors.length === 0) return null;
      const fill = fills[field.id] || {};
      return {
        ...field,
        anchors: fieldAnchors,
        selectedCount: fieldAnchors.length,
        outputRequirement: buildComplexFillOutputRequirement(field),
        value: String(fill.value || ""),
        status: fill.status || "未填充",
        confidence: Number(fill.confidence || 0),
        source: fill.source || "待上传资料后生成",
        evidence: fill.evidence || "",
        sourceSnippetText: fill.sourceSnippetText || "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareComplexFillAnchors(left.anchors[0], right.anchors[0]) || left.fieldSummary.localeCompare(right.fieldSummary));
}

function buildComplexFillAiField(card) {
  const outputRequirement = buildComplexFillOutputRequirement(card);
  return {
    id: card.id,
    name: card.fieldSummary,
    sourceText: "",
    templateContext: outputRequirement,
    category: "填空",
    type: "长文本",
    fillMode: "paragraph",
    question: `请根据输出要求生成“${card.fieldSummary}”的复杂类填充内容。`,
    answerFormat: outputRequirement,
    aiInstruction: outputRequirement,
    writeMode: "replace-selection",
    page: card.anchors[0]?.page || 1,
  };
}

async function requestComplexFillAiFill(card, { materials, knowledgeOptions, signal }) {
  const result = await apiRequest("/api/ai/fill-field", {
    method: "POST",
    json: {
      field: buildComplexFillAiField(card),
      materials,
      knowledgeOptions,
    },
    fallbackMessage: "AI 填充失败",
    signal,
  });
  return {
    value: result.value || "",
    status: result.status || (result.value ? "待确认" : "需补充资料"),
    confidence: result.confidence || 0,
    source: result.source || "AI 基于上传资料生成",
    evidence: result.evidence || "AI 未返回明确证据。",
    sourceSnippetText: result.sourceSnippetText || "",
  };
}

function markComplexFillFailure(fill, writeResult) {
  return {
    ...fill,
    status: "需补充资料",
    confidence: 0,
    source: "OnlyOffice 写入失败",
    evidence: writeResult?.error || "未收到 OnlyOffice 复杂类填充写入回执，请确认填充预览已打开并重新尝试。",
    sourceSnippetText: fill.sourceSnippetText || "",
  };
}

function createComplexFillError(error, previousValue = "") {
  return {
    value: previousValue,
    status: "需补充资料",
    confidence: 0,
    source: "AI 填充失败",
    evidence: error?.message || "请检查模型配置、网络或上传资料。",
    sourceSnippetText: "",
  };
}

function createManualComplexFill(value, currentFill = {}) {
  return {
    ...currentFill,
    value,
    status: "待确认",
    confidence: currentFill.confidence || 100,
    source: "人工修改",
    evidence: "用户手动填写并写入复杂类填充选区。",
  };
}

function createEditedComplexFill(value) {
  return {
    value,
    status: value.trim() ? "待确认" : "未填充",
    confidence: value.trim() ? 100 : 0,
    source: value.trim() ? "人工修改" : "待上传资料后生成",
    evidence: value.trim() ? "用户手动修改复杂类填充值。" : "",
    sourceSnippetText: "",
  };
}

export {
  buildComplexFillCards,
  buildComplexFillOutputRequirement,
  createEditedComplexFill,
  createManualComplexFill,
  createComplexFillError,
  markComplexFillFailure,
  requestComplexFillAiFill,
};

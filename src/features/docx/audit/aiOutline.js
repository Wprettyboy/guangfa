import {
  aiOutlineSourceIssueIds,
  isAuditIssueEnabled,
  shouldRunAiOutlineAudit,
} from "./config.js";
import { readDocxStructure } from "../structure/docxStructure.js";
import { apiRequest } from "../../../services/apiClient.js";

async function enhanceAuditWithAiOutline(auditResult, file, config, onlyOfficeOutline, userInstruction = "") {
  const enabledSet = new Set(config.enabled || []);
  const aiOutlineEnabled = shouldRunAiOutlineAudit(config);
  const baseIssues = (auditResult.issues || []).filter((issue) => !aiOutlineSourceIssueIds.has(issue.id));
  if (!aiOutlineEnabled) return { ...auditResult, issues: baseIssues };
  if (!onlyOfficeOutline?.ok || !Array.isArray(onlyOfficeOutline.items) || onlyOfficeOutline.items.length === 0) {
    return { ...auditResult, aiError: "OnlyOffice 大纲未挂载，不能开始 AI 审查。", issues: baseIssues };
  }

  const structure = file.structure || (await readDocxStructure(file.buffer.slice(0)).catch(() => null));
  const candidates = buildAiOutlineCandidates(structure, onlyOfficeOutline);
  if (candidates.length === 0) return { ...auditResult, issues: baseIssues };

  let data = {};
  try {
    data = await apiRequest("/api/ai/format-outline-plan", {
      method: "POST",
      json: {
        candidates,
        onlyOfficeOutline: normalizeOnlyOfficeOutlineForAi(onlyOfficeOutline),
        auditRules: getUniversalOutlineAuditRules(),
        userInstruction,
      },
      timeoutMs: 180_000,
      fallbackMessage: "AI 标题/大纲审查失败",
    });
  } catch (error) {
    return {
      ...auditResult,
      aiError: error?.message || "AI 标题/大纲审查失败，请检查模型配置。",
      issues: baseIssues,
    };
  }
  const plannedTargets = mergeAiOutlineTargets(buildForcedOutlineTargets(candidates), data.targets || []);
  const aiIssues = createAiOutlineIssues(filterResolvedAiOutlineTargets(plannedTargets, candidates), enabledSet);
  return {
    ...auditResult,
    aiError: "",
    issues: [...baseIssues, ...aiIssues],
  };
}

function buildForcedOutlineTargets(candidates) {
  return candidates
    .filter((item) => item.sourceIssue === "onlyoffice-empty-outline")
    .map((item) => ({
      paragraphIndex: item.paragraphIndex,
      outlineIndex: item.outlineIndex,
      outlineLevel: item.outlineLevel,
      text: item.text,
      operation: "demote",
      level: null,
      reason: "空标题",
    }));
}

function mergeAiOutlineTargets(baseTargets, aiTargets) {
  const seen = new Set();
  return [...baseTargets, ...aiTargets].filter((target) => {
    const key = `${target.outlineIndex ?? target.paragraphIndex}-${target.operation}-${target.level ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getUniversalOutlineAuditRules() {
  return [
    "只判断样式和大纲层级，不修改正文文本。",
    "先根据当前文档 OnlyOffice 大纲中占多数的编号形态、样式名称、层级分布归纳本文档规则。",
    "不要假设所有文档都使用“第X章/一、/1.”对应固定层级。",
    "明显标题形态不应降为正文；只在层级异常时调整 displayLevel。",
    "正文长段、说明性句子、承诺正文、单位落款、空标题不应进入大纲。",
    "不确定的项目标记 manual，不强行修复。",
    "只输出脚本可安全执行的结构化修复计划。",
  ];
}

function normalizeOnlyOfficeOutlineForAi(outline) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  return outline.items.slice(0, 300).map((item) => ({
    index: Number(item.index) || 0,
    level: Number(item.level) || 0,
    title: item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim(),
    isEmptyItem: Boolean(item.isEmptyItem),
    isNotHeader: Boolean(item.isNotHeader),
  }));
}

function buildAiOutlineCandidates(structure, onlyOfficeOutline) {
  return buildOnlyOfficeOutlineCandidates(onlyOfficeOutline, structure);
}

function buildOnlyOfficeOutlineCandidates(outline, structure) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  const headingBlocks = (structure?.blocks || []).filter((block) => block.type === "paragraph" && block.isHeading);
  const byText = new Map();
  headingBlocks.forEach((block) => {
    const key = normalizeOutlineMatchText(block.text);
    const list = byText.get(key) || [];
    list.push(block);
    byText.set(key, list);
  });

  return outline.items.slice(0, 300).map((item, order) => {
    const title = item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim();
    const textMatch = byText.get(normalizeOutlineMatchText(title))?.shift();
    const block = textMatch || headingBlocks[order] || null;
    return {
      paragraphIndex: block?.paragraphIndex || null,
      outlineIndex: Number(item.index) || 0,
      outlineLevel: Number(item.level) || 0,
      text: title,
      currentLevel: Number(item.level) || 0,
      isHeading: true,
      styleName: block?.styleName || "",
      sourceIssue: item.isEmptyItem ? "onlyoffice-empty-outline" : "onlyoffice-outline-table",
      isEmptyOutline: Boolean(item.isEmptyItem),
    };
  }).filter((item) => item.paragraphIndex);
}

function buildOnlyOfficeOutlineTextMap(outline) {
  const map = new Map();
  if (!outline?.ok || !Array.isArray(outline.items)) return map;
  outline.items.forEach((item) => {
    const key = normalizeOutlineMatchText(item.title || item.displayTitle || "");
    if (!key || item.isEmptyItem) return;
    const list = map.get(key) || [];
    list.push({ index: Number(item.index), level: Number(item.level) });
    map.set(key, list);
  });
  return map;
}

function normalizeOutlineMatchText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getAiOutlineBlockLevel(block) {
  if (!block?.isHeading || !Number.isInteger(block.level) || block.level <= 0) return null;
  return block.level - 1;
}

function filterResolvedAiOutlineTargets(targets, candidates) {
  const candidatesByParagraph = new Map(candidates.map((item) => [Number(item.paragraphIndex), item]));
  const candidatesByOutline = new Map(candidates.map((item) => [Number(item.outlineIndex), item]));
  return targets.map((target) => {
    const candidate = candidatesByOutline.get(Number(target.outlineIndex)) || candidatesByParagraph.get(Number(target.paragraphIndex));
    const operation = target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep";
    const targetLevel = Number(target.level);
    const valid = operation === "demote"
      ? Boolean(candidate?.isHeading || Number.isInteger(candidate?.currentLevel)) && isSafeOutlineDemoteTarget(candidate)
      : operation === "heading" && Number.isInteger(targetLevel)
        ? candidate?.currentLevel !== targetLevel
        : false;
    if (!valid) return null;
    return {
      ...target,
      text: target.text || candidate?.text || "",
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : candidate?.outlineIndex,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : candidate?.outlineLevel,
    };
  }).filter(Boolean);
}

function isSafeOutlineDemoteTarget(candidate) {
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "空标题" || candidate?.sourceIssue === "onlyoffice-empty-outline") return true;
  if (isProtectedOutlineHeading(text)) return false;
  if (/[。；;]$/.test(text)) return true;
  if (text.length > 42) return true;
  if (text.length > 24 && /[，,。；;：:]/.test(text)) return true;
  if (/供应商名称|盖章|公章|日期/.test(text)) return true;
  return false;
}

function isProtectedOutlineHeading(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || /[。；;：:]$/.test(value)) return false;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,60}$/.test(value)) return true;
  if (/^（[一二三四五六七八九十]+）\S{1,60}$/.test(value)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．]?\S{1,48}$/.test(value)) return true;
  return false;
}

function isAiOutlineCandidateBlock(block) {
  const text = String(block.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "目录" || text.length > 140) return false;
  if (block.isHeading || /标题|heading/i.test(block.styleName || "")) return true;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,40}$/.test(text)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．\s]\S{1,48}$/.test(text)) return true;
  return false;
}

function createAiOutlineIssues(targets, enabledSet) {
  const normalizedTargets = targets
    .map((target) => ({
      index: Number(target.paragraphIndex) - 1,
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : null,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : null,
      text: String(target.text || "").slice(0, 120),
      operation: target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep",
      level: Number.isInteger(Number(target.level)) ? Number(target.level) : null,
      reason: String(target.reason || "").slice(0, 120),
    }))
    .filter((target) => target.index >= 0 && target.operation !== "keep");
  return normalizedTargets
    .map((target) => makeAiOutlineIssue(target))
    .filter((issue) => isAuditIssueEnabled(issue, enabledSet));
}

function makeAiOutlineIssue(target) {
  const isHeading = target.operation === "heading";
  const auditConfigKey = isHeading ? "missing-heading-style" : "body-outline";
  const title = isHeading ? "标题未入大纲" : "正文误入标题";
  const description = isHeading ? "AI 判断该段应进入标题层级，修复时由脚本套用对应 Word 标题样式。" : "AI 判断该段应为正文，修复时由脚本移出 Word 大纲。";
  return {
    id: `ai-outline-${target.operation}-${target.outlineIndex ?? target.index}-${target.level ?? "body"}`,
    title,
    category: "标题体系",
    description,
    severity: "medium",
    layer: "safe",
    fixable: true,
    auditConfigKey,
    action: "applyAiOutlinePlan",
    count: 1,
    targets: [target],
    samples: [`${target.text || target.reason || "AI 审查项"}${target.reason ? `（${target.reason}）` : ""}`],
  };
}

function getOutlineRevisionReason(target) {
  const text = String(target?.text || "").trim();
  const reason = String(target?.reason || "").trim();
  if (!text) return "空标题";
  if (/空标题/.test(reason)) return "空标题";
  if (target?.operation === "demote") return "正文误入";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return "层级异常";
  return reason.slice(0, 4) || "大纲异常";
}

function getOutlineRevisionAction(target) {
  if (target?.operation === "demote") return "改正文";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return `改L${target.level + 1}`;
  return "人工确认";
}

export {
  buildAiOutlineCandidates,
  buildForcedOutlineTargets,
  buildOnlyOfficeOutlineCandidates,
  buildOnlyOfficeOutlineTextMap,
  createAiOutlineIssues,
  enhanceAuditWithAiOutline,
  filterResolvedAiOutlineTargets,
  getAiOutlineBlockLevel,
  getOutlineRevisionAction,
  getOutlineRevisionReason,
  getUniversalOutlineAuditRules,
  isAiOutlineCandidateBlock,
  isProtectedOutlineHeading,
  isSafeOutlineDemoteTarget,
  makeAiOutlineIssue,
  mergeAiOutlineTargets,
  normalizeOnlyOfficeOutlineForAi,
  normalizeOutlineMatchText,
};

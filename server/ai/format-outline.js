import { getAiRuntimeConfig } from "./config.js";

import { writeAiDebugLog } from "./debug-log.js";

import { callJsonModel } from "./model.js";



async function createFormatOutlinePlan(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 300) : [];
  const onlyOfficeOutline = Array.isArray(payload?.onlyOfficeOutline) ? payload.onlyOfficeOutline.slice(0, 300) : [];
  const auditRules = Array.isArray(payload?.auditRules) ? payload.auditRules.map((rule) => String(rule || "").trim()).filter(Boolean).slice(0, 20) : [];
  const userInstruction = String(payload?.userInstruction || "").trim().slice(0, 1000);
  if (candidates.length === 0) {
    const error = new Error("没有可供 AI 判断的标题/大纲候选段落。");
    error.statusCode = 400;
    throw error;
  }

  const runtime = getAiRuntimeConfig();
  const systemPrompt = "你是中文 Word 文档标题体系审查助手。只判断标题/大纲层级，不改写正文文本。只输出严格 JSON。";
  const promptCandidates = candidates.map((item) => ({
    outlineIndex: item.outlineIndex,
    displayLevel: Number.isInteger(Number(item.outlineLevel)) ? `L${Number(item.outlineLevel) + 1}` : "",
    title: String(item.text || "").slice(0, 120),
    styleName: item.styleName,
    sourceIssue: item.sourceIssue,
  }));
  const userPrompt = [
    "请根据 OnlyOffice 原生导航大纲表，判断每行 displayLevel 是否需要调整。",
    "只能输出一行 JSON，不要解释，不要 Markdown，不要分析过程。",
    "只输出需要修复的段落；不需要修复时输出 {\"targets\":[]}。",
    "",
    "输出 JSON：",
    '{"targets":[{"outlineIndex":1,"operation":"demote|heading","level":0,"reason":"4字原因"}]}',
    "",
    "规则：",
    "1. outlineIndex 和 title 是定位依据，不得要求修改 title 文本。",
    "2. 只调整 displayLevel：operation=demote 表示改为正文并退出 Word 大纲。",
    "3. operation=heading 表示保留为标题但调整层级，level 使用 0/1/2，分别代表 L1/L2/L3。",
    "4. 先从本文档多数大纲项中归纳编号形态、样式名称、层级分布，再判断异常；不要套用固定“第X章/一、/1.”层级模板。",
    "5. 严禁把明显标题降为正文：短标题、章节标题、无句末标点的“一、xxx”“二、xxx”“1.xxx”“（一）xxx”应保留为标题，只能在必要时调整层级。",
    "6. 只有空标题、正文长段、说明性句子、承诺正文、单位落款才输出 demote。",
    "7. 不要新增、删除、改写段落文字。",
    "8. 只返回候选段落里的 outlineIndex。",
    "9. 不确定的项目不要输出，留给人工确认。",
    "10. reason 不超过 4 个汉字。",
    "",
    "审查规则：",
    JSON.stringify(auditRules),
    "",
    "用户调整要求：",
    userInstruction || "无",
    "",
    "OnlyOffice 原生大纲（与左侧导航显示一致）：",
    JSON.stringify(promptCandidates),
  ].join("\n");

  const parsed = await callJsonModel(runtime, systemPrompt, userPrompt, {
    debugFileName: "ai-outline-last.json",
    expectedArrayKey: "targets",
    partialArrayKey: "targets",
    debugContext: { candidateCount: candidates.length, candidates: promptCandidates, onlyOfficeOutline, auditRules, userInstruction },
  });
  if (!Array.isArray(parsed.targets)) {
    return { targets: [] };
  }
  const allowedByParagraph = new Map(candidates.map((item) => [Number(item.paragraphIndex), item]));
  const allowedByOutline = new Map(candidates.map((item) => [Number(item.outlineIndex), item]));
  const targets = parsed.targets
    .map((item) => {
      const source = allowedByOutline.get(Number(item.outlineIndex)) || allowedByParagraph.get(Number(item.paragraphIndex));
      if (!source) return null;
      const paragraphIndex = Number(source.paragraphIndex);
      const operation = item.operation === "heading" ? "heading" : item.operation === "demote" ? "demote" : "keep";
      if (operation === "demote" && !isSafeOutlineDemoteTarget(source)) return null;
      const rawLevel = Number(item.level);
      return {
        paragraphIndex,
        outlineIndex: Number.isInteger(Number(source.outlineIndex)) ? Number(source.outlineIndex) : null,
        outlineLevel: Number.isInteger(Number(source.outlineLevel)) ? Number(source.outlineLevel) : null,
        text: source.text,
        operation,
        level: operation === "heading" && Number.isInteger(rawLevel) ? Math.max(0, Math.min(2, rawLevel)) : null,
        reason: String(item.reason || "").slice(0, 120),
      };
    })
    .filter((item) => item && item.operation !== "keep");

  await writeAiDebugLog("ai-outline-last-final.json", {
    createdAt: new Date().toISOString(),
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    candidateCount: candidates.length,
    modelTargets: parsed.targets,
    returnedTargets: targets,
  });

  return { targets };
}

function isSafeOutlineDemoteTarget(candidate) {
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "空标题" || candidate?.sourceIssue === "onlyoffice-empty-outline" || candidate?.isEmptyOutline) return true;
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



export { createFormatOutlinePlan };


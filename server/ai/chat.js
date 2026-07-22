import { getAiRuntimeConfig } from "./config.js";

import { summarizeSnippetsForDebug } from "./debug-log.js";

import { formatKnowledgeSnippets, searchKnowledgeForAi } from "./knowledge-query.js";

import { callChatModel } from "./model.js";



async function createKnowledgeChat(payload) {
  const message = String(payload?.message || "").trim().slice(0, 4000);
  if (!message) {
    const error = new Error("请输入聊天内容。");
    error.statusCode = 400;
    throw error;
  }

  const knowledgeOptions = payload?.knowledgeOptions && typeof payload.knowledgeOptions === "object" ? payload.knowledgeOptions : {};
  const kbIds = Array.isArray(knowledgeOptions.kbIds) ? knowledgeOptions.kbIds.filter(Boolean) : [];
  const runtime = getAiRuntimeConfig();
  const knowledgeSearch = await searchKnowledgeForAi(runtime, {
    rawQuery: message,
    message,
    knowledgeOptions,
    debugFileName: "ai-chat-knowledge-query-last.json",
  });
  const knowledgeSnippets = knowledgeSearch.snippets;
  const knowledgeText = formatKnowledgeSnippets(knowledgeSnippets);
  const history = normalizeChatHistory(payload?.history);
  const sourceSnippets = formatChatSourceSnippets(knowledgeSnippets.slice(0, 1), knowledgeOptions.bases);
  const baseNames = Array.isArray(knowledgeOptions.bases)
    ? knowledgeOptions.bases.map((item) => item?.name).filter(Boolean).join("、")
    : "";
  const systemPrompt = [
    "你是中文招标文件制作助手，只用自然语言回答。",
    "禁止调用或输出 OnlyOffice 宏、writeMacro、functionCalling、工具调用、代码块或内部 API。",
    "优先依据已挂载知识库召回片段回答；资料不足时明确说明缺少依据，不要编造。",
    "回答必须简明扼要，优先一句话，最多两条要点。",
    "不要写“根据知识库召回片段”“此外”“引用来源”等溯源说明，来源由系统在回复下方展示。",
  ].join("\n");
  const userPrompt = [
    `当前挂载知识库：${baseNames || (kbIds.length ? kbIds.join("、") : "未挂载")}`,
    "",
    knowledgeText ? `【知识库召回片段】\n${knowledgeText}` : "【知识库召回片段】\n未检索到相关片段。",
    "",
    `用户问题：${message}`,
  ].join("\n");
  const reply = sanitizeChatReply(await callChatModel(runtime, [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userPrompt },
  ], {
    debugFileName: "ai-chat-last.json",
    debugContext: {
      message,
      knowledgeOptions: {
        enabled: knowledgeOptions.enabled !== false,
        projectId: knowledgeOptions.projectId || "default-project",
        kbIds,
        globalKbIds: Array.isArray(knowledgeOptions.globalKbIds) ? knowledgeOptions.globalKbIds.filter(Boolean) : [],
        topK: knowledgeOptions.topK || 8,
        bases: knowledgeOptions.bases || [],
      },
      rawRetrievalQuery: knowledgeSearch.rawQuery,
      retrievalQuery: knowledgeSearch.query,
      retrievalPlan: knowledgeSearch.plan,
      knowledgeCount: sourceSnippets.length,
      retrievedKnowledgeCount: knowledgeSnippets.length,
      knowledgeSnippets: sourceSnippets,
    },
  }));

  return {
    reply,
    knowledgeCount: sourceSnippets.length,
    snippets: sourceSnippets,
  };
}

function formatChatSourceSnippets(snippets = [], bases = []) {
  const baseNames = new Map((Array.isArray(bases) ? bases : []).map((base) => [base?.id, base?.name]).filter(([id, name]) => id && name));
  return summarizeSnippetsForDebug(snippets).map((item) => ({
    ...item,
    kbName: baseNames.get(item.kbId) || (item.scope === "global" ? "全局知识库" : "项目知识库"),
  }));
}

function normalizeChatHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
      const content = String(item?.content || "").trim().slice(0, 2000);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-8);
}

function sanitizeChatReply(reply) {
  const text = String(reply || "").trim();
  if (!text) return "未生成有效回复，请稍后重试。";
  if (/\b(writeMacro|functionCalling|Asc\.|Api\.)\b/i.test(text) || /运行宏|格式化文本|重写文本/.test(text)) {
    return "当前聊天机器人已禁用 OnlyOffice 宏和工具调用。请直接用自然语言提问，我会优先依据已挂载知识库回答。";
  }
  return text;
}



export { createKnowledgeChat };


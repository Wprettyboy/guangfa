import { mkdir, writeFile } from "node:fs/promises";



export async function writeAiDebugLog(fileName, payload) {
  try {
    const logsDir = new URL("../logs/", import.meta.url);
    await mkdir(logsDir, { recursive: true });
    await writeFile(new URL(fileName, logsDir), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Debug logging must not break the user-facing AI workflow.
  }
}

export async function writeFillFinalDebugLog(runtime, debugContext, parsed, result, reason) {
  await writeAiDebugLog("ai-fill-last-final.json", {
    createdAt: new Date().toISOString(),
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    context: debugContext,
    modelParsed: parsed,
    returnedResult: result,
    finalReason: reason,
  });
}

function summarizeFieldForDebug(field = {}) {
  return {
    id: field.id,
    name: field.name,
    category: field.category || field.type,
    fillMode: field.fillMode,
    sourceText: field.sourceText || field.templateContext || field.answerFormat || "",
    question: field.question,
    aiInstruction: field.aiInstruction,
    page: field.page,
  };
}

function summarizeSnippetsForDebug(snippets = []) {
  return snippets.map((item, index) => ({
    index: index + 1,
    id: item.id,
    kbId: item.kbId,
    documentId: item.documentId,
    source: item.documentName || item.name || "未命名资料",
    scope: item.scope,
    chunkIndex: item.chunkIndex,
    page: item.page || "",
    score: item.score,
    text: String(item.text || "").slice(0, 1200),
  }));
}

export {
  summarizeFieldForDebug,
  summarizeSnippetsForDebug,
};

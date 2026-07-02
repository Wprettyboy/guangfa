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


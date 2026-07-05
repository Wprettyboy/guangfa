import { writeAiDebugLog } from "./debug-log.js";
import { requestChatCompletion } from "./chat-completions.js";

export async function callJsonModel(runtime, systemPrompt, userPrompt, maxTokens, options = {}) {
  const { baseUrl, model } = runtime;
  const data = await requestChatCompletion(runtime, {
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    ...(isLocalEndpoint(baseUrl) ? { reasoning: false } : {}),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const content = stripThinking(data?.choices?.[0]?.message?.content || "{}");
  const parsed = parseModelJson(content);
  if (options.partialArrayKey && !Array.isArray(parsed?.[options.partialArrayKey])) {
    const partialItems = parsePartialJsonObjects(content);
    if (partialItems.length > 0) parsed[options.partialArrayKey] = partialItems;
  }
  if (options.debugFileName) {
    await writeAiDebugLog(options.debugFileName, {
      createdAt: new Date().toISOString(),
      model,
      baseUrl,
      maxTokens,
      context: options.debugContext || {},
      systemPrompt,
      userPrompt,
      finishReason: data?.choices?.[0]?.finish_reason || "",
      usage: data?.usage || null,
      parsed,
      content,
    });
  }
  return parsed;
}

export async function callChatModel(runtime, messages, maxTokens, options = {}) {
  const { baseUrl, model } = runtime;
  const data = await requestChatCompletion(runtime, {
    temperature: 0.2,
    max_tokens: maxTokens,
    ...(isLocalEndpoint(baseUrl) ? { reasoning: false } : {}),
    messages,
  });
  const content = stripThinking(data?.choices?.[0]?.message?.content || "").trim();
  if (options.debugFileName) {
    await writeAiDebugLog(options.debugFileName, {
      createdAt: new Date().toISOString(),
      model,
      baseUrl,
      maxTokens,
      context: options.debugContext || {},
      messages,
      finishReason: data?.choices?.[0]?.finish_reason || "",
      usage: data?.usage || null,
      content,
    });
  }
  return content;
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
}

function stripThinking(content) {
  return String(content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function parsePartialJsonObjects(content) {
  const text = String(content || "");
  const items = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== "}") continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const parsed = JSON.parse(text.slice(start, index + 1));
      if (parsed && typeof parsed === "object" && (Number.isFinite(Number(parsed.paragraphIndex)) || Number.isFinite(Number(parsed.outlineIndex)))) items.push(parsed);
    } catch {}
    start = -1;
  }

  return items;
}


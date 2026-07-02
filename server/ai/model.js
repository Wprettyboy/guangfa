import { writeAiDebugLog } from "./debug-log.js";



export async function callJsonModel(runtime, systemPrompt, userPrompt, maxTokens, options = {}) {
  const { baseUrl, model, apiKey } = runtime;
  const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocalEndpoint) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  let apiResponse;
  try {
    apiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        ...(isLocalEndpoint ? { reasoning: false } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (fetchError) {
    const error = new Error(`AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
    error.statusCode = 502;
    throw error;
  }

  if (!apiResponse.ok) {
    const text = await apiResponse.text();
    const error = new Error(`AI 接口返回异常：${apiResponse.status} ${text.slice(0, 160)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = await apiResponse.json();
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
  const { baseUrl, model, apiKey } = runtime;
  const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocalEndpoint) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  let apiResponse;
  try {
    apiResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(isLocalEndpoint ? { reasoning: false } : {}),
        messages,
      }),
    });
  } catch {
    const error = new Error(`AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
    error.statusCode = 502;
    throw error;
  }

  if (!apiResponse.ok) {
    const text = await apiResponse.text();
    const error = new Error(`AI 接口返回异常：${apiResponse.status} ${text.slice(0, 160)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = await apiResponse.json();
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


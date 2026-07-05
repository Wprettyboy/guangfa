const retryableKeyStatuses = new Set([401, 403, 429, 500, 502, 503, 504]);
const rotationState = new Map();

async function requestChatCompletion(runtime, payload) {
  const baseUrl = String(runtime?.baseUrl || "").trim();
  const model = String(runtime?.model || "").trim();
  const isLocal = isLocalEndpoint(baseUrl);
  const apiKeys = splitApiKeys(runtime?.apiKey);

  if (!apiKeys.length && !isLocal) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  const keys = apiKeys.length ? orderedKeys(baseUrl, model, apiKeys) : [""];
  const body = normalizePayloadForRuntime(baseUrl, { ...payload, model });
  let lastErrorText = "";
  let lastStatus = 502;

  for (let index = 0; index < keys.length; index += 1) {
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(keys[index] ? { Authorization: `Bearer ${keys[index]}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      const error = new Error(`AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
      error.statusCode = 502;
      throw error;
    }

    if (response.ok) return response.json();

    lastStatus = response.status;
    lastErrorText = await response.text();
    if (keys.length <= 1 || !retryableKeyStatuses.has(response.status)) {
      throwAiResponseError(response.status, lastErrorText);
    }
  }

  throwAiResponseError(lastStatus, `所有 API Key 均不可用：${lastErrorText}`);
}

function splitApiKeys(value) {
  return String(value || "")
    .split(/\r?\n|\\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function orderedKeys(baseUrl, model, apiKeys) {
  if (apiKeys.length <= 1) return apiKeys;
  const stateKey = `${baseUrl}|${model}|${apiKeys.length}`;
  const start = rotationState.get(stateKey) || 0;
  rotationState.set(stateKey, (start + 1) % apiKeys.length);
  return [...apiKeys.slice(start), ...apiKeys.slice(0, start)];
}

function normalizePayloadForRuntime(baseUrl, payload) {
  if (!isGeminiOpenAiEndpoint(baseUrl)) return payload;
  const next = { ...payload };
  delete next.response_format;
  return next;
}

function isGeminiOpenAiEndpoint(baseUrl) {
  return /generativelanguage\.googleapis\.com\/.*\/openai/i.test(String(baseUrl || ""));
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
}

function throwAiResponseError(status, text) {
  const error = new Error(`AI 接口返回异常：${status} ${String(text || "").slice(0, 160)}`);
  error.statusCode = 502;
  throw error;
}

export { requestChatCompletion, splitApiKeys };

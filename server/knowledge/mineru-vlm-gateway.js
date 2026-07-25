import { readJsonBody, sendJson } from "../api/http.js";
import { requestChatCompletion } from "../ai/chat-completions.js";
import { getModelConfig } from "../settings.js";

const defaultModelName = "opendatalab/MinerU2.5-Pro-2605-1.2B";
const defaultLocalBaseUrl = "http://127.0.0.1:30000";
const maxRequestBytes = 64 * 1024 * 1024;
const cloudCooldownMs = 30_000;
let cloudDisabledUntil = 0;

function createMineruVlmGateway() {
  return async function handleMineruVlmGateway(request, response, next = () => {}) {
    const url = new URL(request.url || "/", "http://local");
    if (!url.pathname.startsWith("/v1/")) {
      next();
      return;
    }
    if (!isAllowedPeer(request)) {
      sendJson(response, 403, { error: "MinerU VLM 网关只允许本机或 Docker 内网访问" });
      return;
    }
    if (url.pathname === "/v1/models" && request.method === "GET") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: process.env.MINERU_VL_MODEL_NAME || defaultModelName, object: "model" }],
      });
      return;
    }
    if (url.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      sendJson(response, 404, { error: "MinerU VLM 网关接口不存在" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request, { limitBytes: maxRequestBytes });
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 400, { error: error?.message || "VLM 请求格式无效" });
      return;
    }
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      sendJson(response, 400, { error: "VLM 请求缺少 messages" });
      return;
    }

    try {
      const result = await requestMineruCompletion(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 502, {
        error: error?.message || "MinerU VLM 调用失败",
      });
    }
  };
}

async function requestMineruCompletion(payload) {
  const config = await getModelConfig();
  const provider = String(process.env.MINERU_VLM_PROVIDER || "gemini-first").toLowerCase();
  const cloud = config.cloud;
  if (provider !== "local" && Date.now() >= cloudDisabledUntil && isGeminiRuntime(cloud)) {
    try {
      const result = await requestChatCompletion(
        { ...cloud, timeoutMs: readTimeout("MINERU_GEMINI_VLM_TIMEOUT_MS", 90_000) },
        payload,
        { allowLocal: false, ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}) },
      );
      cloudDisabledUntil = 0;
      return result;
    } catch (error) {
      cloudDisabledUntil = Date.now() + cloudCooldownMs;
      if (provider === "cloud") throw error;
    }
  }

  if (provider === "cloud") {
    throw createGatewayError("Gemini VLM 当前不可用", 502);
  }

  const local = {
    baseUrl: process.env.MINERU_VLM_LOCAL_BASE_URL || defaultLocalBaseUrl,
    model: process.env.MINERU_VL_MODEL_NAME || defaultModelName,
    apiKey: "",
    timeoutMs: readTimeout("MINERU_LOCAL_VLM_TIMEOUT_MS", 10 * 60_000),
  };
  return requestChatCompletion(local, payload, { allowLocal: true });
}

function isGeminiRuntime(runtime = {}) {
  try {
    const url = new URL(String(runtime.baseUrl || ""));
    return url.hostname === "generativelanguage.googleapis.com"
      && /gemini/i.test(String(runtime.model || ""))
      && Boolean(String(runtime.apiKey || "").trim());
  } catch {
    return false;
  }
}

function isAllowedPeer(request) {
  const value = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  if (["127.0.0.1", "::1", "localhost"].includes(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  return /^192\.168\.65\./.test(value);
}

function readTimeout(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(10 * 60_000, Math.max(1000, value)) : fallback;
}

function createGatewayError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export { createMineruVlmGateway, isGeminiRuntime, requestMineruCompletion };

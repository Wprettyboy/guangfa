import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requestChatCompletion, splitApiKeys } from "./ai/chat-completions.js";

const settingsDir = path.resolve(process.cwd(), "data", "settings");
const settingsFile = path.join(settingsDir, "model-config.json");
const envFile = path.resolve(process.cwd(), ".env.local");

const envKeys = [
  "AI_PROVIDER",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_API_KEY",
  "LOCAL_LLM_BASE_URL",
  "LOCAL_LLM_MODEL",
  "LOCAL_LLM_API_KEY",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_DIMENSION",
  "EMBEDDING_TIMEOUT_MS",
];

export async function getModelConfig() {
  const saved = await readSavedConfig();
  return normalizeConfig({
    provider: saved.provider || process.env.AI_PROVIDER || inferProvider(),
    local: {
      baseUrl: saved.local?.baseUrl ?? process.env.LOCAL_LLM_BASE_URL ?? "",
      model: saved.local?.model ?? process.env.LOCAL_LLM_MODEL ?? "",
      apiKey: saved.local?.apiKey ?? process.env.LOCAL_LLM_API_KEY ?? "",
    },
    cloud: {
      baseUrl: saved.cloud?.baseUrl ?? process.env.AI_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: saved.cloud?.model ?? process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      apiKey: saved.cloud?.apiKey ?? process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    },
    embedding: {
      baseUrl: saved.embedding?.baseUrl ?? process.env.EMBEDDING_BASE_URL ?? "",
      model: saved.embedding?.model ?? process.env.EMBEDDING_MODEL ?? "",
      apiKey: saved.embedding?.apiKey ?? process.env.EMBEDDING_API_KEY ?? "",
      dimension: saved.embedding?.dimension ?? process.env.EMBEDDING_DIMENSION ?? "1024",
      timeoutMs: saved.embedding?.timeoutMs ?? process.env.EMBEDDING_TIMEOUT_MS ?? "60000",
    },
  });
}

async function saveModelConfig(config) {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsFile, JSON.stringify(config, null, 2), "utf8");
  applyConfigToProcess(config);
  await updateEnvLocal(config);
}

async function testModelConfig(payload) {
  const config = normalizeConfig(payload.config || (await getModelConfig()));
  const target = payload.target === "embedding" ? "embedding" : "llm";
  if (target === "embedding") return testEmbedding(config.embedding);
  return testLlm(config.provider === "cloud" ? config.cloud : config.local);
}

async function testLlm(runtime) {
  if (!runtime.baseUrl || !runtime.model) {
    const error = new Error("请先填写当前模型的 Base URL 和模型名称。");
    error.statusCode = 400;
    throw error;
  }
  const isLocal = isLocalEndpoint(runtime.baseUrl);
  if (!splitApiKeys(runtime.apiKey).length && !isLocal) {
    const error = new Error("云端 API 需要填写 API Key。");
    error.statusCode = 400;
    throw error;
  }

  await requestChatCompletion(runtime, {
    temperature: 0,
    max_tokens: 32,
    ...(isLocal ? { reasoning: false } : {}),
    messages: [
      { role: "system", content: "只返回 JSON，不要输出思考过程。" },
      { role: "user", content: '返回 {"ok":true}' },
    ],
  });
  return { ok: true, message: "当前模型连接正常" };
}

async function testEmbedding(embedding) {
  if (!embedding.baseUrl || !embedding.model) {
    const error = new Error("请先填写 Embedding Base URL 和模型名称。");
    error.statusCode = 400;
    throw error;
  }
  const response = await fetch(buildEmbeddingUrl(embedding.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(embedding.apiKey ? { Authorization: `Bearer ${embedding.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: embedding.model,
      input: ["系统设置连接测试"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Embedding 接口异常：${response.status} ${text.slice(0, 160)}`);
    error.statusCode = 502;
    throw error;
  }
  const data = await response.json();
  const dimension = data?.data?.[0]?.embedding?.length || 0;
  return { ok: true, message: `Embedding 连接正常，返回维度 ${dimension}` };
}

function normalizeConfig(value) {
  return {
    provider: value.provider === "cloud" ? "cloud" : "local",
    local: normalizeRuntime(value.local),
    cloud: normalizeRuntime(value.cloud),
    embedding: {
      baseUrl: String(value.embedding?.baseUrl || "").trim(),
      model: String(value.embedding?.model || "").trim(),
      apiKey: String(value.embedding?.apiKey || ""),
      dimension: String(value.embedding?.dimension || "1024").trim(),
      timeoutMs: String(value.embedding?.timeoutMs || "60000").trim(),
    },
  };
}

function normalizeRuntime(runtime = {}) {
  return {
    baseUrl: String(runtime.baseUrl || "").trim(),
    model: String(runtime.model || "").trim(),
    apiKey: String(runtime.apiKey || ""),
  };
}

function applyConfigToProcess(config) {
  process.env.AI_PROVIDER = config.provider;
  process.env.LOCAL_LLM_BASE_URL = config.local.baseUrl;
  process.env.LOCAL_LLM_MODEL = config.local.model;
  process.env.LOCAL_LLM_API_KEY = config.local.apiKey;
  process.env.DEEPSEEK_BASE_URL = config.cloud.baseUrl;
  process.env.DEEPSEEK_MODEL = config.cloud.model;
  process.env.DEEPSEEK_API_KEY = config.cloud.apiKey;
  process.env.EMBEDDING_BASE_URL = config.embedding.baseUrl;
  process.env.EMBEDDING_MODEL = config.embedding.model;
  process.env.EMBEDDING_API_KEY = config.embedding.apiKey;
  process.env.EMBEDDING_DIMENSION = config.embedding.dimension;
  process.env.EMBEDDING_TIMEOUT_MS = config.embedding.timeoutMs;
}

async function updateEnvLocal(config) {
  const updates = {
    AI_PROVIDER: config.provider,
    DEEPSEEK_BASE_URL: config.cloud.baseUrl,
    DEEPSEEK_MODEL: config.cloud.model,
    DEEPSEEK_API_KEY: config.cloud.apiKey,
    LOCAL_LLM_BASE_URL: config.local.baseUrl,
    LOCAL_LLM_MODEL: config.local.model,
    LOCAL_LLM_API_KEY: config.local.apiKey,
    EMBEDDING_BASE_URL: config.embedding.baseUrl,
    EMBEDDING_MODEL: config.embedding.model,
    EMBEDDING_API_KEY: config.embedding.apiKey,
    EMBEDDING_DIMENSION: config.embedding.dimension,
    EMBEDDING_TIMEOUT_MS: config.embedding.timeoutMs,
  };

  let raw = "";
  try {
    raw = await readFile(envFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = raw.split(/\r?\n/).filter((line, index, array) => line || index < array.length - 1);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${escapeEnvValue(updates[match[1]])}`;
  });

  envKeys.forEach((key) => {
    if (!seen.has(key)) nextLines.push(`${key}=${escapeEnvValue(updates[key] || "")}`);
  });
  await writeFile(envFile, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

async function readSavedConfig() {
  try {
    return JSON.parse(await readFile(settingsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function inferProvider() {
  if (process.env.AI_PROVIDER === "cloud") return "cloud";
  if (process.env.AI_PROVIDER === "local") return "local";
  return process.env.LOCAL_LLM_BASE_URL ? "local" : "cloud";
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl);
}

function buildEmbeddingUrl(baseUrl) {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return cleanBase.endsWith("/embeddings") ? cleanBase : `${cleanBase}/embeddings`;
}

function escapeEnvValue(value) {
  const text = String(value ?? "");
  return /[\s#"'`]/.test(text) ? JSON.stringify(text) : text;
}

export { normalizeConfig, saveModelConfig, testModelConfig };

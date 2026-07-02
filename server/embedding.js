const defaultEmbeddingDimension = 1024;
const defaultEmbeddingTimeoutMs = 30000;

export function getEmbeddingConfig() {
  return {
    baseUrl: process.env.EMBEDDING_BASE_URL || "",
    model: process.env.EMBEDDING_MODEL || "",
    apiKey: process.env.EMBEDDING_API_KEY || "",
    dimension: Number(process.env.EMBEDDING_DIMENSION || defaultEmbeddingDimension),
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || defaultEmbeddingTimeoutMs),
  };
}

export function isEmbeddingConfigured() {
  const config = getEmbeddingConfig();
  return Boolean(config.baseUrl && config.model);
}

export async function createEmbedding(input) {
  const [embedding] = await createEmbeddings([input]);
  return embedding;
}

export async function createEmbeddings(inputs) {
  const config = getEmbeddingConfig();
  if (!config.baseUrl || !config.model) {
    const error = new Error("未配置 EMBEDDING_BASE_URL 或 EMBEDDING_MODEL，知识库仅支持关键词检索。");
    error.code = "EMBEDDING_NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(buildEmbeddingUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Embedding 接口返回异常：${response.status} ${text.slice(0, 160)}`);
      error.code = "EMBEDDING_REQUEST_FAILED";
      throw error;
    }

    const data = await response.json();
    const embeddings = Array.isArray(data?.data)
      ? data.data.map((item) => item.embedding).filter((item) => Array.isArray(item))
      : [];
    if (embeddings.length !== inputs.length) {
      const error = new Error("Embedding 接口返回数量与输入数量不一致。");
      error.code = "EMBEDDING_RESPONSE_INVALID";
      throw error;
    }
    return embeddings.map((embedding) => normalizeEmbeddingDimension(embedding, config.dimension));
  } finally {
    clearTimeout(timeout);
  }
}

function buildEmbeddingUrl(baseUrl) {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return cleanBase.endsWith("/embeddings") ? cleanBase : `${cleanBase}/embeddings`;
}

function normalizeEmbeddingDimension(embedding, dimension) {
  if (!Number.isFinite(dimension) || dimension <= 0) return embedding;
  if (embedding.length === dimension) return embedding;
  if (embedding.length > dimension) return embedding.slice(0, dimension);
  return [...embedding, ...Array.from({ length: dimension - embedding.length }, () => 0)];
}

const defaultBaseUrl = "https://api.deepseek.com";

const defaultModel = "deepseek-v4-flash";

const maxKnowledgeChars = 9000;

const maxMaterialChars = 5000;

const materialChunkSize = 1000;

const materialChunkOverlap = 120;

function getAiRuntimeConfig() {
  const provider = process.env.AI_PROVIDER === "cloud" ? "cloud" : process.env.AI_PROVIDER === "local" ? "local" : "";
  if (provider === "local") {
    return {
      baseUrl: process.env.LOCAL_LLM_BASE_URL || process.env.AI_BASE_URL || defaultBaseUrl,
      model: process.env.LOCAL_LLM_MODEL || process.env.AI_MODEL || defaultModel,
      apiKey: process.env.LOCAL_LLM_API_KEY || "",
    };
  }
  if (provider === "cloud") {
    return {
      baseUrl: process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || defaultBaseUrl,
      model: process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || defaultModel,
      apiKey: process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
    };
  }
  return {
    baseUrl: process.env.LOCAL_LLM_BASE_URL || process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || defaultBaseUrl,
    model: process.env.LOCAL_LLM_MODEL || process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || defaultModel,
    apiKey: process.env.LOCAL_LLM_API_KEY || process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
  };
}



export {
  defaultBaseUrl,
  defaultModel,
  maxKnowledgeChars,
  maxMaterialChars,
  materialChunkSize,
  materialChunkOverlap,
  getAiRuntimeConfig,
};


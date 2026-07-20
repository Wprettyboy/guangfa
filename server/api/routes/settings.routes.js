import {
  getModelConfig,
  redactModelConfig,
  resolveModelConfigUpdate,
  saveModelConfig,
  testModelConfig,
} from "../../settings.js";
import { defineRoute } from "../registry.js";

const modelRuntimeSchema = {
  type: "object",
  optional: true,
  properties: {
    baseUrl: "string?",
    model: "string?",
    apiKey: "string?",
  },
};

const embeddingRuntimeSchema = {
  type: "object",
  optional: true,
  properties: {
    baseUrl: "string?",
    model: "string?",
    apiKey: "string?",
    dimension: "string?",
    timeoutMs: "string?",
  },
};

function registerSettingsRoutes() {
  defineRoute({
    id: "settings.model.read",
    method: "GET",
    path: "/api/settings/model",
    tags: ["settings"],
    summary: "读取模型配置",
    roles: ["admin"],
    responses: { 200: "object" },
    handler: async () => redactModelConfig(await getModelConfig()),
  });

  defineRoute({
    id: "settings.model.save",
    method: "POST",
    path: "/api/settings/model",
    tags: ["settings"],
    summary: "保存模型配置",
    roles: ["admin"],
    bodyLimitBytes: 2 * 1024 * 1024,
    body: {
      provider: { type: "string", enum: ["local", "cloud"], optional: true },
      proxyUrl: "string?",
      local: modelRuntimeSchema,
      cloud: modelRuntimeSchema,
      embedding: embeddingRuntimeSchema,
    },
    responses: { 200: "object" },
    handler: async ({ body }) => {
      const config = await resolveModelConfigUpdate(body || {});
      await saveModelConfig(config);
      return { ok: true, config: redactModelConfig(config) };
    },
  });

  defineRoute({
    id: "settings.model.test",
    method: "POST",
    path: "/api/settings/model/test",
    tags: ["settings"],
    summary: "测试模型配置",
    roles: ["admin"],
    bodyLimitBytes: 2 * 1024 * 1024,
    body: {
      target: { type: "string", enum: ["llm", "embedding"], optional: true },
      config: "object?",
    },
    responses: {
      200: "object",
      502: { schema: "object", description: "模型或 Embedding 服务连接失败" },
    },
    handler: ({ body }) => testModelConfig(body || {}),
  });
}

export { registerSettingsRoutes };

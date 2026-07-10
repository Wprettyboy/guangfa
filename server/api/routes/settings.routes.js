import {
  getModelConfig,
  redactModelConfig,
  resolveModelConfigUpdate,
  saveModelConfig,
  testModelConfig,
} from "../../settings.js";
import { defineRoute } from "../registry.js";

function registerSettingsRoutes() {
  defineRoute({
    id: "settings.model.read",
    method: "GET",
    path: "/api/settings/model",
    tags: ["settings"],
    summary: "读取模型配置",
    responses: { 200: "object" },
    handler: async () => redactModelConfig(await getModelConfig()),
  });

  defineRoute({
    id: "settings.model.save",
    method: "POST",
    path: "/api/settings/model",
    tags: ["settings"],
    summary: "保存模型配置",
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { provider: "string?", local: "object?", cloud: "object?", embedding: "object?" },
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
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { target: "string?", config: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => testModelConfig(body || {}),
  });
}

export { registerSettingsRoutes };

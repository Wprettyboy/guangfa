import {
  createTemplateType,
  deleteTemplateType,
  readTemplate,
  readTemplateLibraries,
  readTemplateLibrary,
  readTemplateTypes,
  replaceTemplateLibrary,
  updateTemplateType,
} from "../../template-db.js";
import { defineRoute } from "../registry.js";

const templateBodyLimitBytes = 220 * 1024 * 1024;

function registerTemplateRoutes() {
  defineRoute({
    id: "template.libraries.list",
    method: "GET",
    path: "/api/template-libraries",
    tags: ["templates"],
    summary: "读取模板库列表",
    responses: { 200: "array" },
    handler: () => readTemplateLibraries(),
  });

  defineRoute({
    id: "template.types.list",
    method: "GET",
    path: "/api/template-types",
    tags: ["templates"],
    summary: "读取模板类型列表",
    query: { libraryId: "string?" },
    responses: { 200: "array" },
    handler: ({ query }) => readTemplateTypes(query.get("libraryId") || ""),
  });

  defineRoute({
    id: "template.types.create",
    method: "POST",
    path: "/api/template-types",
    tags: ["templates"],
    summary: "创建模板类型",
    body: { libraryId: "string?", name: "string?", description: "string?" },
    responses: { 200: "object" },
    handler: ({ body }) => createTemplateType(body),
  });

  defineRoute({
    id: "template.types.update",
    method: "PUT",
    path: "/api/template-types/:typeId",
    tags: ["templates"],
    summary: "更新模板类型",
    body: { name: "string?", description: "string?" },
    responses: { 200: "object" },
    handler: ({ params, body }) => updateTemplateType(params.typeId, body),
  });

  defineRoute({
    id: "template.types.delete",
    method: "DELETE",
    path: "/api/template-types/:typeId",
    tags: ["templates"],
    summary: "删除模板类型",
    responses: { 200: "object" },
    handler: ({ params }) => deleteTemplateType(params.typeId),
  });

  defineRoute({
    id: "templates.list",
    method: "GET",
    path: "/api/templates",
    tags: ["templates"],
    summary: "读取模板清单",
    responses: { 200: "array" },
    handler: () => readTemplateLibrary(),
  });

  defineRoute({
    id: "templates.read",
    method: "GET",
    path: "/api/templates/:templateId",
    tags: ["templates"],
    summary: "读取单个模板",
    responses: { 200: "object" },
    handler: ({ params }) => readTemplate(params.templateId),
  });

  defineRoute({
    id: "templates.replaceAll",
    method: "POST",
    path: "/api/templates",
    tags: ["templates"],
    summary: "替换模板清单",
    bodyLimitBytes: templateBodyLimitBytes,
    body: { templates: "array" },
    responses: { 200: "object" },
    handler: async ({ body }) => {
      if (!Array.isArray(body)) {
        const error = new Error("模板库数据格式错误");
        error.statusCode = 400;
        throw error;
      }
      await replaceTemplateLibrary(body);
      return { ok: true, count: body.length };
    },
  });
}

export { registerTemplateRoutes };

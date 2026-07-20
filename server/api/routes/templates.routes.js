import {
  createTemplateType,
  deleteTemplateType,
  readTemplateLibrariesSnapshot,
  readTemplateLibrarySnapshot,
  readTemplateSnapshot,
  readTemplateTypesSnapshot,
  replaceTemplateLibrary,
  updateTemplateType,
} from "../../template-db.js";
import { defineRoute } from "../registry.js";

const templateBodyLimitBytes = 220 * 1024 * 1024;
const templateRevisionResponseHeaders = {
  ETag: { schema: "string", description: "当前模板库 revision，写操作通过 If-Match 原样回传" },
};
const templateArrayResponse = { schema: "array", headers: templateRevisionResponseHeaders };
const templateObjectResponse = { schema: "object", headers: templateRevisionResponseHeaders };
const revisionConflictResponses = {
  412: { schema: "object", description: "模板库版本冲突" },
  428: { schema: "object", description: "缺少 If-Match 模板库版本" },
};
const templateMutationHeaders = {
  "If-Match": {
    type: "string",
    required: true,
    missingStatusCode: 428,
    description: "最近一次读取模板资源时返回的 ETag",
  },
};

function registerTemplateRoutes() {
  defineRoute({
    id: "template.libraries.list",
    method: "GET",
    path: "/api/template-libraries",
    tags: ["templates"],
    summary: "读取模板库列表",
    roles: ["viewer"],
    responses: { 200: templateArrayResponse },
    handler: async () => toTemplateResponse(await readTemplateLibrariesSnapshot()),
  });

  defineRoute({
    id: "template.types.list",
    method: "GET",
    path: "/api/template-types",
    tags: ["templates"],
    summary: "读取模板类型列表",
    roles: ["viewer"],
    query: { libraryId: "string?" },
    responses: { 200: templateArrayResponse },
    handler: async ({ query }) => toTemplateResponse(await readTemplateTypesSnapshot(query.get("libraryId") || "")),
  });

  defineRoute({
    id: "template.types.create",
    method: "POST",
    path: "/api/template-types",
    tags: ["templates"],
    summary: "创建模板类型",
    roles: ["editor"],
    headers: templateMutationHeaders,
    body: { id: "string?", libraryId: "string?", name: "string", description: "string?", sortOrder: "number?" },
    responses: { 200: templateObjectResponse, ...revisionConflictResponses },
    handler: async ({ body, principal, request }) => toTemplateResponse(
      await createTemplateType(body, getTemplateMutationOptions(request, principal)),
    ),
  });

  defineRoute({
    id: "template.types.update",
    method: "PUT",
    path: "/api/template-types/:typeId",
    tags: ["templates"],
    summary: "更新模板类型",
    roles: ["editor"],
    headers: templateMutationHeaders,
    body: { name: "string?", description: "string?" },
    responses: {
      200: templateObjectResponse,
      409: { schema: "object", description: "模板类型名称冲突" },
      ...revisionConflictResponses,
    },
    handler: async ({ params, body, principal, request }) => toTemplateResponse(
      await updateTemplateType(params.typeId, body, getTemplateMutationOptions(request, principal)),
    ),
  });

  defineRoute({
    id: "template.types.delete",
    method: "DELETE",
    path: "/api/template-types/:typeId",
    tags: ["templates"],
    summary: "删除模板类型",
    roles: ["editor"],
    headers: templateMutationHeaders,
    responses: {
      200: templateObjectResponse,
      409: { schema: "object", description: "模板类型仍被模板使用" },
      ...revisionConflictResponses,
    },
    handler: async ({ params, principal, request }) => toTemplateResponse(
      await deleteTemplateType(params.typeId, getTemplateMutationOptions(request, principal)),
    ),
  });

  defineRoute({
    id: "templates.list",
    method: "GET",
    path: "/api/templates",
    tags: ["templates"],
    summary: "读取模板清单",
    roles: ["viewer"],
    responses: { 200: templateArrayResponse },
    handler: async () => toTemplateResponse(await readTemplateLibrarySnapshot()),
  });

  defineRoute({
    id: "templates.read",
    method: "GET",
    path: "/api/templates/:templateId",
    tags: ["templates"],
    summary: "读取单个模板",
    roles: ["viewer"],
    responses: { 200: templateObjectResponse },
    handler: async ({ params }) => {
      const snapshot = await readTemplateSnapshot(params.templateId);
      if (snapshot.body == null) {
        const error = new Error("模板不存在");
        error.statusCode = 404;
        throw error;
      }
      return toTemplateResponse(snapshot);
    },
  });

  defineRoute({
    id: "templates.replaceAll",
    method: "POST",
    path: "/api/templates",
    tags: ["templates"],
    summary: "替换模板清单",
    roles: ["editor"],
    headers: templateMutationHeaders,
    bodyLimitBytes: templateBodyLimitBytes,
    body: { type: "array", items: "object" },
    responses: { 200: templateObjectResponse, ...revisionConflictResponses },
    handler: async ({ body, principal, request }) => toTemplateResponse(
      await replaceTemplateLibrary(body, getTemplateMutationOptions(request, principal)),
    ),
  });
}

function getTemplateMutationOptions(request, principal) {
  return {
    expectedRevision: request.headers["if-match"],
    requirePrecondition: principal.authentication !== "disabled",
  };
}

function toTemplateResponse(result) {
  return {
    body: result.body,
    headers: { ETag: result.etag },
  };
}

export { registerTemplateRoutes };

import {
  createOfficeDocument,
  downloadOfficeUrl,
  getOfficeHealth,
  handleOfficeCallback,
  readOfficeDocumentFile,
} from "../../office.js";
import { readLatestOutlineProbe, saveOutlineProbe } from "../../outline-probe.js";
import { defineRoute } from "../registry.js";

const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function registerOfficeRoutes() {
  defineRoute({
    id: "office.health",
    method: "GET",
    path: "/api/office/health",
    tags: ["office"],
    summary: "读取 OnlyOffice 服务状态",
    roles: ["viewer"],
    responses: { 200: "object" },
    handler: () => getOfficeHealth(),
  });

  defineRoute({
    id: "office.documents.create",
    method: "POST",
    path: "/api/office/documents",
    tags: ["office"],
    summary: "上传 DOCX 并创建 OnlyOffice 编辑配置",
    roles: ["editor"],
    bodyLimitBytes: 120 * 1024 * 1024,
    query: { title: "string?", previewId: "string?" },
    requestBody: {
      schema: "binary",
      contentTypes: [docxMimeType, "application/octet-stream"],
    },
    responses: { 200: "object" },
    handler: ({ principal, request, query }) => createOfficeDocument(request, query, principal),
  });

  defineRoute({
    id: "office.documents.file",
    method: "GET",
    path: "/api/office/documents/:documentId/file",
    tags: ["office"],
    summary: "读取当前 Office 文档文件",
    auth: "optional",
    roles: ["editor"],
    query: { "accessToken?": { type: "string", maxLength: 4096 } },
    responses: {
      200: { schema: "binary", contentType: docxMimeType, description: "当前 DOCX 文档" },
      410: { schema: "object", description: "Office 文档会话已过期" },
    },
    handler: ({ params, principal, query }) => readOfficeDocumentFile(params.documentId, { principal, query }),
  });

  defineRoute({
    id: "office.documents.callback",
    method: "POST",
    path: "/api/office/callback/:documentId",
    tags: ["office"],
    summary: "OnlyOffice 保存回调",
    auth: false,
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { status: "integer", key: "string", url: "string?", token: "string?" },
    responses: {
      200: "object",
      410: { schema: "object", description: "Office 文档会话已过期" },
      502: { schema: "object", description: "OnlyOffice 回调文件下载失败" },
    },
    handler: ({ params, body, request }) => handleOfficeCallback(params.documentId, body, request),
  });

  defineRoute({
    id: "office.downloadUrl",
    method: "POST",
    path: "/api/office/download-url",
    tags: ["office"],
    summary: "代理下载 OnlyOffice 临时导出地址",
    roles: ["editor"],
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { url: "string" },
    responses: {
      200: { schema: "binary", contentType: docxMimeType, description: "OnlyOffice 导出的 DOCX 文档" },
      502: { schema: "object", description: "OnlyOffice 临时文件下载失败" },
    },
    handler: ({ body }) => downloadOfficeUrl(body),
  });

  defineRoute({
    id: "office.outlineProbe.save",
    method: "POST",
    path: "/api/office/outline-probe",
    tags: ["office", "debug"],
    summary: "保存 OnlyOffice 大纲探针结果",
    roles: ["admin"],
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { fileName: "string?", previewId: "string?", outline: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => saveOutlineProbe(body),
  });

  defineRoute({
    id: "office.outlineProbe.latest",
    method: "GET",
    path: "/api/office/outline-probe/latest",
    tags: ["office", "debug"],
    summary: "读取最近一次 OnlyOffice 大纲探针结果",
    roles: ["admin"],
    responses: { 200: "object" },
    handler: () => readLatestOutlineProbe(),
  });
}

export { registerOfficeRoutes };

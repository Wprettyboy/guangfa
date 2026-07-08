import {
  createOfficeDocument,
  downloadOfficeUrl,
  getOfficeHealth,
  handleOfficeCallback,
  readOfficeDocumentFile,
} from "../../office.js";
import { readLatestOutlineProbe, saveOutlineProbe } from "../../outline-probe.js";
import { defineRoute } from "../registry.js";

function registerOfficeRoutes() {
  defineRoute({
    id: "office.health",
    method: "GET",
    path: "/api/office/health",
    tags: ["office"],
    summary: "读取 OnlyOffice 服务状态",
    responses: { 200: "object" },
    handler: () => getOfficeHealth(),
  });

  defineRoute({
    id: "office.documents.create",
    method: "POST",
    path: "/api/office/documents",
    tags: ["office"],
    summary: "上传 DOCX 并创建 OnlyOffice 编辑配置",
    query: { title: "string?", previewId: "string?" },
    responses: { 200: "object" },
    handler: ({ request, query }) => createOfficeDocument(request, query),
  });

  defineRoute({
    id: "office.documents.file",
    method: "GET",
    path: "/api/office/documents/:documentId/file",
    tags: ["office"],
    summary: "读取当前 Office 文档文件",
    responses: { 200: "binary" },
    handler: ({ params }) => readOfficeDocumentFile(params.documentId),
  });

  defineRoute({
    id: "office.documents.callback",
    method: "POST",
    path: "/api/office/callback/:documentId",
    tags: ["office"],
    summary: "OnlyOffice 保存回调",
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { status: "number?", url: "string?" },
    responses: { 200: "object" },
    handler: ({ params, body }) => handleOfficeCallback(params.documentId, body),
  });

  defineRoute({
    id: "office.downloadUrl",
    method: "POST",
    path: "/api/office/download-url",
    tags: ["office"],
    summary: "代理下载 OnlyOffice 临时导出地址",
    bodyLimitBytes: 2 * 1024 * 1024,
    body: { url: "string" },
    responses: { 200: "binary" },
    handler: ({ body }) => downloadOfficeUrl(body),
  });

  defineRoute({
    id: "office.outlineProbe.save",
    method: "POST",
    path: "/api/office/outline-probe",
    tags: ["office", "debug"],
    summary: "保存 OnlyOffice 大纲探针结果",
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
    responses: { 200: "object" },
    handler: () => readLatestOutlineProbe(),
  });
}

export { registerOfficeRoutes };

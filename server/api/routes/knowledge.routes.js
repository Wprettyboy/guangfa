import {
  addKnowledgeDocument,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  listKnowledgeBases,
  readKnowledgeDocumentFile,
  reindexKnowledgeBase,
  searchKnowledgeBase,
} from "../../knowledge/documents.js";
import {
  listKnowledgeDocumentTables,
  readKnowledgeTableDocx,
  searchKnowledgeTables,
} from "../../knowledge/tables.js";
import {
  listKnowledgeDocumentImages,
  readKnowledgeImageDocx,
  readKnowledgeImageFile,
  searchKnowledgeImages,
} from "../../knowledge/images.js";
import {
  assertCapabilityAccess,
  buildCapabilityResource,
  capabilityQueryName,
  capabilityScopes,
} from "../capability.js";
import { defineRoute } from "../registry.js";

const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function registerKnowledgeRoutes() {
  defineRoute({
    id: "knowledge.bases.list",
    method: "GET",
    path: "/api/knowledge-bases",
    tags: ["knowledge"],
    summary: "读取知识库列表",
    roles: ["viewer"],
    responses: { 200: "array" },
    handler: () => listKnowledgeBases(),
  });

  defineRoute({
    id: "knowledge.bases.create",
    method: "POST",
    path: "/api/knowledge-bases",
    tags: ["knowledge"],
    summary: "创建知识库",
    roles: ["editor"],
    body: {
      name: "string?",
      scope: "string?",
      projectId: "string?",
      description: "string?",
    },
    responses: { 200: "object" },
    handler: ({ body }) => createKnowledgeBase(body),
  });

  defineRoute({
    id: "knowledge.bases.delete",
    method: "DELETE",
    path: "/api/knowledge-bases/:kbId",
    tags: ["knowledge"],
    summary: "删除知识库",
    roles: ["editor"],
    responses: { 200: "object" },
    handler: ({ params }) => deleteKnowledgeBase(params.kbId),
  });

  defineRoute({
    id: "knowledge.bases.search",
    method: "POST",
    path: "/api/knowledge-bases/search",
    tags: ["knowledge"],
    summary: "检索知识库",
    roles: ["viewer"],
    body: {
      query: "string",
      projectId: "string?",
      kbIds: "array?",
      globalKbIds: "array?",
      includeGlobal: "boolean?",
      topK: "integer?",
    },
    responses: { 200: "array" },
    handler: ({ body }) => searchKnowledgeBase(body),
  });

  defineRoute({
    id: "knowledge.bases.reindex",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/reindex",
    tags: ["knowledge"],
    summary: "重建知识库索引",
    roles: ["editor"],
    responses: { 200: "object" },
    handler: ({ params }) => reindexKnowledgeBase(params.kbId),
  });

  defineRoute({
    id: "knowledge.documents.create",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/documents",
    tags: ["knowledge"],
    summary: "上传资料并入库",
    roles: ["editor"],
    headers: {
      "Idempotency-Key": {
        type: "string",
        required: true,
        maxLength: 128,
        pattern: "^[\\x21-\\x7E]+$",
        description: "资料上传操作的唯一幂等键",
      },
    },
    bodyLimitBytes: 120 * 1024 * 1024,
    body: {
      name: "string",
      fileName: "string",
      fileType: "string?",
      size: "string?",
      fileBase64: "string",
    },
    responses: {
      200: { schema: "object", description: "幂等重放已存在的资料" },
      201: { schema: "object", description: "资料已创建" },
      409: { schema: "object", description: "幂等键冲突或资料处理期间被删除" },
    },
    handler: async ({ params, body, principal, request }) => {
      const document = await addKnowledgeDocument(params.kbId, body, {
        idempotencyKey: request.headers["idempotency-key"],
        principal,
      });
      return {
        statusCode: document.idempotentReplay ? 200 : 201,
        body: document,
      };
    },
  });

  defineRoute({
    id: "knowledge.documents.delete",
    method: "DELETE",
    path: "/api/knowledge-bases/:kbId/documents/:documentId",
    tags: ["knowledge"],
    summary: "删除知识库资料",
    roles: ["editor"],
    responses: { 200: "object" },
    handler: ({ params }) => deleteKnowledgeDocument(params.kbId, params.documentId),
  });

  defineRoute({
    id: "knowledge.documents.file",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/file",
    tags: ["knowledge"],
    summary: "读取知识库资料原文件",
    auth: "optional",
    roles: ["viewer"],
    query: { [`${capabilityQueryName}?`]: { type: "string", maxLength: 4096 } },
    responses: { 200: { schema: "binary", contentType: "application/octet-stream", description: "资料原文件（DOCX、PDF 或 TXT）" } },
    handler: async ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get(capabilityQueryName),
        scope: capabilityScopes.knowledgeDocumentFile,
        resource: buildCapabilityResource("knowledge-document", params.documentId, "file"),
      });
      const file = await readKnowledgeDocumentFile(params.documentId);
      if (!file) {
        const error = new Error("资料原文件不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: getKnowledgeFileContentType(file.row),
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.row.fileName || file.row.name || "document")}"`,
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      };
    },
  });

  defineRoute({
    id: "knowledge.documents.tables",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/tables",
    tags: ["knowledge"],
    summary: "读取知识库资料原文表格",
    roles: ["viewer"],
    responses: { 200: "array" },
    handler: ({ params }) => listKnowledgeDocumentTables(params.documentId),
  });

  defineRoute({
    id: "knowledge.documents.images",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/images",
    tags: ["knowledge"],
    summary: "读取知识库资料原文图片",
    roles: ["viewer"],
    responses: { 200: "array" },
    handler: ({ params }) => listKnowledgeDocumentImages(params.documentId),
  });

  defineRoute({
    id: "knowledge.tables.search",
    method: "POST",
    path: "/api/knowledge-tables/search",
    tags: ["knowledge"],
    summary: "检索知识库原文表格",
    roles: ["viewer"],
    body: {
      query: "string?",
      kbIds: "array?",
      globalKbIds: "array?",
    },
    responses: { 200: "array" },
    handler: ({ body }) => searchKnowledgeTables(body),
  });

  defineRoute({
    id: "knowledge.tables.docx",
    method: "GET",
    path: "/api/knowledge-tables/:documentId/:tableIndex/docx",
    tags: ["knowledge"],
    summary: "读取知识库表格临时 DOCX",
    auth: "optional",
    roles: ["viewer"],
    query: { [`${capabilityQueryName}?`]: { type: "string", maxLength: 4096 } },
    responses: { 200: { schema: "binary", contentType: docxMimeType, description: "DOCX 表格片段" } },
    handler: async ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get(capabilityQueryName),
        scope: capabilityScopes.knowledgeTableDocx,
        resource: buildCapabilityResource("knowledge-table", params.documentId, params.tableIndex, "docx"),
      });
      const file = await readKnowledgeTableDocx(params.documentId, params.tableIndex);
      if (!file) {
        const error = new Error("知识库表格原文不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: docxMimeType,
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      };
    },
  });

  defineRoute({
    id: "knowledge.images.search",
    method: "POST",
    path: "/api/knowledge-images/search",
    tags: ["knowledge"],
    summary: "检索知识库原文图片",
    roles: ["viewer"],
    body: {
      query: "string?",
      kbIds: "array?",
      globalKbIds: "array?",
    },
    responses: { 200: "array" },
    handler: ({ body }) => searchKnowledgeImages(body),
  });

  defineRoute({
    id: "knowledge.images.file",
    method: "GET",
    path: "/api/knowledge-images/:documentId/:imageIndex/file",
    tags: ["knowledge"],
    summary: "读取知识库图片预览文件",
    auth: "optional",
    roles: ["viewer"],
    query: { [`${capabilityQueryName}?`]: { type: "string", maxLength: 4096 } },
    responses: { 200: { schema: "binary", contentType: "image/*", description: "安全栅格图片" } },
    handler: async ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get(capabilityQueryName),
        scope: capabilityScopes.knowledgeImageFile,
        resource: buildCapabilityResource("knowledge-image", params.documentId, params.imageIndex, "file"),
      });
      const file = await readKnowledgeImageFile(params.documentId, params.imageIndex);
      if (!file) {
        const error = new Error("知识库图片原文不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: file.contentType,
        headers: {
          "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      };
    },
  });

  defineRoute({
    id: "knowledge.images.docx",
    method: "GET",
    path: "/api/knowledge-images/:documentId/:imageIndex/docx",
    tags: ["knowledge"],
    summary: "读取知识库图片临时 DOCX",
    auth: "optional",
    roles: ["viewer"],
    query: { [`${capabilityQueryName}?`]: { type: "string", maxLength: 4096 } },
    responses: { 200: { schema: "binary", contentType: docxMimeType, description: "DOCX 图片片段" } },
    handler: async ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get(capabilityQueryName),
        scope: capabilityScopes.knowledgeImageDocx,
        resource: buildCapabilityResource("knowledge-image", params.documentId, params.imageIndex, "docx"),
      });
      const file = await readKnowledgeImageDocx(params.documentId, params.imageIndex);
      if (!file) {
        const error = new Error("知识库图片原文不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: docxMimeType,
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      };
    },
  });
}

function getKnowledgeFileContentType(row = {}) {
  if (row.mimeType) return row.mimeType;
  if (row.fileExt === "docx") return docxMimeType;
  if (row.fileExt === "pdf") return "application/pdf";
  if (row.fileExt === "txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export { registerKnowledgeRoutes };

import {
  addKnowledgeDocument,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  createKnowledgeDocumentOfficePreview,
  listKnowledgeBases,
  readKnowledgeDocumentFile,
  readKnowledgeDocumentImage,
  readKnowledgeDocumentPdf,
  readKnowledgeDocumentStatus,
  reindexKnowledgeBase,
  retryKnowledgeDocumentImages,
  searchKnowledgeBaseDetailed,
} from "../../knowledge/documents.js";
import {
  listKnowledgeDocumentTables,
  readKnowledgeTableDocx,
  searchKnowledgeTables,
} from "../../knowledge/tables.js";
import { readKnowledgeTableEvidence } from "../../knowledge/mineru-tables.js";
import {
  listKnowledgeDocumentImages,
  readKnowledgeImageDocx,
  readKnowledgeImageFile,
  searchKnowledgeImages,
} from "../../knowledge/images.js";
import {
  assertKnowledgeBaseAccess,
  assertKnowledgeChunkAccess,
  assertKnowledgeDocumentAccess,
  assertKnowledgeImageAccess,
  scopeKnowledgeBaseList,
  scopeKnowledgeBasePayload,
  scopeKnowledgeSearchPayload,
} from "../../knowledge/access.js";
import {
  assertCapabilityAccess,
  buildCapabilityResource,
  capabilityQueryName,
  capabilityScopes,
} from "../capability.js";
import { defineRoute } from "../registry.js";

const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const pptxMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function registerKnowledgeRoutes() {
  defineRoute({
    id: "knowledge.bases.list",
    method: "GET",
    path: "/api/knowledge-bases",
    tags: ["knowledge"],
    summary: "读取知识库列表",
    roles: ["viewer"],
    responses: { 200: "array" },
    handler: async ({ principal }) => scopeKnowledgeBaseList(await listKnowledgeBases(), principal),
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
    handler: ({ body, principal }) => createKnowledgeBase(scopeKnowledgeBasePayload(body, principal)),
  });

  defineRoute({
    id: "knowledge.bases.delete",
    method: "DELETE",
    path: "/api/knowledge-bases/:kbId",
    tags: ["knowledge"],
    summary: "删除知识库",
    roles: ["editor"],
    responses: { 200: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      return deleteKnowledgeBase(params.kbId);
    },
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
      filters: "object?",
    },
    responses: { 200: "object" },
    handler: async ({ body, principal }) => searchKnowledgeBaseDetailed(await scopeKnowledgeSearchPayload(body, principal)),
  });

  defineRoute({
    id: "knowledge.bases.reindex",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/reindex",
    tags: ["knowledge"],
    summary: "重建知识库索引",
    roles: ["editor"],
    responses: { 200: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      return reindexKnowledgeBase(params.kbId);
    },
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
      202: { schema: "object", description: "资料已接收并在后台解析" },
      409: { schema: "object", description: "幂等键冲突或资料处理期间被删除" },
    },
    handler: async ({ params, body, principal, request }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      const document = await addKnowledgeDocument(params.kbId, body, {
        idempotencyKey: request.headers["idempotency-key"],
        principal,
        background: true,
      });
      return {
        statusCode: document.idempotentReplay ? 200 : 202,
        body: document,
      };
    },
  });

  defineRoute({
    id: "knowledge.documents.uploadMultipart",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/documents/upload",
    tags: ["knowledge"],
    summary: "使用 multipart 上传资料并入库",
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
    requestBody: {
      parse: "multipart",
      contentType: "multipart/form-data",
      schema: { file: "binary", name: "string?" },
    },
    responses: {
      200: { schema: "object", description: "幂等重放已存在的资料" },
      202: { schema: "object", description: "资料已接收并在后台解析" },
      409: { schema: "object", description: "幂等键冲突或资料处理期间被删除" },
    },
    handler: async ({ params, body, principal, request }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      const document = await addKnowledgeDocument(params.kbId, buildMultipartDocumentPayload(body), {
        idempotencyKey: request.headers["idempotency-key"],
        principal,
        background: true,
      });
      return { statusCode: document.idempotentReplay ? 200 : 202, body: document };
    },
  });

  defineRoute({
    id: "knowledge.documents.retryImages",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/documents/:documentId/retry-images",
    tags: ["knowledge"],
    summary: "重试资料中失败的图片语义解析",
    roles: ["editor"],
    responses: { 200: "object", 202: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      await assertKnowledgeDocumentAccess(params.documentId, principal, { write: true });
      const result = await retryKnowledgeDocumentImages(params.kbId, params.documentId, { background: true });
      return { statusCode: result.retryStarted ? 202 : 200, body: result };
    },
  });

  defineRoute({
    id: "knowledge.documentImages.file",
    method: "GET",
    path: "/api/knowledge-document-images/:imageId/file",
    tags: ["knowledge"],
    summary: "读取 MinerU 图片证据原图",
    roles: ["viewer"],
    responses: { 200: { schema: "binary", contentType: "image/*", description: "MinerU 提取的图片证据" } },
    handler: async ({ params, principal }) => {
      await assertKnowledgeImageAccess(params.imageId, principal);
      const image = await readKnowledgeDocumentImage(params.imageId);
      if (!image) {
        const error = new Error("图片证据不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: image.buffer,
        contentType: image.contentType,
        headers: { "Cache-Control": "private, max-age=300" },
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
    handler: async ({ params, principal }) => {
      await assertKnowledgeBaseAccess(params.kbId, principal, { write: true });
      await assertKnowledgeDocumentAccess(params.documentId, principal, { write: true });
      return deleteKnowledgeDocument(params.kbId, params.documentId);
    },
  });

  defineRoute({
    id: "knowledge.documents.status",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/status",
    tags: ["knowledge"],
    summary: "读取资料解析与索引状态",
    roles: ["viewer"],
    responses: { 200: "object", 404: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeDocumentAccess(params.documentId, principal);
      const document = await readKnowledgeDocumentStatus(params.documentId);
      if (!document) {
        const error = new Error("知识库资料不存在");
        error.statusCode = 404;
        throw error;
      }
      return document;
    },
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
    responses: { 200: { schema: "binary", contentType: "application/octet-stream", description: "资料原文件（PDF、DOCX、PPTX、XLSX 或 TXT）" } },
    handler: async ({ params, principal, query }) => {
      assertCapabilityAccess({
        principal,
        accessToken: query.get(capabilityQueryName),
        scope: capabilityScopes.knowledgeDocumentFile,
        resource: buildCapabilityResource("knowledge-document", params.documentId, "file"),
      });
      await assertKnowledgeDocumentAccess(params.documentId, principal);
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
    id: "knowledge.documents.sourcePdf",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/source-pdf",
    tags: ["knowledge"],
    summary: "读取知识库分页溯源 PDF",
    roles: ["viewer"],
    responses: { 200: { schema: "binary", contentType: "application/pdf", description: "知识库入库时用于解析页码的 PDF" } },
    handler: async ({ params, principal }) => {
      await assertKnowledgeDocumentAccess(params.documentId, principal);
      const file = await readKnowledgeDocumentPdf(params.documentId);
      if (!file) {
        const error = new Error("该资料没有可用于页码溯源的 PDF");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": `inline; filename="${encodeURIComponent(`${String(file.row.fileName || file.row.name || "document").replace(/\.[^.]+$/, "")}.pdf`)}"`,
          "Cache-Control": "private, no-store",
        },
      };
    },
  });

  defineRoute({
    id: "knowledge.documents.officePreview",
    method: "POST",
    path: "/api/knowledge-documents/:documentId/office-preview",
    tags: ["knowledge", "office"],
    summary: "创建知识库原始 DOCX 只读预览",
    roles: ["viewer"],
    responses: { 200: "object", 404: "object", 410: "object", 415: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeDocumentAccess(params.documentId, principal);
      return createKnowledgeDocumentOfficePreview(params.documentId, { principal });
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
    handler: async ({ params, principal }) => {
      await assertKnowledgeDocumentAccess(params.documentId, principal);
      return listKnowledgeDocumentTables(params.documentId);
    },
  });

  defineRoute({
    id: "knowledge.chunks.tableEvidence",
    method: "GET",
    path: "/api/knowledge-chunks/:chunkId/table",
    tags: ["knowledge"],
    summary: "读取检索命中的 MinerU 原始表格结构",
    roles: ["viewer"],
    responses: { 200: "object", 404: "object" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeChunkAccess(params.chunkId, principal);
      const table = await readKnowledgeTableEvidence(params.chunkId);
      if (!table) {
        const error = new Error("该检索结果未保留可用的原始表格结构");
        error.statusCode = 404;
        throw error;
      }
      return table;
    },
  });

  defineRoute({
    id: "knowledge.documents.images",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/images",
    tags: ["knowledge"],
    summary: "读取知识库资料原文图片",
    roles: ["viewer"],
    responses: { 200: "array" },
    handler: async ({ params, principal }) => {
      await assertKnowledgeDocumentAccess(params.documentId, principal);
      return listKnowledgeDocumentImages(params.documentId);
    },
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
    handler: async ({ body, principal }) => searchKnowledgeTables(await scopeKnowledgeSearchPayload(body, principal)),
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
      await assertKnowledgeDocumentAccess(params.documentId, principal);
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
    handler: async ({ body, principal }) => searchKnowledgeImages(await scopeKnowledgeSearchPayload(body, principal)),
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
      await assertKnowledgeDocumentAccess(params.documentId, principal);
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
      await assertKnowledgeDocumentAccess(params.documentId, principal);
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

function buildMultipartDocumentPayload(body = {}) {
  const file = body.file;
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || !file.fileName) {
    const error = new Error("multipart 上传缺少 file 文件字段");
    error.statusCode = 400;
    throw error;
  }
  return {
    name: String(body.name || file.fileName),
    fileName: file.fileName,
    fileType: file.mimeType,
    size: `${file.size} B`,
    fileBuffer: file.buffer,
  };
}

function getKnowledgeFileContentType(row = {}) {
  if (row.mimeType) return row.mimeType;
  if (row.fileExt === "docx") return docxMimeType;
  if (row.fileExt === "pptx") return pptxMimeType;
  if (row.fileExt === "xlsx") return xlsxMimeType;
  if (row.fileExt === "pdf") return "application/pdf";
  if (row.fileExt === "txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export { registerKnowledgeRoutes };

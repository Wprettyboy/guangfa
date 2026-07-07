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
import { defineRoute } from "../registry.js";

function registerKnowledgeRoutes() {
  defineRoute({
    id: "knowledge.bases.list",
    method: "GET",
    path: "/api/knowledge-bases",
    tags: ["knowledge"],
    summary: "读取知识库列表",
    responses: { 200: "array" },
    handler: () => listKnowledgeBases(),
  });

  defineRoute({
    id: "knowledge.bases.create",
    method: "POST",
    path: "/api/knowledge-bases",
    tags: ["knowledge"],
    summary: "创建知识库",
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
    responses: { 200: "object" },
    handler: ({ params }) => deleteKnowledgeBase(params.kbId),
  });

  defineRoute({
    id: "knowledge.bases.search",
    method: "POST",
    path: "/api/knowledge-bases/search",
    tags: ["knowledge"],
    summary: "检索知识库",
    body: {
      query: "string",
      projectId: "string?",
      kbIds: "array?",
      globalKbIds: "array?",
      includeGlobal: "boolean?",
      topK: "number?",
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
    responses: { 200: "object" },
    handler: ({ params }) => reindexKnowledgeBase(params.kbId),
  });

  defineRoute({
    id: "knowledge.documents.create",
    method: "POST",
    path: "/api/knowledge-bases/:kbId/documents",
    tags: ["knowledge"],
    summary: "上传资料并入库",
    bodyLimitBytes: 120 * 1024 * 1024,
    body: {
      name: "string",
      fileName: "string",
      fileType: "string?",
      size: "string?",
      fileBase64: "string",
    },
    responses: { 200: "object" },
    handler: ({ params, body }) => addKnowledgeDocument(params.kbId, body),
  });

  defineRoute({
    id: "knowledge.documents.delete",
    method: "DELETE",
    path: "/api/knowledge-bases/:kbId/documents/:documentId",
    tags: ["knowledge"],
    summary: "删除知识库资料",
    responses: { 200: "object" },
    handler: ({ params }) => deleteKnowledgeDocument(params.kbId, params.documentId),
  });

  defineRoute({
    id: "knowledge.documents.file",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/file",
    tags: ["knowledge"],
    summary: "读取知识库资料原文件",
    responses: { 200: "binary" },
    handler: async ({ params }) => {
      const file = await readKnowledgeDocumentFile(params.documentId);
      if (!file) {
        const error = new Error("资料原文件不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: "application/octet-stream",
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.row.fileName || file.row.name || "document")}"`,
          "Cache-Control": "no-store",
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
    responses: { 200: "array" },
    handler: ({ params }) => listKnowledgeDocumentTables(params.documentId),
  });

  defineRoute({
    id: "knowledge.documents.images",
    method: "GET",
    path: "/api/knowledge-documents/:documentId/images",
    tags: ["knowledge"],
    summary: "读取知识库资料原文图片",
    responses: { 200: "array" },
    handler: ({ params }) => listKnowledgeDocumentImages(params.documentId),
  });

  defineRoute({
    id: "knowledge.tables.search",
    method: "POST",
    path: "/api/knowledge-tables/search",
    tags: ["knowledge"],
    summary: "检索知识库原文表格",
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
    responses: { 200: "binary" },
    handler: async ({ params }) => {
      const file = await readKnowledgeTableDocx(params.documentId, params.tableIndex);
      if (!file) {
        const error = new Error("知识库表格原文不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
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
    responses: { 200: "binary" },
    handler: async ({ params }) => {
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
    responses: { 200: "binary" },
    handler: async ({ params }) => {
      const file = await readKnowledgeImageDocx(params.documentId, params.imageIndex);
      if (!file) {
        const error = new Error("知识库图片原文不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        kind: "buffer",
        buffer: file.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
          "Cache-Control": "no-store",
        },
      };
    },
  });
}

export { registerKnowledgeRoutes };

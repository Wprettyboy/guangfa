import {
  addKnowledgeDocument,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  listKnowledgeBases,
  readKnowledgeDocumentFile,
  reindexKnowledgeBase,
  searchKnowledgeBase,
} from "./knowledge/documents.js";

export function knowledgeBaseMiddleware() {
  return async function handleKnowledgeBase(request, response, next) {
    const url = new URL(request.url || "", "http://local");
    const parts = url.pathname.split("/").filter(Boolean);
    const isKnowledgeApi = url.pathname.startsWith("/api/knowledge-bases");
    const isDocumentFileApi = url.pathname.startsWith("/api/knowledge-documents/");
    if (!isKnowledgeApi && !isDocumentFileApi) {
      next();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/knowledge-bases") {
        sendJson(response, 200, await listKnowledgeBases());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/knowledge-bases") {
        sendJson(response, 200, await createKnowledgeBase(await readJsonBody(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/knowledge-bases/search") {
        sendJson(response, 200, await searchKnowledgeBase(await readJsonBody(request)));
        return;
      }

      if (request.method === "DELETE" && parts.length === 3) {
        sendJson(response, 200, await deleteKnowledgeBase(parts[2]));
        return;
      }

      if (request.method === "POST" && parts.length === 4 && parts[3] === "reindex") {
        sendJson(response, 200, await reindexKnowledgeBase(parts[2]));
        return;
      }

      if (request.method === "POST" && parts.length === 4 && parts[3] === "documents") {
        sendJson(response, 200, await addKnowledgeDocument(parts[2], await readJsonBody(request)));
        return;
      }

      if (request.method === "DELETE" && parts.length === 5 && parts[3] === "documents") {
        sendJson(response, 200, await deleteKnowledgeDocument(parts[2], parts[4]));
        return;
      }

      const fileMatch = url.pathname.match(/^\/api\/knowledge-documents\/([^/]+)\/file$/);
      if (request.method === "GET" && fileMatch) {
        const file = await readKnowledgeDocumentFile(decodeURIComponent(fileMatch[1]));
        if (!file) {
          sendJson(response, 404, { error: "资料原文件不存在" });
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.row.fileName || file.row.name || "document")}"`);
        response.setHeader("Cache-Control", "no-store");
        response.end(file.buffer);
        return;
      }

      sendJson(response, 404, { error: "知识库接口不存在" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "知识库接口异常",
      });
    }
  };
}

export { searchKnowledgeBase };

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 120 * 1024 * 1024) {
        const error = new Error("知识库请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("请求 JSON 格式错误");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

import {
  readTemplate,
  readTemplateLibraries,
  readTemplateLibrary,
  readTemplateTypes,
  replaceTemplateLibrary,
} from "./template-db.js";

export function templateLibraryMiddleware() {
  return async function handleTemplateLibrary(request, response, next) {
    const url = new URL(request.url || "/", "http://localhost");
    if (
      !url.pathname.startsWith("/api/templates")
      && !url.pathname.startsWith("/api/template-libraries")
      && !url.pathname.startsWith("/api/template-types")
    ) {
      next();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/template-libraries") {
        sendJson(response, 200, await readTemplateLibraries());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/template-types") {
        sendJson(response, 200, await readTemplateTypes(url.searchParams.get("libraryId") || ""));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/templates") {
        sendJson(response, 200, await readTemplateLibrary());
        return;
      }

      const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
      if (request.method === "GET" && templateMatch) {
        sendJson(response, 200, await readTemplate(decodeURIComponent(templateMatch[1])));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/templates") {
        const templates = await readJsonBody(request);
        if (!Array.isArray(templates)) {
          const error = new Error("模板库数据格式错误");
          error.statusCode = 400;
          throw error;
        }
        await replaceTemplateLibrary(templates);
        sendJson(response, 200, { ok: true, count: templates.length });
        return;
      }

      sendJson(response, 404, { error: "模板接口不存在" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "模板库读写失败",
      });
    }
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 80 * 1024 * 1024) {
        const error = new Error("模板库请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
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

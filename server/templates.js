import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data", "templates");
const libraryFile = path.join(dataDir, "library.json");

export function templateLibraryMiddleware() {
  return async function handleTemplateLibrary(request, response, next) {
    if (!request.url?.startsWith("/api/templates")) {
      next();
      return;
    }

    try {
      if (request.method === "GET" && request.url === "/api/templates") {
        sendJson(response, 200, await readTemplateLibrary());
        return;
      }

      if (request.method === "GET" && request.url.startsWith("/api/templates/")) {
        const templateId = decodeURIComponent(request.url.replace("/api/templates/", ""));
        const templates = await readTemplateLibrary();
        sendJson(response, 200, templates.find((template) => template.id === templateId) || null);
        return;
      }

      if (request.method === "POST" && request.url === "/api/templates") {
        const templates = await readJsonBody(request);
        if (!Array.isArray(templates)) {
          const error = new Error("模板库数据格式错误");
          error.statusCode = 400;
          throw error;
        }
        await writeTemplateLibrary(templates);
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

async function readTemplateLibrary() {
  try {
    const raw = await readFile(libraryFile, "utf8");
    const templates = JSON.parse(raw);
    return Array.isArray(templates) ? templates : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeTemplateLibrary(templates) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(libraryFile, JSON.stringify(templates, null, 2), "utf8");
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

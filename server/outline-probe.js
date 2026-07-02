import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const debugDir = path.resolve(process.cwd(), "data", "debug");
const latestFile = path.join(debugDir, "onlyoffice-outline-latest.json");

export function outlineProbeMiddleware() {
  return async function handleOutlineProbe(request, response, next) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/office/outline-probe")) {
      next();
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/office/outline-probe") {
        const body = await readJsonBody(request);
        const payload = {
          savedAt: new Date().toISOString(),
          fileName: body?.fileName || "",
          previewId: body?.previewId || "",
          outline: body?.outline || null,
        };
        await mkdir(debugDir, { recursive: true });
        await writeFile(latestFile, JSON.stringify(payload, null, 2), "utf8");
        sendJson(response, 200, {
          ok: true,
          count: payload.outline?.items?.length || 0,
          file: latestFile,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/office/outline-probe/latest") {
        const raw = await readFile(latestFile, "utf8");
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(raw);
        return;
      }

      sendJson(response, 404, { error: "OnlyOffice 大纲调试接口不存在" });
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "还没有收到 OnlyOffice 大纲抽取结果" });
        return;
      }
      sendJson(response, error.statusCode || 500, { error: error.message || "OnlyOffice 大纲调试失败" });
    }
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        const error = new Error("请求内容过大");
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

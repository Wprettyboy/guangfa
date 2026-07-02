import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const draftDir = path.resolve(process.cwd(), "data", "drafts");
const draftFile = path.join(draftDir, "current.json");

export function draftMiddleware() {
  return async function handleDraft(request, response, next) {
    if (request.url !== "/api/draft") {
      next();
      return;
    }

    try {
      if (request.method === "GET") {
        sendJson(response, 200, await readDraft());
        return;
      }

      if (request.method === "POST") {
        const draft = await readJsonBody(request);
        await writeDraft(draft || {});
        sendJson(response, 200, { ok: true });
        return;
      }

      sendJson(response, 405, { error: "草稿接口不支持该方法" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "草稿读写失败",
      });
    }
  };
}

async function readDraft() {
  try {
    return JSON.parse(await readFile(draftFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeDraft(draft) {
  await mkdir(draftDir, { recursive: true });
  const tempFile = path.join(draftDir, `current.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(tempFile, JSON.stringify(draft, null, 2), "utf8");
    await rename(tempFile, draftFile);
  } finally {
    await rm(tempFile, { force: true }).catch(() => {});
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 80 * 1024 * 1024) {
        const error = new Error("草稿请求内容过大");
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

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const defaultApiUrl = "http://127.0.0.1:8010";
const terminalStatuses = new Set(["completed", "failed"]);
const maxResultBytes = 512 * 1024 * 1024;
const maxArtifactBytes = 256 * 1024 * 1024;
const maxArtifactEntries = 4096;

async function parseWithMinerU({ sourcePath, fileName, artifactsDir, textPath }) {
  const config = readMinerUConfig();
  const source = await readFile(sourcePath);
  const task = await submitTask(config, source, fileName);
  await waitForTask(config, task.task_id);
  const resultZip = await downloadTaskResult(config, task.task_id);
  const artifacts = await extractMinerUArtifacts(resultZip, artifactsDir);
  const contentList = parseJsonArtifact(artifacts, "_content_list.json");
  const contentListV2 = parseJsonArtifact(artifacts, "_content_list_v2.json");
  const pages = buildPagesFromMinerU(contentList, contentListV2);
  if (pages.length === 0) throw createMinerUError("MinerU 未返回可入库的文本内容");
  await writeFile(textPath, pages.map((page) => `第${page.page}页\n${page.text}`).join("\n\n"), "utf8");
  return {
    pages,
    blocks: buildBlocksFromMinerU(contentList, contentListV2),
    parser: path.extname(fileName).toLowerCase() === ".pdf" ? `mineru-${config.effort}` : "mineru-office",
    warning: "",
  };
}

function readMinerUConfig() {
  const apiUrl = String(process.env.MINERU_API_URL || defaultApiUrl).replace(/\/$/, "");
  const backend = String(process.env.MINERU_BACKEND || "hybrid-http-client");
  const effort = String(process.env.MINERU_EFFORT || "medium");
  const serverUrl = String(process.env.MINERU_VLM_URL || "http://mineru-vlm:30000");
  if (!new Set(["medium", "high"]).has(effort)) throw createMinerUError("MINERU_EFFORT 只能是 medium 或 high");
  if (!new Set(["hybrid-http-client", "hybrid-engine"]).has(backend)) {
    throw createMinerUError("MINERU_BACKEND 必须使用 Hybrid 后端");
  }
  return {
    apiUrl,
    backend,
    effort,
    serverUrl,
    timeoutMs: clampNumber(Number(process.env.MINERU_PARSE_TIMEOUT_MS || 60 * 60 * 1000), 60_000, 4 * 60 * 60 * 1000),
    pollMs: clampNumber(Number(process.env.MINERU_POLL_INTERVAL_MS || 1500), 250, 10_000),
  };
}

async function submitTask(config, source, fileName) {
  const form = new FormData();
  form.append("files", new Blob([source]), fileName);
  form.append("backend", config.backend);
  form.append("effort", config.effort);
  form.append("parse_method", "auto");
  form.append("lang_list", "ch");
  form.append("formula_enable", "true");
  form.append("table_enable", "true");
  form.append("image_analysis", config.effort === "high" ? "true" : "false");
  if (config.backend === "hybrid-http-client") form.append("server_url", config.serverUrl);
  form.append("return_md", "true");
  form.append("return_middle_json", "true");
  form.append("return_model_output", "false");
  form.append("return_content_list", "true");
  form.append("return_images", "true");
  form.append("response_format_zip", "true");
  form.append("return_original_file", "false");
  const response = await fetch(`${config.apiUrl}/tasks`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJsonResponse(response, "MinerU 任务提交失败");
  if (!body.task_id) throw createMinerUError("MinerU 未返回 task_id");
  return body;
}

async function waitForTask(config, taskId) {
  const deadlineAt = Date.now() + config.timeoutMs;
  while (Date.now() < deadlineAt) {
    const response = await fetch(`${config.apiUrl}/tasks/${encodeURIComponent(taskId)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonResponse(response, "MinerU 任务状态读取失败");
    if (terminalStatuses.has(body.status)) {
      if (body.status === "failed") throw createMinerUError(body.error || "MinerU 解析失败");
      return body;
    }
    await delay(config.pollMs);
  }
  throw createMinerUError("MinerU Hybrid 解析超时", 408);
}

async function downloadTaskResult(config, taskId) {
  const response = await fetch(`${config.apiUrl}/tasks/${encodeURIComponent(taskId)}/result`, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw createMinerUError(`MinerU 结果下载失败：${body.slice(0, 500)}`);
  }
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxResultBytes) throw createMinerUError("MinerU 解析结果过大", 413);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxResultBytes) throw createMinerUError("MinerU 解析结果过大", 413);
  return buffer;
}

async function extractMinerUArtifacts(zipBuffer, artifactsDir) {
  const zip = await JSZip.loadAsync(zipBuffer, { checkCRC32: false, createFolders: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > maxArtifactEntries) throw createMinerUError("MinerU 解析产物条目过多", 413);
  await mkdir(artifactsDir, { recursive: true });
  const artifacts = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    const relativeName = normalizeArtifactName(entry.name);
    if (!relativeName) continue;
    const content = await entry.async("nodebuffer");
    totalBytes += content.length;
    if (totalBytes > maxArtifactBytes) throw createMinerUError("MinerU 解压产物过大", 413);
    const outputPath = path.join(artifactsDir, ...relativeName.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
    artifacts.set(relativeName, content);
  }
  return artifacts;
}

function normalizeArtifactName(name) {
  const normalized = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) return "";
  return parts.slice(2).join("/");
}

function parseJsonArtifact(artifacts, suffix) {
  const entry = [...artifacts.entries()].find(([name]) => name.endsWith(suffix));
  if (!entry) return null;
  try {
    return JSON.parse(entry[1].toString("utf8"));
  } catch {
    throw createMinerUError(`MinerU 产物 ${suffix} 不是有效 JSON`);
  }
}

function buildPagesFromMinerU(contentList, contentListV2) {
  const blocks = buildBlocksFromMinerU(contentList, contentListV2);
  const pages = new Map();
  for (const block of blocks) {
    if (!block.text) continue;
    const page = block.pageIndex + 1;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(block.text);
  }
  return [...pages.entries()].sort(([left], [right]) => left - right).map(([page, texts]) => ({
    page,
    text: texts.join("\n").trim(),
  })).filter((page) => page.text);
}

function buildBlocksFromMinerU(contentList, contentListV2) {
  if (Array.isArray(contentList) && contentList.length > 0) {
    return contentList.map((item, index) => normalizeV1Block(item, index)).filter((block) => block.text);
  }
  if (!Array.isArray(contentListV2)) return [];
  return contentListV2.flatMap((page, pageIndex) => (Array.isArray(page) ? page : []).map((item, index) =>
    normalizeV2Block(item, pageIndex, index))).filter((block) => block.text);
}

function normalizeV1Block(item, index) {
  return {
    id: `B${String(index + 1).padStart(6, "0")}`,
    type: String(item?.type || "text"),
    pageIndex: Math.max(0, Number(item?.page_idx) || 0),
    bbox: normalizeBbox(item?.bbox),
    level: Math.max(0, Number(item?.text_level) || 0),
    anchor: String(item?.anchor || ""),
    text: extractV1Text(item),
  };
}

function normalizeV2Block(item, pageIndex, index) {
  return {
    id: `P${pageIndex + 1}-B${String(index + 1).padStart(4, "0")}`,
    type: String(item?.type || "paragraph"),
    pageIndex,
    bbox: normalizeBbox(item?.bbox),
    level: Math.max(0, Number(item?.content?.level) || 0),
    anchor: String(item?.anchor || ""),
    text: collectText(item?.content),
  };
}

function extractV1Text(item = {}) {
  if (item.type === "table") return stripHtml(item.table_body || item.html || "");
  if (item.type === "image") return [...(item.image_caption || []), ...(item.image_footnote || [])].join("\n").trim();
  return String(item.text || item.content || collectText(item)).trim();
}

function collectText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content.trim();
  if (typeof value.html === "string") return stripHtml(value.html);
  return Object.entries(value)
    .filter(([key]) => !new Set(["type", "level", "path", "url", "image_source", "bbox"]).has(key))
    .map(([, item]) => collectText(item))
    .filter(Boolean)
    .join("\n");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<\/(?:td|th)>\s*<(?:td|th)[^>]*>/gi, " | ")
    .replace(/<\/(?:tr|p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map(Number);
  return bbox.every(Number.isFinite) ? bbox : null;
}

async function readJsonResponse(response, message) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw createMinerUError(message);
  }
  if (!response.ok) throw createMinerUError(body.detail || body.error || body.message || message);
  return body;
}

function createMinerUError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  buildBlocksFromMinerU,
  buildPagesFromMinerU,
  parseWithMinerU,
  readMinerUConfig,
};

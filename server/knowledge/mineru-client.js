import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { enrichMinerUImageCaptions } from "./image-caption.js";
import { stripMinerUTableHtml } from "./mineru-tables.js";

const defaultApiUrl = "http://127.0.0.1:8010";
const terminalStatuses = new Set(["completed", "failed"]);
const maxResultBytes = 512 * 1024 * 1024;
const maxArtifactBytes = 256 * 1024 * 1024;
const maxArtifactEntries = 4096;

async function parseWithMinerU({ sourcePath, fileName, artifactsDir, textPath, onImageProgress }) {
  const config = readMinerUConfig();
  const source = await readFile(sourcePath);
  const task = await submitTask(config, source, fileName);
  await waitForTask(config, task.task_id);
  const resultZip = await downloadTaskResult(config, task.task_id);
  const artifacts = await extractMinerUArtifacts(resultZip, artifactsDir);
  const contentList = parseJsonArtifact(artifacts, "_content_list.json");
  const contentListV2 = parseJsonArtifact(artifacts, "_content_list_v2.json");
  const imageAnalysis = await enrichMinerUImageCaptions({
    artifacts,
    contentList,
    contentListV2,
    onProgress: onImageProgress,
  });
  await rewriteJsonArtifact(artifacts, artifactsDir, "_content_list.json", contentList);
  await rewriteJsonArtifact(artifacts, artifactsDir, "_content_list_v2.json", contentListV2);
  await writeFile(path.join(artifactsDir, "image-analysis.json"), JSON.stringify(imageAnalysis.records, null, 2), "utf8");
  const pages = buildPagesFromMinerU(contentList, contentListV2);
  if (pages.length === 0) throw createMinerUError("MinerU 未返回可入库的文本内容");
  await writeFile(textPath, pages.map((page) => `第${page.page}页\n${page.text}`).join("\n\n"), "utf8");
  return {
    pages,
    blocks: buildBlocksFromMinerU(contentList, contentListV2),
    images: imageAnalysis.records,
    parser: path.extname(fileName).toLowerCase() === ".pdf" ? `mineru-${config.effort}` : "mineru-office",
    warning: imageAnalysis.warning,
  };
}

async function retryMinerUImageCaptions({ artifactsDir, fileName, textPath, imagePaths, onImageProgress }) {
  const artifacts = await readArtifactDirectory(artifactsDir);
  const contentList = parseJsonArtifact(artifacts, "_content_list.json");
  const contentListV2 = parseJsonArtifact(artifacts, "_content_list_v2.json");
  const previousRecords = await readStoredImageRecords(artifactsDir);
  const retried = await enrichMinerUImageCaptions({
    artifacts,
    contentList,
    contentListV2,
    onlyPaths: imagePaths,
    onProgress: onImageProgress,
  });
  const retriedByIndex = new Map(retried.records.map((record) => [record.imageIndex, record]));
  const records = previousRecords.map((record) => retriedByIndex.get(record.imageIndex) || record);
  for (const record of retried.records) {
    if (!records.some((item) => item.imageIndex === record.imageIndex)) records.push(record);
  }
  records.sort((left, right) => left.imageIndex - right.imageIndex);
  await rewriteJsonArtifact(artifacts, artifactsDir, "_content_list.json", contentList);
  await rewriteJsonArtifact(artifacts, artifactsDir, "_content_list_v2.json", contentListV2);
  await writeFile(path.join(artifactsDir, "image-analysis.json"), JSON.stringify(records, null, 2), "utf8");
  const pages = buildPagesFromMinerU(contentList, contentListV2);
  await writeFile(textPath, pages.map((page) => `第${page.page}页\n${page.text}`).join("\n\n"), "utf8");
  return {
    pages,
    blocks: buildBlocksFromMinerU(contentList, contentListV2),
    images: records,
    parser: path.extname(fileName).toLowerCase() === ".pdf" ? `mineru-${readMinerUConfig().effort}` : "mineru-office",
    warning: records.some((record) => record.status === "failed") ? "部分图片仍未生成语义说明，可稍后重试。" : "",
  };
}

function readMinerUConfig() {
  const apiUrl = String(process.env.MINERU_API_URL || defaultApiUrl).replace(/\/$/, "");
  const backend = String(process.env.MINERU_BACKEND || "hybrid-http-client");
  const effort = String(process.env.MINERU_EFFORT || "medium");
  const provider = String(process.env.MINERU_VLM_PROVIDER || "cloud").toLowerCase();
  if (!new Set(["local", "gemini-first", "cloud"]).has(provider)) {
    throw createMinerUError("MINERU_VLM_PROVIDER 只能是 local、gemini-first 或 cloud");
  }
  const defaultServerUrl = provider === "local"
    ? "http://mineru-vlm:30000"
    : String(process.env.MINERU_VLM_GATEWAY_URL || "http://host.docker.internal:5173");
  const serverUrl = String(process.env.MINERU_VLM_URL || defaultServerUrl).replace(/\/$/, "");
  if (!new Set(["medium", "high"]).has(effort)) throw createMinerUError("MINERU_EFFORT 只能是 medium 或 high");
  if (!new Set(["hybrid-http-client", "hybrid-engine"]).has(backend)) {
    throw createMinerUError("MINERU_BACKEND 必须使用 Hybrid 后端");
  }
  return {
    apiUrl,
    backend,
    effort,
    provider,
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
  form.append("image_analysis", "false");
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

async function rewriteJsonArtifact(artifacts, artifactsDir, suffix, value) {
  if (value == null) return;
  const name = [...artifacts.keys()].find((candidate) => candidate.endsWith(suffix));
  if (!name) return;
  const content = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  artifacts.set(name, content);
  await writeFile(path.join(artifactsDir, ...name.split("/")), content);
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
    return contentList.map((item, index) => normalizeV1Block(item, index))
      .filter((block) => block.text || block.imagePath);
  }
  if (!Array.isArray(contentListV2)) return [];
  return contentListV2.flatMap((page, pageIndex) => (Array.isArray(page) ? page : []).map((item, index) =>
    normalizeV2Block(item, pageIndex, index))).filter((block) => block.text || block.imagePath);
}

function normalizeV1Block(item, index) {
  return {
    id: `B${String(index + 1).padStart(6, "0")}`,
    imageIndex: index,
    type: String(item?.type || "text"),
    pageIndex: Math.max(0, Number(item?.page_idx) || 0),
    bbox: normalizeBbox(item?.bbox),
    level: Math.max(0, Number(item?.text_level) || 0),
    anchor: String(item?.anchor || ""),
    imagePath: normalizeStoredArtifactPath(item?.img_path || item?.image_path || ""),
    text: extractV1Text(item),
  };
}

function normalizeV2Block(item, pageIndex, index) {
  const imagePath = normalizeStoredArtifactPath(item?.content?.image_source?.path || item?.img_path || item?.image_path || "");
  const text = stripInlineFormatting(collectText(item?.content));
  return {
    id: `P${pageIndex + 1}-B${String(index + 1).padStart(4, "0")}`,
    imageIndex: null,
    type: String(item?.type || "paragraph"),
    pageIndex,
    bbox: normalizeBbox(item?.bbox),
    level: Math.max(0, Number(item?.content?.level) || 0),
    anchor: String(item?.anchor || ""),
    imagePath,
    text: text || (imagePath ? `图片资产（第${pageIndex + 1}页，待生成语义说明）` : ""),
  };
}

async function readArtifactDirectory(rootDir) {
  const artifacts = new Map();
  async function visit(currentDir, prefix = "") {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else if (entry.isFile() && entry.name !== "image-analysis.json") artifacts.set(relativePath, await readFile(absolutePath));
    }
  }
  await visit(rootDir);
  return artifacts;
}

async function readStoredImageRecords(artifactsDir) {
  try {
    const value = JSON.parse(await readFile(path.join(artifactsDir, "image-analysis.json"), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeStoredArtifactPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function extractV1Text(item = {}) {
  if (item.type === "table") {
    const tableText = stripMinerUTableHtml(item.table_body || item.html || "");
    if (tableText) return tableText;
  }
  if (item.type === "image" || item.img_path || item.image_path) {
    const caption = [...(item.image_caption || []), ...(item.image_footnote || [])].join("\n").trim();
    if (caption) return caption;
    if (item.img_path || item.image_path) {
      const page = Math.max(1, Number(item.page_idx) + 1 || 1);
      return `图片资产（第${page}页，待生成语义说明）`;
    }
  }
  return stripInlineFormatting(item.text || item.content || collectText(item));
}

function collectText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content.trim();
  if (typeof value.html === "string") return stripMinerUTableHtml(value.html);
  return Object.entries(value)
    .filter(([key]) => !new Set(["type", "level", "path", "url", "image_source", "bbox"]).has(key))
    .map(([, item]) => collectText(item))
    .filter(Boolean)
    .join("\n");
}

function stripInlineFormatting(value) {
  return String(value || "")
    .replace(/<\/?(?:sub|sup|b|strong|i|em|u|s|strike|span)(?:\s[^>]*)?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
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
  retryMinerUImageCaptions,
};

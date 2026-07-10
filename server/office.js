import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const officeDocsDir = path.join(tmpdir(), "guangfa-office-documents");
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";
const localAiBaseUrl = toOnlyOfficeReachableUrl(process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8129/v1");
const localAiModel = process.env.LOCAL_LLM_MODEL || "qwen3.6-35b-a3b";
const localAiApiKey = process.env.LOCAL_LLM_API_KEY || "sk-local";
const maxOfficeDocumentBytes = 120 * 1024 * 1024;
const onlyOfficeFetchTimeoutMs = 20000;
const onlyOfficeLocalHosts = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);
const onlyOfficeCallbackStatuses = new Set([1, 2, 3, 4, 6, 7]);

async function getOfficeHealth() {
  const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
  return {
    serverUrl: onlyOfficeServerUrl,
    publicBaseUrl,
    available: await isOnlyOfficeAvailable(),
  };
}

async function createOfficeDocument(request, query) {
  const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
  await mkdir(officeDocsDir, { recursive: true });
  const id = randomUUID();
  const title = sanitizeFileName(query.get("title") || "document.docx");
  const previewId = query.get("previewId") || "";
  const filePath = getOfficeDocPath(id);
  await writeRequestBody(request, filePath);
  const [fileStat, fileBuffer] = await Promise.all([stat(filePath), readFile(filePath)]);
  const sha = createHash("sha256").update(fileBuffer).digest("hex").slice(0, 12);
  console.log(`[office-doc] post id=${id} previewId=${previewId || "-"} title=${title} bytes=${fileStat.size} sha=${sha}`);
  return {
    id,
    config: buildOnlyOfficeConfig({ id, title, fileStat, previewId, sha }),
    serverUrl: onlyOfficeServerUrl,
    available: await isOnlyOfficeAvailable(),
  };
}

async function downloadOfficeUrl(body) {
  const buffer = await fetchOnlyOfficeDocument(body?.url);
  return {
    kind: "buffer",
    buffer,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    headers: { "Cache-Control": "no-store" },
  };
}

async function readOfficeDocumentFile(id) {
  return {
    kind: "buffer",
    buffer: await readFile(getOfficeDocPath(id)),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    headers: { "Cache-Control": "no-store" },
  };
}

async function handleOfficeCallback(id, body) {
  assertOfficeDocumentId(id);
  const status = body?.status;
  if (!Number.isInteger(status) || !onlyOfficeCallbackStatuses.has(status)) {
    throw createHttpError("OnlyOffice callback status 无效", 400);
  }
  if (status === 2 || status === 6) {
    if (!body?.url) throw createHttpError("OnlyOffice callback 缺少文档地址", 400);
    const buffer = await fetchOnlyOfficeDocument(body.url);
    await writeFile(getOfficeDocPath(id), buffer);
    const sha = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    console.log(`[office-doc] callback id=${id} status=${status} bytes=${buffer.byteLength} sha=${sha}`);
  }
  return { error: 0 };
}

function buildOnlyOfficeConfig({ id, title, fileStat, previewId, sha }) {
  const fileUrl = `${publicBaseUrl}/api/office/documents/${id}/file?v=${id}`;
  return {
    documentType: "word",
    type: "desktop",
    document: {
      fileType: "docx",
      key: `${id}-${Math.round(fileStat.mtimeMs)}-${previewId || sha || "doc"}`,
      title,
      url: fileUrl,
      permissions: {
        edit: true,
        review: true,
        download: true,
        print: true,
      },
    },
    editorConfig: {
      mode: "edit",
      lang: "zh-CN",
      callbackUrl: `${publicBaseUrl}/api/office/callback/${id}`,
      aiPluginSettings: JSON.stringify(buildOnlyOfficeAiPluginSettings()),
      customization: {
        about: false,
        logo: { visible: false },
        customer: { name: "" },
        compactHeader: false,
        compactToolbar: false,
        toolbar: true,
        leftMenu: true,
        rightMenu: true,
        statusBar: true,
        layout: {
          toolbar: true,
          leftMenu: true,
          rightMenu: true,
          statusBar: true,
        },
        hideRightMenu: false,
        loaderName: "",
        loaderLogo: "",
        autosave: false,
      },
    },
  };
}

function buildOnlyOfficeAiPluginSettings() {
  const providerUrl = localAiBaseUrl.replace(/\/v1\/?$/i, "");
  return {
    version: 4,
    providers: {
      OpenAI: {
        name: "OpenAI",
        url: providerUrl,
        key: localAiApiKey,
        models: [
          {
            id: localAiModel,
            name: localAiModel,
            endpoints: [1],
            options: { max_input_tokens: 128000 },
          },
        ],
      },
    },
    models: [
      {
        name: `Local Qwen [${localAiModel}]`,
        id: localAiModel,
        provider: "OpenAI",
        capabilities: 1,
      },
    ],
    actions: {
      Chat: { model: localAiModel },
      Summarization: { model: localAiModel },
      Translation: { model: localAiModel },
      TextAnalyze: { model: localAiModel },
    },
    customProviders: {},
  };
}

function toOnlyOfficeReachableUrl(url) {
  return String(url || "").replace(/^http:\/\/(?:127\.0\.0\.1|localhost)(:\d+)/i, "http://host.docker.internal$1");
}

async function isOnlyOfficeAvailable() {
  try {
    const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
    const response = await fetch(`${onlyOfficeServerUrl.replace(/\/$/, "")}/healthcheck`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

function getOnlyOfficeServerUrl() {
  return process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";
}

function getOfficeDocPath(id) {
  assertOfficeDocumentId(id);
  return path.join(officeDocsDir, `${id}.docx`);
}

function assertOfficeDocumentId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""))) {
    throw createHttpError("Office 文档 ID 无效", 400);
  }
}

async function fetchOnlyOfficeDocument(value) {
  const target = validateOnlyOfficeDocumentUrl(value);
  try {
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(onlyOfficeFetchTimeoutMs),
    });
    if (!response.ok) {
      throw createHttpError(`OnlyOffice 文档下载失败：HTTP ${response.status}`, 502);
    }
    const buffer = await readLimitedResponseBody(response, maxOfficeDocumentBytes);
    if (!buffer.length) throw createHttpError("OnlyOffice 返回了空文档", 502);
    return buffer;
  } catch (error) {
    if (error?.statusCode) throw error;
    const suffix = ["AbortError", "TimeoutError"].includes(error?.name) ? "请求超时" : "连接失败";
    throw createHttpError(`OnlyOffice 文档下载${suffix}`, 502);
  }
}

function validateOnlyOfficeDocumentUrl(value) {
  const target = parseHttpUrl(value, "OnlyOffice 文档地址无效", 400);
  const configured = parseHttpUrl(getOnlyOfficeServerUrl(), "OnlyOffice 服务地址配置无效", 500);
  if (!onlyOfficeLocalHosts.has(normalizeHostname(configured.hostname))) {
    throw createHttpError("OnlyOffice 服务地址必须使用本地地址", 500);
  }
  if (
    !onlyOfficeLocalHosts.has(normalizeHostname(target.hostname))
    || target.protocol !== configured.protocol
    || getEffectivePort(target) !== getEffectivePort(configured)
    || target.hash
  ) {
    throw createHttpError("不允许下载该地址", 400);
  }
  return target;
}

function parseHttpUrl(value, message, statusCode) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url;
  } catch {
    throw createHttpError(message, statusCode);
  }
}

function normalizeHostname(value) {
  return String(value || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function getEffectivePort(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

async function readLimitedResponseBody(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpError("OnlyOffice 返回的文档过大", 502);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw createHttpError("OnlyOffice 返回的文档过大", 502);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeFileName(value) {
  const safe = String(value || "document.docx").replace(/[\\/:*?"<>|]/g, "_").trim();
  return /\.docx$/i.test(safe) ? safe : `${safe || "document"}.docx`;
}

function writeRequestBody(request, filePath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const stream = createWriteStream(filePath);
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxOfficeDocumentBytes) {
        const error = new Error("DOCX 文件过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    request.on("error", reject);
  });
}

export {
  assertOfficeDocumentId,
  createOfficeDocument,
  downloadOfficeUrl,
  getOfficeHealth,
  handleOfficeCallback,
  readOfficeDocumentFile,
  validateOnlyOfficeDocumentUrl,
};

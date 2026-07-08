import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const officeDocsDir = path.join(tmpdir(), "guangfa-office-documents");
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";
const onlyOfficeServerUrl = process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";
const localAiBaseUrl = toOnlyOfficeReachableUrl(process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8129/v1");
const localAiModel = process.env.LOCAL_LLM_MODEL || "qwen3.6-35b-a3b";
const localAiApiKey = process.env.LOCAL_LLM_API_KEY || "sk-local";

async function getOfficeHealth() {
  return {
    serverUrl: onlyOfficeServerUrl,
    publicBaseUrl,
    available: await isOnlyOfficeAvailable(),
  };
}

async function createOfficeDocument(request, query) {
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
  const downloadUrl = String(body?.url || "");
  const target = new URL(downloadUrl);
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(target.hostname)) {
    const error = new Error("不允许下载该地址");
    error.statusCode = 400;
    throw error;
  }
  const result = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
  if (!result.ok) {
    const error = new Error("zl办公 导出文件下载失败");
    error.statusCode = 502;
    throw error;
  }
  return {
    kind: "buffer",
    buffer: Buffer.from(await result.arrayBuffer()),
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
  if ((body.status === 2 || body.status === 6) && body.url) {
    const updated = await fetch(body.url).then((result) => result.arrayBuffer());
    const buffer = Buffer.from(updated);
    await writeFile(getOfficeDocPath(id), buffer);
    const sha = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    console.log(`[office-doc] callback id=${id} status=${body.status} bytes=${buffer.byteLength} sha=${sha}`);
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
    const response = await fetch(`${onlyOfficeServerUrl.replace(/\/$/, "")}/healthcheck`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

function getOfficeDocPath(id) {
  return path.join(officeDocsDir, `${id}.docx`);
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
      if (size > 120 * 1024 * 1024) {
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
  createOfficeDocument,
  downloadOfficeUrl,
  getOfficeHealth,
  handleOfficeCallback,
  readOfficeDocumentFile,
};

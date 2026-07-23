import path from "node:path";
import JSZip from "jszip";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_DOCX_LIMITS = Object.freeze({
  maxArchiveBytes: 120 * 1024 * 1024,
  maxEntries: 2048,
  maxEntryBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 200,
});
const maxKnowledgeDocumentBytes = 80 * 1024 * 1024;
const maxKnowledgeTextBytes = 20 * 1024 * 1024;
const knowledgeMimeTypes = new Map([
  ["docx", new Set([DOCX_MIME, "application/zip", "application/octet-stream"])],
  ["pptx", new Set([PPTX_MIME, "application/zip", "application/octet-stream"])],
  ["xlsx", new Set([XLSX_MIME, "application/zip", "application/octet-stream"])],
  ["pdf", new Set(["application/pdf", "application/octet-stream"])],
  ["txt", new Set(["text/plain", "application/octet-stream"])],
]);

async function validateKnowledgeDocument(buffer, { fileName, mimeType = "" } = {}) {
  const content = toBuffer(buffer);
  const extension = path.extname(String(fileName || "")).slice(1).toLowerCase();
  if (!knowledgeMimeTypes.has(extension)) {
    throw createDocumentError("仅支持 PDF、DOCX、PPTX、XLSX 或 TXT 资料", 415);
  }
  const maxBytes = extension === "txt" ? maxKnowledgeTextBytes : maxKnowledgeDocumentBytes;
  if (content.length > maxBytes) throw createDocumentError("资料文件过大", 413);
  const normalizedMime = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  if (normalizedMime && !knowledgeMimeTypes.get(extension).has(normalizedMime)) {
    throw createDocumentError("文件扩展名与 Content-Type 不一致", 415);
  }

  if (["docx", "pptx", "xlsx"].includes(extension)) {
    await loadSafeOfficePackage(content, extension);
  } else if (extension === "pdf") {
    if (!content.subarray(0, 8).toString("latin1").match(/^%PDF-\d\.\d/)) {
      throw createDocumentError("PDF 文件签名无效", 415);
    }
  } else {
    validateUtf8Text(content);
  }
  const mimeTypes = { docx: DOCX_MIME, pptx: PPTX_MIME, xlsx: XLSX_MIME, pdf: "application/pdf", txt: "text/plain" };
  return { extension, mimeType: mimeTypes[extension] };
}

async function loadSafeDocx(input, limits = {}) {
  return loadSafeOfficePackage(input, "docx", limits);
}

async function loadSafeOfficePackage(input, extension, limits = {}) {
  const content = toBuffer(input);
  const policy = { ...DEFAULT_DOCX_LIMITS, ...limits };
  if (!content.length) throw createDocumentError("Office 文件为空", 400);
  if (content.length > policy.maxArchiveBytes) throw createDocumentError("Office 文件过大", 413);
  if (!isZipSignature(content)) throw createDocumentError("Office ZIP 签名无效", 415);

  let zip;
  try {
    zip = await JSZip.loadAsync(content, { checkCRC32: false, createFolders: false });
  } catch {
    throw createDocumentError("Office 压缩包损坏", 415);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > policy.maxEntries) throw createDocumentError("Office 文件条目过多", 413);
  let totalUncompressed = 0;
  for (const entry of entries) {
    const size = Number(entry?._data?.uncompressedSize);
    const compressedSize = Number(entry?._data?.compressedSize);
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(compressedSize) || compressedSize < 0) {
      throw createDocumentError("Office 条目大小无效", 415);
    }
    if (size > policy.maxEntryBytes) throw createDocumentError("Office 单个条目解压后过大", 413);
    totalUncompressed += size;
    if (totalUncompressed > policy.maxUncompressedBytes) throw createDocumentError("Office 解压后内容过大", 413);
  }
  if (content.length > 0 && totalUncompressed / content.length > policy.maxCompressionRatio) {
    throw createDocumentError("Office 压缩比异常", 413);
  }

  const packageTypes = {
    docx: ["word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
    pptx: ["ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    xlsx: ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
  };
  const packageType = packageTypes[extension];
  if (!packageType) throw createDocumentError("Office 文件类型不受支持", 415);
  const requiredEntries = ["[Content_Types].xml", "_rels/.rels", packageType[0]];
  if (requiredEntries.some((name) => !zip.file(name))) throw createDocumentError("Office 包结构不完整", 415);
  if (zip.file("word/vbaProject.bin") || entries.some((entry) => /(^|\/)vbaProject\.bin$/i.test(entry.name))) {
    throw createDocumentError("不允许上传包含宏的 Office 文件", 415);
  }
  const contentTypes = await readSafeZipEntry(zip, "[Content_Types].xml", 1024 * 1024);
  if (!contentTypes.toString("utf8").includes(packageType[1])) {
    throw createDocumentError("Office 主文档类型无效", 415);
  }
  return zip;
}

async function readSafeZipEntry(zip, name, maxBytes = DEFAULT_DOCX_LIMITS.maxEntryBytes) {
  const entry = zip?.file(String(name || ""));
  if (!entry || entry.dir) return null;
  const declaredSize = Number(entry?._data?.uncompressedSize);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxBytes) {
    throw createDocumentError("DOCX 条目大小超限", 413);
  }
  const content = await readBoundedZipStream(entry, maxBytes);
  if (content.length !== declaredSize || content.length > maxBytes) {
    throw createDocumentError("DOCX 条目解压结果无效", 415);
  }
  return content;
}

function readBoundedZipStream(entry, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const stream = entry.nodeStream("nodebuffer");
    const timer = setTimeout(() => fail(createDocumentError("DOCX 条目解压超时", 408)), 15000);
    timer.unref?.();

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.destroy();
      reject(error);
    }
    stream.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        fail(createDocumentError("DOCX 条目解压后过大", 413));
        return;
      }
      chunks.push(buffer);
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks, size));
    });
  });
}

function inspectRasterImage(buffer, fileName = "") {
  const content = toBuffer(buffer);
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const prefix = content.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (extension === ".svg" || extension === ".svgz" || prefix.startsWith("<svg") || prefix.startsWith("<?xml") && prefix.includes("<svg")) {
    throw createDocumentError("不允许以内联方式提供 SVG 图片", 415);
  }
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (content.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw createDocumentError("图片格式无效或不支持安全预览", 415);
}

function validateUtf8Text(content) {
  if (content.includes(0)) throw createDocumentError("TXT 文件包含二进制内容", 415);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw createDocumentError("TXT 文件不是有效 UTF-8 文本", 415);
  }
}

function isZipSignature(content) {
  return content.length >= 4
    && content[0] === 0x50
    && content[1] === 0x4b
    && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([left, right]) => content[2] === left && content[3] === right);
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || []);
}

function createDocumentError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export {
  DEFAULT_DOCX_LIMITS,
  DOCX_MIME,
  PPTX_MIME,
  XLSX_MIME,
  inspectRasterImage,
  loadSafeDocx,
  readSafeZipEntry,
  validateKnowledgeDocument,
};

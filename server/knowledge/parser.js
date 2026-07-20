import { readFile, writeFile } from "node:fs/promises";
import { loadSafeDocx, readSafeZipEntry } from "../document-security.js";
import { convertDocxToPdf } from "./docx-convert.js";
import { extractPdfPages } from "./pdf-text.js";

const parseTimeoutMs = clampNumber(Number(process.env.KNOWLEDGE_PARSE_TIMEOUT_MS || 60000), 5000, 120000);

async function parseKnowledgeDocument({ documentId, sourcePath, pdfPath, textPath, fileExt, fileName }) {
  const ext = String(fileExt || "").toLowerCase();
  if (ext === "docx") {
    return withTimeout(
      parseDocxDocument({ documentId, sourcePath, pdfPath, textPath, fileName }),
      parseTimeoutMs,
      "DOCX 解析超时",
    );
  }
  if (ext === "pdf") {
    return withTimeout(parsePdfDocument({ sourcePath, textPath }), parseTimeoutMs, "PDF 解析超时");
  }
  if (ext !== "txt") {
    const error = new Error("不支持的资料类型");
    error.statusCode = 415;
    throw error;
  }
  const text = await readFile(sourcePath, "utf8");
  const pages = [{ page: 1, text: normalizeDocumentText(text) }].filter((page) => page.text);
  await writeFile(textPath, pages.map((page) => page.text).join("\n\n"), "utf8");
  return { pages, parser: "plain-text", warning: "" };
}

async function parsePdfDocument({ sourcePath, textPath }) {
  const pages = await extractPdfPages(sourcePath, { deadlineAt: Date.now() + parseTimeoutMs });
  await writeFile(textPath, pages.map((page) => `第${page.page}页\n${page.text}`).join("\n\n"), "utf8");
  return { pages, parser: "pdfjs", warning: "" };
}

async function parseDocxDocument({ documentId, sourcePath, pdfPath, textPath, fileName }) {
  let conversionWarning = "";
  try {
    await convertDocxToPdf({ documentId, sourcePath, outputPath: pdfPath, title: fileName });
    const pages = await extractPdfPages(pdfPath);
    if (pages.length > 0) {
      await writeFile(textPath, pages.map((page) => `第${page.page}页\n${page.text}`).join("\n\n"), "utf8");
      return { pages, parser: "onlyoffice-pdf", warning: "" };
    }
    conversionWarning = "OnlyOffice 已转 PDF，但未抽取到页文本。";
  } catch (error) {
    conversionWarning = error?.message || "OnlyOffice 转 PDF 失败。";
  }

  const fallbackText = await readDocxCleanText(sourcePath);
  const pages = [{ page: 1, text: fallbackText }].filter((page) => page.text);
  await writeFile(textPath, pages.map((page) => page.text).join("\n\n"), "utf8");
  return { pages, parser: "docx-xml-fallback", warning: conversionWarning };
}

async function readDocxCleanText(sourcePath) {
  const zip = await loadSafeDocx(await readFile(sourcePath));
  const documentXml = await readSafeZipEntry(zip, "word/document.xml", 32 * 1024 * 1024);
  if (!documentXml) return "";
  return documentXml.toString("utf8")
    .split(/<\/w:p>/)
    .map(cleanDocxParagraphXml)
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.statusCode = 408;
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cleanDocxParagraphXml(paragraphXml) {
  if (!paragraphXml) return "";
  if (/<w:pStyle\b[^>]*w:val="(?:TOC\d*|toc\d*|目录[^"]*)"/i.test(paragraphXml)) return "";
  const withoutFieldCodes = paragraphXml
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:fldSimple\b[\s\S]*?<\/w:fldSimple>/g, "")
    .replace(/<w:hyperlink\b[^>]*>\s*<\/w:hyperlink>/g, "");
  const pieces = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:cr\s*\/>/g;
  let match = null;
  while ((match = tokenPattern.exec(withoutFieldCodes))) {
    if (match[1] != null) pieces.push(decodeXmlText(match[1]));
    else if (/w:tab/.test(match[0])) pieces.push(" ");
    else pieces.push("\n");
  }
  const text = pieces.join("");
  if (/\b(?:PAGEREF|HYPERLINK|TOC|MERGEFORMAT)\b/i.test(text)) return "";
  return normalizeDocumentText(text);
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeDocumentText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export { normalizeDocumentText, parseKnowledgeDocument, readDocxCleanText };

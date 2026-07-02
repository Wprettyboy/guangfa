import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import JSZip from "jszip";

const sofficePath = process.env.LIBREOFFICE_PATH || "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
const previewCacheDir = path.join(tmpdir(), "guangfa-docx-preview-cache");
const previewCacheVersion = "lo-compat-clean-v1";
const wordCompatTagsToRemove = [
  "w:useFELayout",
  "w:balanceSingleByteDoubleByteWidth",
  "w:spaceForUL",
  "w:ulTrailSpace",
  "w:doNotExpandShiftReturn",
  "w:adjustLineHeightInTable",
  "w:doNotUseIndentAsNumberingTabStop",
  "w:noPunctuationKerning",
  "w:drawingGridHorizontalSpacing",
  "w:drawingGridVerticalSpacing",
  "w:displayHorizontalDrawingGridEvery",
  "w:displayVerticalDrawingGridEvery",
  "w:characterSpacingControl",
];

export function docxPreviewMiddleware() {
  return async function handleDocxPreview(request, response, next) {
    if (request.url !== "/api/docx/preview-pdf") {
      next();
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "DOCX 预览接口不支持该方法" });
      return;
    }

    const workDir = path.join(tmpdir(), `guangfa-docx-preview-${randomUUID()}`);
    try {
      await mkdir(workDir, { recursive: true });
      await mkdir(previewCacheDir, { recursive: true });
      const inputPath = path.join(workDir, "input.docx");
      const outputPath = path.join(workDir, "input.pdf");
      const hash = await writeRequestBody(request, inputPath);
      const cachedPdfPath = path.join(previewCacheDir, `${hash}.${previewCacheVersion}.pdf`);
      const cachedPdf = await readFile(cachedPdfPath).catch(() => null);
      if (cachedPdf) {
        sendPdf(response, cachedPdf, "HIT");
        return;
      }
      await prepareDocxForLibreOfficePreview(inputPath);
      await convertDocxToPdf(inputPath, workDir);
      const pdf = await readFile(outputPath);
      await writeFile(cachedPdfPath, pdf).catch(() => {});
      sendPdf(response, pdf, "MISS");
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "DOCX 转 PDF 失败" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

async function prepareDocxForLibreOfficePreview(inputPath) {
  const buffer = await readFile(inputPath);
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  const xmlFileNames = Object.keys(zip.files).filter((name) => /^word\/.*\.xml$/i.test(name));

  for (const fileName of xmlFileNames) {
    const file = zip.file(fileName);
    if (!file) continue;
    const xml = await file.async("string");
    const cleanedXml = cleanLibreOfficePreviewXml(xml);
    if (cleanedXml !== xml) {
      zip.file(fileName, cleanedXml);
      changed = true;
    }
  }

  if (!changed) return;
  const cleanedBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(inputPath, cleanedBuffer);
}

function cleanLibreOfficePreviewXml(xml) {
  let cleaned = xml;
  for (const tagName of wordCompatTagsToRemove) {
    const escapedTagName = tagName.replace(":", "\\:");
    cleaned = cleaned.replace(new RegExp(`<${escapedTagName}(?:\\s+[^>]*)?\\/>`, "g"), "");
  }
  cleaned = cleaned.replace(/<w\:docGrid(?:\s+[^>]*)?\/>/g, "");
  return cleaned;
}

function convertDocxToPdf(inputPath, outDir) {
  const profileDir = path.join(outDir, "lo-profile");
  const args = [
    "--headless",
    "--nologo",
    "--norestore",
    "--nodefault",
    "--nolockcheck",
    "--nofirststartwizard",
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    inputPath,
  ];

  return new Promise((resolve, reject) => {
    execFile(sofficePath, args, { timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      reject(new Error(`LibreOffice 转换失败：${stderr || stdout || error.message}`));
    });
  });
}

function writeRequestBody(request, filePath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const hash = createHash("sha256");
    const stream = createWriteStream(filePath);
    request.on("data", (chunk) => {
      size += chunk.length;
      hash.update(chunk);
      if (size > 120 * 1024 * 1024) {
        const error = new Error("DOCX 文件过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.pipe(stream);
    stream.on("finish", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
    request.on("error", reject);
  });
}

function sendPdf(response, pdf, cacheState) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Preview-Cache", cacheState);
  response.end(pdf);
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

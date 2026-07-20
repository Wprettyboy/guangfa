import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCapabilityResource, capabilityScopes, signCapabilityUrl } from "../api/capability.js";
import { signOnlyOfficeJwt } from "../office.js";

const onlyOfficeServerUrl = process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";

async function convertDocxToPdf({ documentId, sourcePath, outputPath, title }) {
  const filePath = `/api/v1/knowledge-documents/${encodeURIComponent(documentId)}/file`;
  const url = signCapabilityUrl(`${publicBaseUrl.replace(/\/$/, "")}${filePath}`, {
    scope: capabilityScopes.knowledgeDocumentFile,
    resource: buildCapabilityResource("knowledge-document", documentId, "file"),
  });
  const body = {
    async: false,
    filetype: "docx",
    key: `${documentId}-${Date.now()}`,
    outputtype: "pdf",
    title: title || path.basename(sourcePath),
    url,
  };
  const response = await fetch(`${onlyOfficeServerUrl}/ConvertService.ashx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token: signOnlyOfficeJwt(body, 300) }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`OnlyOffice 转换请求失败：${response.status}`);
  const raw = await response.text();
  const result = parseConversionResponse(raw);
  if (result.error) throw new Error(`OnlyOffice 转换失败：${result.error}`);
  if (!result.fileUrl) throw new Error("OnlyOffice 未返回 PDF 下载地址");
  const fileResponse = await fetch(result.fileUrl, { signal: AbortSignal.timeout(12000) });
  if (!fileResponse.ok) throw new Error(`OnlyOffice PDF 下载失败：${fileResponse.status}`);
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  await writeFile(outputPath, buffer);
  return {
    ok: true,
    pdfPath: outputPath,
    bytes: buffer.byteLength,
  };
}

function parseConversionResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const fileUrl = readXmlTag(raw, "FileUrl");
    if (!fileUrl) throw new Error("OnlyOffice 转 PDF 未返回下载地址，已使用 DOCX 文本解析兜底。");
    return {
      fileUrl,
      fileType: readXmlTag(raw, "FileType"),
      percent: Number(readXmlTag(raw, "Percent") || 0),
      endConvert: /^true$/i.test(readXmlTag(raw, "EndConvert")),
      error: readXmlTag(raw, "Error"),
    };
  }
}

function readXmlTag(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? decodeXmlText(match[1]).trim() : "";
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export { convertDocxToPdf };

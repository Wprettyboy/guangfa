import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { getKnowledgeDatabase } from "./db.js";

const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";

async function searchKnowledgeImages(payload = {}) {
  const kbIds = normalizeIds([...(payload.kbIds || []), ...(payload.globalKbIds || [])]);
  if (kbIds.length === 0) return [];
  const database = await getKnowledgeDatabase();
  const placeholders = kbIds.map(() => "?").join(",");
  const documents = database.prepare(`
    SELECT d.id, d.kb_id AS kbId, d.name, d.file_name AS fileName, d.file_ext AS fileExt,
      d.file_path AS filePath, b.name AS knowledgeBaseName, b.scope
    FROM knowledge_documents d
    JOIN knowledge_bases b ON b.id = d.kb_id
    WHERE d.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND d.kb_id IN (${placeholders})
      AND LOWER(COALESCE(d.file_ext, '')) = 'docx'
    ORDER BY d.created_at DESC
  `).all(...kbIds);
  const groups = await Promise.all(documents.map((document) => extractDocxImages(database, document)));
  return filterKnowledgeImages(groups.flat(), payload.query).slice(0, 120);
}

async function listKnowledgeDocumentImages(documentId) {
  const database = await getKnowledgeDatabase();
  const row = database.prepare(`
    SELECT d.id, d.kb_id AS kbId, d.name, d.file_name AS fileName, d.file_ext AS fileExt,
      d.file_path AS filePath, b.name AS knowledgeBaseName, b.scope
    FROM knowledge_documents d
    JOIN knowledge_bases b ON b.id = d.kb_id
    WHERE d.id = ? AND d.deleted_at IS NULL AND b.deleted_at IS NULL
  `).get(documentId);
  return row ? extractDocxImages(database, row) : [];
}

async function extractDocxImages(database, document) {
  if (!document?.filePath || !existsSync(document.filePath)) return [];
  const zip = await JSZip.loadAsync(await readFile(document.filePath));
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return [];
  const rels = readDocumentRelationships(await zip.file("word/_rels/document.xml.rels")?.async("text"));
  const paragraphs = readParagraphs(documentXml);
  const pages = readDocumentPages(database, document.id);
  const images = [];
  let lastText = "";
  paragraphs.forEach((paragraph) => {
    const text = extractText(paragraph.xml);
    if (!paragraphHasImage(paragraph.xml)) {
      if (text) lastText = text;
      return;
    }
    const imageRels = readImageRelationships(paragraph.xml, rels);
    if (imageRels.length === 0) return;
    const imageIndex = images.length + 1;
    const title = lastText || text || `图片 ${imageIndex}`;
    const extent = readImageExtentEmu(paragraph.xml);
    images.push({
      id: `${document.id}-I${imageIndex}`,
      documentId: document.id,
      documentName: document.name || document.fileName || "未命名资料",
      fileName: document.fileName || document.name || "未命名资料",
      knowledgeBaseId: document.kbId,
      knowledgeBaseName: document.knowledgeBaseName || "",
      imageIndex,
      title,
      page: resolveImagePage(pages, title || text),
      imageCount: imageRels.length,
      previewUrl: `/api/knowledge-images/${encodeURIComponent(document.id)}/${imageIndex}/file`,
      imageUrl: `${publicBaseUrl}/api/knowledge-images/${encodeURIComponent(document.id)}/${imageIndex}/file`,
      sourceDocxUrl: `${publicBaseUrl}/api/knowledge-images/${encodeURIComponent(document.id)}/${imageIndex}/docx`,
      widthEmu: extent.widthEmu,
      heightEmu: extent.heightEmu,
      plainText: normalizeText([title, text, imageRels.map((item) => item.target).join(" ")].filter(Boolean).join("\n")),
    });
    if (text) lastText = text;
  });
  return images;
}

async function readKnowledgeImageDocx(documentId, imageIndex) {
  const database = await getKnowledgeDatabase();
  const row = getKnowledgeDocumentRow(database, documentId);
  if (!row?.filePath || !existsSync(row.filePath)) return null;
  const zip = await JSZip.loadAsync(await readFile(row.filePath));
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return null;
  const rels = readDocumentRelationships(await zip.file("word/_rels/document.xml.rels")?.async("text"));
  const imageParagraphs = readParagraphs(documentXml).filter((paragraph) => readImageRelationships(paragraph.xml, rels).length > 0);
  const index = Math.max(1, Number(imageIndex) || 1);
  const paragraph = imageParagraphs[index - 1];
  if (!paragraph) return null;
  zip.file("word/document.xml", buildSingleImageDocumentXml(documentXml, paragraph.xml));
  return {
    fileName: `${sanitizeFileStem(row.fileName || row.name || "image")}-图片${index}.docx`,
    buffer: Buffer.from(await zip.generateAsync({ type: "nodebuffer" })),
  };
}

async function readKnowledgeImageFile(documentId, imageIndex) {
  const database = await getKnowledgeDatabase();
  const row = getKnowledgeDocumentRow(database, documentId);
  if (!row?.filePath || !existsSync(row.filePath)) return null;
  const zip = await JSZip.loadAsync(await readFile(row.filePath));
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return null;
  const rels = readDocumentRelationships(await zip.file("word/_rels/document.xml.rels")?.async("text"));
  const imageParagraphs = readParagraphs(documentXml).filter((paragraph) => readImageRelationships(paragraph.xml, rels).length > 0);
  const index = Math.max(1, Number(imageIndex) || 1);
  const paragraph = imageParagraphs[index - 1];
  if (!paragraph) return null;
  const image = readImageRelationships(paragraph.xml, rels)[0];
  if (!image) return null;
  const file = zip.file(image.path);
  if (!file) return null;
  return {
    fileName: path.basename(image.path),
    contentType: getImageContentType(image.path),
    buffer: Buffer.from(await file.async("nodebuffer")),
  };
}

function getKnowledgeDocumentRow(database, documentId) {
  return database.prepare(`
    SELECT id, kb_id AS kbId, name, file_name AS fileName, file_ext AS fileExt,
      file_path AS filePath
    FROM knowledge_documents
    WHERE id = ? AND deleted_at IS NULL
  `).get(documentId);
}

function readParagraphs(xml) {
  const body = xml.match(/<w:body\b[\s\S]*<\/w:body>/)?.[0] || xml;
  return [...body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({ xml: match[0] }));
}

function paragraphHasImage(paragraphXml) {
  return /<(?:w:drawing|w:pict)\b/.test(paragraphXml);
}

function readDocumentRelationships(relsXml = "") {
  const rels = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const xml = match[0];
    const id = readXmlAttribute(xml, "Id");
    const type = readXmlAttribute(xml, "Type");
    const target = readXmlAttribute(xml, "Target");
    if (!id || !target) continue;
    rels.set(id, { id, type, target, path: resolveWordTargetPath(target) });
  }
  return rels;
}

function readImageRelationships(paragraphXml, rels) {
  const ids = new Set();
  for (const match of paragraphXml.matchAll(/\br:(?:embed|id|link)="([^"]+)"/g)) {
    ids.add(match[1]);
  }
  return [...ids]
    .map((id) => rels.get(id))
    .filter((rel) => rel && (/\/image$/i.test(rel.type || "") || /^word\/media\//i.test(rel.path || "")));
}

function readImageExtentEmu(paragraphXml) {
  const wpExtent = paragraphXml.match(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  const aExtent = paragraphXml.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  const match = wpExtent || aExtent;
  const widthEmu = Number(match?.[1]);
  const heightEmu = Number(match?.[2]);
  return {
    widthEmu: Number.isFinite(widthEmu) && widthEmu > 0 ? widthEmu : 0,
    heightEmu: Number.isFinite(heightEmu) && heightEmu > 0 ? heightEmu : 0,
  };
}

function resolveWordTargetPath(target) {
  const value = String(target || "").replace(/\\/g, "/");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value.replace(/^\/+/, "");
  const normalized = path.posix.normalize(`word/${value}`);
  return normalized.replace(/^(\.\.\/)+/, "");
}

function readXmlAttribute(xml, name) {
  return xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || "";
}

function buildSingleImageDocumentXml(documentXml, paragraphXml) {
  const sectPr = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || "";
  return documentXml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, `<w:body>${paragraphXml}<w:p/>${sectPr}</w:body>`);
}

function readDocumentPages(database, documentId) {
  return database.prepare(`
    SELECT page_number AS page, text
    FROM knowledge_document_pages
    WHERE document_id = ?
    ORDER BY page_number
  `).all(documentId);
}

function resolveImagePage(pages, title) {
  const keyword = compactText(title);
  if (!keyword || keyword.length < 4) return 0;
  const page = pages.find((item) => compactText(item.text).includes(keyword.slice(0, Math.min(80, keyword.length))));
  return page ? Number(page.page) || 0 : 0;
}

function filterKnowledgeImages(images, query) {
  const keyword = compactText(query);
  if (!keyword) return images;
  return images.filter((image) => compactText(`${image.title}\n${image.documentName}\n${image.plainText}`).includes(keyword));
}

function sanitizeFileStem(value) {
  return String(value || "image").replace(/\.(docx|doc)$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "image";
}

function getImageContentType(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

function extractText(xml) {
  const pieces = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:cr\s*\/>/g;
  let match = null;
  while ((match = tokenPattern.exec(xml))) {
    if (match[1] != null) pieces.push(decodeXmlText(match[1]));
    else if (/w:tab/.test(match[0])) pieces.push(" ");
    else pieces.push("\n");
  }
  return normalizeText(pieces.join(""));
}

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export {
  listKnowledgeDocumentImages,
  readKnowledgeImageDocx,
  readKnowledgeImageFile,
  searchKnowledgeImages,
};

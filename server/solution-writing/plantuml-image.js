import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import JSZip from "jszip";
import { getAiRuntimeConfig } from "../ai/config.js";
import { callJsonModel } from "../ai/model.js";

const imageDir = path.resolve(process.cwd(), "data", "solution-plantuml-images");
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";
const plantumlBaseUrl = process.env.PLANTUML_SERVER_URL || "http://127.0.0.1:8090";
const plantumlAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

async function generateSolutionPlantumlImage(payload = {}) {
  const runtime = getAiRuntimeConfig();
  const prompt = cleanText(payload.prompt).slice(0, 2000);
  const selectedTitle = cleanText(payload.selectedTitle || "当前章节").slice(0, 200);
  const selectedBodyText = cleanMultilineText(payload.selectedBodyText).slice(0, 12000);
  const outlineText = cleanMultilineText(payload.outlineText || buildOutlineText(payload.outlineItems)).slice(0, 24000);
  if (!prompt) {
    const error = new Error("请输入生图要求。");
    error.statusCode = 400;
    throw error;
  }
  if (!selectedTitle) {
    const error = new Error("请选择当前文档标题。");
    error.statusCode = 400;
    throw error;
  }

  const errors = [];
  let lastParsed = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const parsed = await callJsonModel(
      runtime,
      buildPlantumlSystemPrompt(),
      buildPlantumlUserPrompt({
        prompt,
        selectedTitle,
        selectedBodyText,
        outlineText,
        errors,
      }),
      4096,
      {
        debugFileName: `solution-plantuml-image-attempt-${attempt}.json`,
        debugContext: {
          attempt,
          selectedTitle,
          prompt,
          previousErrors: errors,
          hasSelectedBodyText: Boolean(selectedBodyText),
          outlineChars: outlineText.length,
        },
      },
    );
    lastParsed = parsed;
    const plantuml = normalizePlantumlSource(parsed.plantuml || parsed.uml || parsed.code);
    const validation = await validatePlantuml(plantuml);
    if (!validation.ok) {
      errors.push(validation.error);
      continue;
    }
    const png = await renderPlantumlPng(plantuml);
    const image = await savePlantumlImage({
      title: cleanText(parsed.title || selectedTitle || "AI生成配图"),
      plantuml,
      png,
      selectedTitle,
      prompt,
    });
    return {
      ok: true,
      image,
      plantuml,
      repairAttempts: attempt - 1,
      warnings: normalizeStringList(parsed.warnings).slice(0, 5),
    };
  }

  const error = new Error(`PlantUML 生成失败：${errors[errors.length - 1] || "AI 未返回可渲染的 PlantUML。"}${lastParsed?.plantuml ? "" : " 未读取到 plantuml 字段。"}`);
  error.statusCode = 502;
  throw error;
}

async function readSolutionPlantumlImageFile(imageId) {
  const id = sanitizeId(imageId);
  const filePath = path.join(imageDir, `${id}.png`);
  if (!id || !existsSync(filePath)) return null;
  return {
    fileName: `${id}.png`,
    contentType: "image/png",
    buffer: await readFile(filePath),
  };
}

async function readSolutionPlantumlImageDocx(imageId) {
  const id = sanitizeId(imageId);
  const filePath = path.join(imageDir, `${id}.docx`);
  if (!id || !existsSync(filePath)) return null;
  return {
    fileName: `${id}.docx`,
    buffer: await readFile(filePath),
  };
}

function buildPlantumlSystemPrompt() {
  return [
    "你是政企方案文档的架构图设计师和 PlantUML 专家。",
    "任务：根据当前文档标题、该标题下正文、全文大纲上下文和用户生图要求，输出一张可渲染的 PlantUML 配图。",
    "当前标题下正文是最重要依据；全文大纲只用于避免遗漏上下文和命名不一致。",
    "禁止引入正文和全文上下文之外的新系统、设备、流程或承诺。",
    "统一视觉标准：必须使用黑体，默认字体大小不小于 20pt。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
}

function buildPlantumlUserPrompt({ prompt, selectedTitle, selectedBodyText, outlineText, errors }) {
  return [
    "输出 JSON：",
    '{"title":"配图标题","plantuml":"@startuml\\n...\\n@enduml","warnings":["可为空"]}',
    "",
    `【当前标题】${selectedTitle}`,
    "",
    "【当前标题下正文，优先依据】",
    selectedBodyText || "未读取到正文，请基于标题和全文大纲生成概括性配图。",
    "",
    "【全文大纲和正文摘要，辅助约束】",
    outlineText || "未读取到全文大纲。",
    "",
    `【用户生图要求】${prompt}`,
    "",
    "PlantUML 规则：",
    "1. 必须返回完整 @startuml 到 @enduml。",
    "2. 必须包含：skinparam defaultFontName 黑体。",
    "3. 必须包含：skinparam defaultFontSize 20 或更大字号。",
    "4. 优先使用 component、rectangle、database、cloud、queue、node、package、箭头和简短中文标签，避免过长句子塞进节点。",
    "5. 中文节点名用引号或 as 别名，避免 PlantUML 语法歧义。",
    "6. 图面要服务方案说明，突出层次、流程、接口或数据关系，不要画无意义装饰图。",
    "7. 不要输出 Markdown 代码块。",
    errors.length ? `\n【上次 PlantUML 报错，请修复后重新输出】\n${errors.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

async function validatePlantuml(plantuml) {
  if (!plantuml || !/@startuml/i.test(plantuml) || !/@enduml/i.test(plantuml)) {
    return { ok: false, error: "PlantUML 必须包含 @startuml 和 @enduml。" };
  }
  const encoded = encodePlantuml(plantuml);
  const response = await fetch(`${plantumlBaseUrl.replace(/\/$/, "")}/svg/${encoded}`);
  const text = await response.text();
  if (!response.ok) return { ok: false, error: `${response.status} ${text.slice(0, 1200)}` };
  if (/Syntax Error|Some diagram description contains errors|PlantUML diagram error|ERROR/i.test(text)) {
    return { ok: false, error: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200) };
  }
  return { ok: true };
}

async function renderPlantumlPng(plantuml) {
  const encoded = encodePlantuml(plantuml);
  const response = await fetch(`${plantumlBaseUrl.replace(/\/$/, "")}/png/${encoded}`);
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`PlantUML PNG 渲染失败：${response.status} ${text.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function savePlantumlImage({ title, plantuml, png, selectedTitle, prompt }) {
  await mkdir(imageDir, { recursive: true });
  const id = `SPI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeTitle = sanitizeTitle(title || selectedTitle || "AI生成配图");
  const pngPath = path.join(imageDir, `${id}.png`);
  const docxPath = path.join(imageDir, `${id}.docx`);
  const metaPath = path.join(imageDir, `${id}.json`);
  const size = getImageEmuSize(png);
  await writeFile(pngPath, png);
  await writeFile(docxPath, await buildImageDocx(png, safeTitle));
  await writeFile(metaPath, JSON.stringify({
    id,
    title: safeTitle,
    selectedTitle,
    prompt,
    plantuml,
    createdAt: new Date().toISOString(),
  }, null, 2), "utf8");
  return {
    id,
    title: safeTitle,
    documentName: "AI生成配图",
    previewUrl: `/api/solution-plantuml-images/${encodeURIComponent(id)}/file`,
    imageUrl: `${publicBaseUrl}/api/solution-plantuml-images/${encodeURIComponent(id)}/file`,
    sourceDocxUrl: `${publicBaseUrl}/api/solution-plantuml-images/${encodeURIComponent(id)}/docx`,
    widthEmu: size.widthEmu,
    heightEmu: size.heightEmu,
  };
}

async function buildImageDocx(png, title) {
  const zip = new JSZip();
  const { widthEmu, heightEmu } = getImageEmuSize(png);
  zip.file("[Content_Types].xml", buildContentTypesXml());
  zip.folder("_rels").file(".rels", buildRootRelsXml());
  zip.folder("word").file("document.xml", buildImageDocumentXml({ title, widthEmu, heightEmu }));
  zip.folder("word").folder("_rels").file("document.xml.rels", buildDocumentRelsXml());
  zip.folder("word").folder("media").file("image1.png", png);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function buildImageDocumentXml({ title, widthEmu, heightEmu }) {
  const escapedTitle = escapeXml(title || "AI生成配图");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
            <wp:docPr id="1" name="${escapedTitle}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="1" name="${escapedTitle}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function buildDocumentRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;
}

function encodePlantuml(source) {
  const deflated = zlib.deflateRawSync(Buffer.from(source, "utf8"));
  let result = "";
  for (let index = 0; index < deflated.length; index += 3) {
    result += append3Bytes(deflated[index], deflated[index + 1] || 0, deflated[index + 2] || 0);
  }
  return result;
}

function append3Bytes(b1, b2, b3) {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3F;
  return encode6Bit(c1) + encode6Bit(c2) + encode6Bit(c3) + encode6Bit(c4);
}

function encode6Bit(value) {
  return plantumlAlphabet[value & 0x3F];
}

function normalizePlantumlSource(value) {
  let text = String(value || "").replace(/```(?:plantuml|puml|uml)?/gi, "").replace(/```/g, "").trim();
  if (!text) return "";
  if (!/@startuml/i.test(text)) text = `@startuml\n${text}`;
  if (!/@enduml/i.test(text)) text = `${text}\n@enduml`;
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /@startuml/i.test(line));
  const insertAt = startIndex >= 0 ? startIndex + 1 : 1;
  if (!/skinparam\s+defaultFontName/i.test(text)) lines.splice(insertAt, 0, "skinparam defaultFontName 黑体");
  if (!/skinparam\s+defaultFontSize/i.test(lines.join("\n"))) lines.splice(insertAt + 1, 0, "skinparam defaultFontSize 20");
  return lines.join("\n");
}

function readPngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return { width: 900, height: 520 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getImageEmuSize(buffer) {
  const size = readPngSize(buffer);
  const maxWidthEmu = 6.4 * 914400;
  const widthEmuRaw = Math.max(1, size.width) * 9525;
  const heightEmuRaw = Math.max(1, size.height) * 9525;
  const scale = widthEmuRaw > maxWidthEmu ? maxWidthEmu / widthEmuRaw : 1;
  return {
    widthEmu: Math.round(widthEmuRaw * scale),
    heightEmu: Math.round(heightEmuRaw * scale),
  };
}

function buildOutlineText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const title = cleanText(item?.displayTitle || item?.title);
      const level = Math.max(0, Math.min(8, Number(item?.level) || 0));
      const bodyText = cleanMultilineText(item?.bodyText).slice(0, 4000);
      return bodyText ? `${"  ".repeat(level)}- ${title}\n${bodyText}` : `${"  ".repeat(level)}- ${title}`;
    })
    .filter(Boolean)
    .join("\n");
}

function sanitizeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function sanitizeTitle(value) {
  return cleanText(value).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "AI生成配图";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => cleanText(item)).filter(Boolean);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export {
  generateSolutionPlantumlImage,
  readSolutionPlantumlImageDocx,
  readSolutionPlantumlImageFile,
};

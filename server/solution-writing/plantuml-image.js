import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import JSZip from "jszip";
import { buildCapabilityResource, capabilityScopes, signCapabilityUrl } from "../api/capability.js";
import { getAiRuntimeConfig } from "../ai/config.js";
import { callJsonModel } from "../ai/model.js";

const imageDir = path.resolve(process.cwd(), "data", "solution-plantuml-images");
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";
const plantumlBaseUrl = process.env.PLANTUML_SERVER_URL || "http://127.0.0.1:8090";
const plantumlAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const plantumlImageTtlMs = readBoundedNumber(process.env.SOLUTION_IMAGE_TTL_MS, 24 * 60 * 60 * 1000, 15 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
const maxPlantumlImages = readBoundedNumber(process.env.SOLUTION_IMAGE_MAX_ITEMS, 200, 10, 2000);
let plantumlImageWriteQueue = Promise.resolve();

async function generateSolutionPlantumlImage(payload = {}, principal) {
  const runtime = getAiRuntimeConfig();
  const prompt = cleanMultilineText(payload.prompt).slice(0, 2000);
  const selectedTitle = cleanText(payload.selectedTitle).slice(0, 200);
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
  const diagramPolicy = resolveDiagramPolicy({ prompt, selectedTitle });

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
        diagramPolicy,
      }),
      {
        debugFileName: `solution-plantuml-image-attempt-${attempt}.json`,
        debugContext: {
          attempt,
          selectedTitle,
          prompt,
          diagramType: diagramPolicy.type,
          allowCombined: diagramPolicy.allowCombined,
          previousErrors: errors,
          hasSelectedBodyText: Boolean(selectedBodyText),
          outlineChars: outlineText.length,
        },
      },
    );
    lastParsed = parsed;
    const plantuml = normalizePlantumlSource(parsed.plantuml || parsed.uml || parsed.code, diagramPolicy);
    const validation = await validatePlantuml(plantuml, diagramPolicy);
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
      ownerId: principal?.id,
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

async function renderSolutionPlantumlSource(payload = {}, principal) {
  const plantuml = normalizeManualPlantumlSource(payload.source);
  const validation = validateManualPlantumlSource(plantuml);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }

  const syntaxValidation = await validatePlantumlSyntax(plantuml);
  if (!syntaxValidation.ok) {
    const error = new Error(`PlantUML 渲染失败：${syntaxValidation.error}`);
    error.statusCode = 400;
    throw error;
  }

  const title = cleanText(payload.title).slice(0, 80) || "PlantUML配图";
  const png = await renderPlantumlPng(plantuml);
  const image = await savePlantumlImage({
    title,
    plantuml,
    png,
    selectedTitle: "",
    prompt: "",
    documentName: "PlantUML配图",
    ownerId: principal?.id,
  });
  return { ok: true, image, plantuml };
}

async function readSolutionPlantumlImageFile(imageId, principal) {
  const id = sanitizeId(imageId);
  const filePath = path.join(imageDir, `${id}.png`);
  const metadata = id ? await readActivePlantumlImageMetadata(id) : null;
  if (!metadata || !existsSync(filePath)) return null;
  assertPlantumlImageOwner(metadata, principal);
  return {
    fileName: `${id}.png`,
    contentType: "image/png",
    buffer: await readFile(filePath),
  };
}

async function readSolutionPlantumlImageDocx(imageId, principal) {
  const id = sanitizeId(imageId);
  const filePath = path.join(imageDir, `${id}.docx`);
  const metadata = id ? await readActivePlantumlImageMetadata(id) : null;
  if (!metadata || !existsSync(filePath)) return null;
  assertPlantumlImageOwner(metadata, principal);
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
    "流程图必须使用 PlantUML 活动图语法；功能组成图必须使用 PlantUML WBS 语法。",
    "一张图始终只使用一种兼容图型；用户未明确要求组合时不得制作多面板，明确要求时也只能在主图型内用分区、分组或注释组织。",
    "统一视觉标准：必须使用 SimHei（Windows 黑体），默认字体大小不小于 20pt。",
    "输出必须是严格 JSON，不要输出 Markdown、解释或思考过程。",
  ].join("\n");
}

function buildPlantumlUserPrompt({ prompt, selectedTitle, selectedBodyText, outlineText, errors, diagramPolicy }) {
  const envelopeExample = diagramPolicy.type === "wbs"
    ? "@startwbs\\n* 根功能\\n** 子功能\\n@endwbs"
    : diagramPolicy.type === "activity"
      ? "@startuml\\nstart\\n:处理动作;\\nstop\\n@enduml"
      : "@startuml\\n...\\n@enduml";
  return [
    "输出 JSON：",
    `{"title":"配图标题","plantuml":"${envelopeExample}","warnings":["可为空"]}`,
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
    "【本次图型约束】",
    buildDiagramPolicyPrompt(diagramPolicy),
    "",
    "PlantUML 规则：",
    `1. 必须返回完整 ${diagramPolicy.startToken} 到 ${diagramPolicy.endToken}。`,
    "2. 必须包含：skinparam defaultFontName SimHei。",
    "3. 必须包含：skinparam defaultFontSize 20 或更大字号。",
    "4. 节点使用简短中文标签，避免把长段正文塞进节点。",
    "5. 图面只呈现正文和上下文已有的层次、流程、接口或数据关系，不画无意义装饰图。",
    "6. 不要输出 Markdown 代码块。",
    errors.length ? `\n【上次 PlantUML 报错，请修复后重新输出】\n${errors.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function resolveDiagramPolicy({ prompt, selectedTitle }) {
  const promptType = detectPromptDiagramType(prompt);
  const type = promptType || detectContextDiagramType(selectedTitle) || "single";
  const allowCombined = hasExplicitCombinationRequest(prompt);
  if (type === "wbs") {
    return { type, allowCombined, startToken: "@startwbs", endToken: "@endwbs" };
  }
  return { type, allowCombined, startToken: "@startuml", endToken: "@enduml" };
}

function detectPromptDiagramType(value) {
  const text = cleanText(value);
  if (!text) return "";
  const candidates = [
    { type: "wbs", match: text.match(/(?:功能|模块)(?:组成|构成|结构|分解)(?:结构)?图|\bWBS\b|工作分解结构(?:图)?/i) },
    { type: "activity", match: text.match(/(?:业务|工作|操作|审批|处理|服务|数据|实施|响应|管理)?流程图|活动图/) },
    { type: "single", match: text.match(/(?:架构|组件|部署|时序|序列|类|用例|状态|拓扑|数据流|实体关系|甘特|思维导)图/) },
  ].filter((item) => item.match);
  candidates.sort((left, right) => left.match.index - right.match.index);
  return candidates[0]?.type || "";
}

function detectContextDiagramType(value) {
  const text = cleanText(value);
  if (!text) return "";
  const explicitType = detectPromptDiagramType(text);
  if (explicitType) return explicitType;
  if (/(?:功能|模块)(?:组成|构成|结构|分解)|工作分解结构/i.test(text)) return "wbs";
  if (/(?:业务|工作|操作|审批|处理|服务|数据|实施|响应|管理)?流程|活动图/.test(text)) return "activity";
  return "";
}

function hasExplicitCombinationRequest(value) {
  const text = cleanText(value);
  if (/(?:不要|无需|禁止|避免|不允许|不需要).{0,12}(?:组合|混合)/.test(text)) return false;
  return /(?:组合|混合)(?:图|展示|呈现|绘制)|同时(?:展示|绘制|包含).*(?:两种|多种|多个).*(?:图|视图)/.test(text);
}

function buildDiagramPolicyPrompt(diagramPolicy) {
  const combinationRule = diagramPolicy.allowCombined
    ? "用户已明确要求组合展示，但仍只能输出一个完整 PlantUML 图；请在本次主图型内用分区、分组或注释组织信息，不得混用其他图型语法。"
    : "用户未明确要求组合展示，只生成一种图型，不得混入其他图型语法。";
  if (diagramPolicy.type === "wbs") {
    return [
      "功能组成图强制使用 PlantUML WBS 结构图，必须以 @startwbs 开始、@endwbs 结束。",
      "使用 * 表示根功能、** 表示二级功能、*** 表示三级功能，按正文已有功能层级逐级分解；不得改用 component、rectangle、mindmap 或活动图。",
      "语法示例：",
      "@startwbs",
      "* Business Process Modelling WBS",
      "** Launch the project",
      "*** Complete Stakeholder Research",
      "*** Initial Implementation Plan",
      "** Design phase",
      "*** Model of AsIs Processes Completed",
      "**** Model of AsIs Processes Completed1",
      "**** Model of AsIs Processes Completed2",
      "*** Measure AsIs performance metrics",
      "*** Identify Quick Wins",
      "** Complete innovate phase",
      "@endwbs",
      combinationRule,
    ].join("\n");
  }
  if (diagramPolicy.type === "activity") {
    return [
      "流程图强制使用 PlantUML 活动图：以 @startuml 开始，使用 start、:活动;、if/elseif/else、while/repeat、fork 和 stop/end 表达流程。",
      "不得用 component、rectangle、node、package、database、cloud、queue、participant 或类图节点拼装流程图。",
      combinationRule,
    ].join("\n");
  }
  return [
    "根据用户要求选择一种最合适的 PlantUML 图型，并保持单一图型语义。",
    combinationRule,
  ].join("\n");
}

function validatePlantumlPolicy(plantuml, diagramPolicy) {
  const source = String(plantuml || "");
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const starts = source.match(/@start[a-z]+\b/gi) || [];
  const ends = source.match(/@end(?:uml|wbs)\b/gi) || [];
  if (starts.length !== 1 || ends.length !== 1 || /^\s*newpage\b/im.test(source) || /^\s*!(?:include|includeurl|import)\b/im.test(source)) {
    return { ok: false, error: "PlantUML 必须且只能包含一个完整图，不能使用 newpage、外部 include/import 或多个图块。" };
  }
  if (lines[0]?.toLowerCase() !== diagramPolicy.startToken || lines.at(-1)?.toLowerCase() !== diagramPolicy.endToken) {
    return { ok: false, error: `${diagramPolicy.startToken} 和 ${diagramPolicy.endToken} 必须是源码的首行和末行。` };
  }
  if (!new RegExp(`^\\s*${diagramPolicy.startToken}\\b`, "im").test(source)
    || !new RegExp(`^\\s*${diagramPolicy.endToken}\\b`, "im").test(source)) {
    return { ok: false, error: `本次图型必须使用 ${diagramPolicy.startToken} 到 ${diagramPolicy.endToken}。` };
  }
  if (diagramPolicy.type === "wbs") {
    if (/^\s*(?:component|rectangle|node|package|database|cloud|queue|participant|actor|class|interface|usecase)\b/im.test(source)) {
      return { ok: false, error: "功能组成图只能使用 WBS 层级节点，不得混入其他图型节点。" };
    }
    const nodes = source.split(/\r?\n/).filter((line) => /^\s*\*+\s+\S/.test(line));
    const levels = nodes.map((line) => line.match(/^\s*(\*+)/)?.[1].length || 0);
    if (levels.filter((level) => level === 1).length !== 1 || !levels.some((level) => level >= 2)) {
      return { ok: false, error: "功能组成图必须包含一个 WBS 根功能和至少一个下级功能。" };
    }
    if (levels.some((level, index) => index === 0 ? level !== 1 : level > levels[index - 1] + 1)) {
      return { ok: false, error: "WBS 必须从根功能开始逐级展开，不能跳过中间层级。" };
    }
  }
  if (diagramPolicy.type === "activity") {
    if (!/^\s*start\s*$/im.test(source) || !/^\s*(?:stop|end)\s*$/im.test(source) || !/^\s*:[^;\n]+;/m.test(source)) {
      return { ok: false, error: "流程图必须使用包含 start、活动节点和 stop/end 的 PlantUML 活动图语法。" };
    }
    if (/^(?:\s*)(?:component|rectangle|node|package|database|cloud|queue|participant|actor|class|interface|usecase)\b/im.test(source)) {
      return { ok: false, error: "流程图不得混入组件图、部署图、时序图、类图或用例图节点。" };
    }
  }
  return { ok: true };
}

async function validatePlantuml(plantuml, diagramPolicy) {
  const policyValidation = validatePlantumlPolicy(plantuml, diagramPolicy);
  if (!policyValidation.ok) return policyValidation;
  return validatePlantumlSyntax(plantuml);
}

async function validatePlantumlSyntax(plantuml) {
  let response;
  try {
    const encoded = encodePlantuml(plantuml);
    response = await fetch(`${plantumlBaseUrl.replace(/\/$/, "")}/svg/${encoded}`);
  } catch {
    return { ok: false, error: `无法连接本地 PlantUML 服务：${plantumlBaseUrl}` };
  }
  const text = await response.text();
  if (!response.ok) return { ok: false, error: `${response.status} ${text.slice(0, 1200)}` };
  if (hasPlantumlRenderError(text)) {
    return { ok: false, error: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200) };
  }
  return { ok: true };
}

function hasPlantumlRenderError(value) {
  return /Syntax Error|Some diagram description contains errors|PlantUML diagram error|\[From string \(line \d+\)\s*\]/i.test(String(value || ""));
}

async function renderPlantumlPng(plantuml) {
  const encoded = encodePlantuml(plantuml);
  let response;
  try {
    response = await fetch(`${plantumlBaseUrl.replace(/\/$/, "")}/png/${encoded}`);
  } catch {
    const error = new Error(`无法连接本地 PlantUML 服务：${plantumlBaseUrl}`);
    error.statusCode = 502;
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`PlantUML PNG 渲染失败：${response.status} ${text.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function savePlantumlImage({ title, plantuml, png, selectedTitle, prompt, documentName = "AI生成配图", ownerId }) {
  const operation = plantumlImageWriteQueue.catch(() => {}).then(() => persistPlantumlImage({
    title,
    plantuml,
    png,
    selectedTitle,
    prompt,
    documentName,
    ownerId,
  }));
  plantumlImageWriteQueue = operation;
  return operation;
}

async function persistPlantumlImage({ title, plantuml, png, selectedTitle, prompt, documentName, ownerId }) {
  await mkdir(imageDir, { recursive: true });
  await cleanupPlantumlImages();
  const id = `SPI-${randomUUID()}`;
  const safeTitle = sanitizeTitle(title || selectedTitle || "AI生成配图");
  const pngPath = path.join(imageDir, `${id}.png`);
  const docxPath = path.join(imageDir, `${id}.docx`);
  const metaPath = path.join(imageDir, `${id}.json`);
  const size = getImageEmuSize(png);
  const createdAt = Date.now();
  try {
    await writeFile(pngPath, png);
    await writeFile(docxPath, await buildImageDocx(png, safeTitle));
    await writeFile(metaPath, JSON.stringify({
      id,
      title: safeTitle,
      selectedTitle,
      prompt,
      plantuml,
      ownerId: String(ownerId || "local-development"),
      createdAt,
      expiresAt: createdAt + plantumlImageTtlMs,
    }, null, 2), "utf8");
  } catch (error) {
    await removePlantumlImage(id);
    throw error;
  }
  const filePath = `/api/v1/solution-plantuml-images/${encodeURIComponent(id)}/file`;
  const sourceDocxPath = `/api/v1/solution-plantuml-images/${encodeURIComponent(id)}/docx`;
  return {
    id,
    title: safeTitle,
    documentName,
    previewUrl: signCapabilityUrl(filePath, {
      scope: capabilityScopes.solutionPlantumlFile,
      resource: buildCapabilityResource("solution-plantuml-image", id, "file"),
    }),
    imageUrl: signCapabilityUrl(`${publicBaseUrl.replace(/\/$/, "")}${filePath}`, {
      scope: capabilityScopes.solutionPlantumlFile,
      resource: buildCapabilityResource("solution-plantuml-image", id, "file"),
    }),
    sourceDocxUrl: signCapabilityUrl(`${publicBaseUrl.replace(/\/$/, "")}${sourceDocxPath}`, {
      scope: capabilityScopes.solutionPlantumlDocx,
      resource: buildCapabilityResource("solution-plantuml-image", id, "docx"),
    }),
    widthEmu: size.widthEmu,
    heightEmu: size.heightEmu,
  };
}

async function readActivePlantumlImageMetadata(id) {
  try {
    const metadata = JSON.parse(await readFile(path.join(imageDir, `${id}.json`), "utf8"));
    if (metadata?.id !== id) return null;
    const createdAt = readTimestamp(metadata.createdAt);
    const expiresAt = Number(metadata.expiresAt) || createdAt + plantumlImageTtlMs;
    if (!createdAt || expiresAt <= Date.now()) {
      await removePlantumlImage(id);
      return null;
    }
    return { ...metadata, createdAt, expiresAt };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function assertPlantumlImageOwner(metadata, principal) {
  const authentication = principal?.authentication;
  if (!principal || ["anonymous", "public", "disabled"].includes(authentication) || principal.roles?.includes("admin")) return;
  if (!metadata.ownerId || metadata.ownerId !== principal.id) {
    const error = new Error("当前身份无权读取该方案配图");
    error.statusCode = 403;
    throw error;
  }
}

async function cleanupPlantumlImages() {
  const names = await readdir(imageDir).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const ids = [...new Set(names.map((name) => name.match(/^([A-Za-z0-9_-]+)\.(?:png|docx|json)$/)?.[1]).filter(Boolean))];
  const active = [];
  for (const id of ids) {
    const [metadata, pngStat, docxStat] = await Promise.all([
      readActivePlantumlImageMetadata(id),
      stat(path.join(imageDir, `${id}.png`)).catch(() => null),
      stat(path.join(imageDir, `${id}.docx`)).catch(() => null),
    ]);
    if (!metadata || !pngStat?.isFile() || !docxStat?.isFile()) {
      await removePlantumlImage(id);
      continue;
    }
    active.push({ id, createdAt: metadata.createdAt });
  }
  active.sort((left, right) => right.createdAt - left.createdAt);
  await Promise.all(active.slice(maxPlantumlImages - 1).map(({ id }) => removePlantumlImage(id)));
}

async function removePlantumlImage(id) {
  await Promise.all(["png", "docx", "json"].map((extension) => (
    rm(path.join(imageDir, `${id}.${extension}`), { force: true })
  )));
}

function readTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback);
  return Number.isSafeInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
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

function normalizePlantumlSource(value, diagramPolicy = resolveDiagramPolicy({})) {
  let text = String(value || "").replace(/```(?:plantuml|puml|uml|wbs)?/gi, "").replace(/```/g, "").trim();
  if (!text) return "";
  if (!/@start[a-z]+\b/i.test(text)) text = `${diagramPolicy.startToken}\n${text}`;
  if (!/@end(?:uml|wbs)\b/i.test(text)) text = `${text}\n${diagramPolicy.endToken}`;
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /@start[a-z]+\b/i.test(line));
  const insertAt = startIndex >= 0 ? startIndex + 1 : 1;
  const fontNameIndexes = lines.flatMap((line, index) => /skinparam\s+defaultFontName/i.test(line) ? [index] : []);
  if (fontNameIndexes.length) fontNameIndexes.forEach((index) => { lines[index] = "skinparam defaultFontName SimHei"; });
  else lines.splice(insertAt, 0, "skinparam defaultFontName SimHei");
  const fontSizeIndexes = lines.flatMap((line, index) => /skinparam\s+defaultFontSize/i.test(line) ? [index] : []);
  if (fontSizeIndexes.length) fontSizeIndexes.forEach((index) => { lines[index] = "skinparam defaultFontSize 20"; });
  else lines.splice(insertAt + 1, 0, "skinparam defaultFontSize 20");
  return lines.join("\n");
}

function normalizeManualPlantumlSource(value) {
  return String(value || "")
    .replace(/^\s*```(?:plantuml|puml|uml)?\s*\r?\n/i, "")
    .replace(/\r?\n\s*```\s*$/i, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function validateManualPlantumlSource(source) {
  if (!source) return { ok: false, error: "请粘贴 PlantUML 源码。" };
  if (source.length > 100000) return { ok: false, error: "PlantUML 源码不能超过 100000 个字符。" };
  const starts = source.match(/^\s*@start[a-z]+\b/gim) || [];
  const ends = source.match(/^\s*@end[a-z]+\b/gim) || [];
  if (starts.length !== 1 || ends.length !== 1 || /^\s*newpage\b/im.test(source)) {
    return { ok: false, error: "源码必须且只能包含一个完整的 PlantUML 图。" };
  }
  if (/^\s*!(?:include|includeurl|import)\b/im.test(source)) {
    return { ok: false, error: "为避免读取外部资源，手动渲染不支持 include 或 import。" };
  }
  return { ok: true };
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
  buildPlantumlUserPrompt,
  generateSolutionPlantumlImage,
  hasPlantumlRenderError,
  normalizePlantumlSource,
  renderSolutionPlantumlSource,
  readSolutionPlantumlImageDocx,
  readSolutionPlantumlImageFile,
  resolveDiagramPolicy,
  validateManualPlantumlSource,
  validatePlantumlPolicy,
};

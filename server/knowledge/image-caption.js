import { createHash } from "node:crypto";
import { inspectRasterImage } from "../document-security.js";
import { requestChatCompletion } from "../ai/chat-completions.js";
import { getModelConfig } from "../settings.js";

const promptVersion = "knowledge-image-v1";
const maxCaptionLength = 2400;

async function enrichMinerUImageCaptions({ artifacts, contentList, contentListV2, onlyPaths, onProgress, analyze = analyzeKnowledgeImage }) {
  const allowedPaths = onlyPaths ? new Set([...onlyPaths].map(normalizeArtifactPath)) : null;
  const detectedItems = collectV1ImageItems(contentList);
  const imageItems = (detectedItems.length ? detectedItems : collectV2ImageItems(contentListV2)).filter(({ item }) =>
    !allowedPaths || allowedPaths.has(normalizeArtifactPath(item.img_path || item.image_path || "")));
  if (imageItems.length === 0) return { records: [], warning: "" };

  const byHash = new Map();
  const records = new Array(imageItems.length);
  let completed = 0;
  await runWithConcurrency(imageItems, 2, async ({ item, imageIndex }, index) => {
    const imagePath = normalizeArtifactPath(item.img_path || item.image_path || "");
    const buffer = artifacts.get(imagePath);
    let record;
    if (!imagePath || !buffer) {
      record = failedImageRecord(item, imageIndex, imagePath, "MinerU 图片产物不存在");
    } else {
      const imageHash = createHash("sha256").update(buffer).digest("hex");
      let resultPromise = byHash.get(imageHash);
      if (!resultPromise) {
        resultPromise = analyze({ buffer, imagePath });
        byHash.set(imageHash, resultPromise);
      }
      try {
        const analysis = await resultPromise;
        const caption = buildImageCaption(analysis);
        item.image_caption = [caption];
        applyV2ImageCaption(contentListV2, imagePath, caption);
        record = {
          imageIndex,
          imagePath,
          imageHash,
          pageIndex: Math.max(0, Number(item.page_idx) || 0),
          bbox: normalizeBbox(item.bbox),
          anchor: String(item.anchor || ""),
          status: "captioned",
          caption,
          metadata: analysis,
          model: analysis.model,
          promptVersion,
          error: "",
        };
      } catch (error) {
        record = failedImageRecord(item, imageIndex, imagePath, error?.message || "Gemini 图片解析失败", imageHash);
      }
    }
    records[index] = record;
    completed += 1;
    await onProgress?.({ completed, total: imageItems.length, record });
  });

  const failed = records.filter((record) => record.status === "failed").length;
  return {
    records,
    warning: failed ? `${failed}/${records.length} 张图片未生成语义说明，可稍后重试。` : "",
  };
}

async function analyzeKnowledgeImage({ buffer, imagePath }) {
  const config = await getModelConfig();
  const runtime = config.cloud;
  if (!isGeminiRuntime(runtime)) throw new Error("知识库图片解析需要配置 Gemini 云端模型");
  const mimeType = inspectRasterImage(buffer, imagePath);
  const result = await requestChatCompletion({ ...runtime, timeoutMs: 60_000 }, {
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content: "你是企业知识库图片语义解析器。准确读取图片中的中文和结构，只提取可见内容，不补充常识，不生成 Mermaid，不复刻图形。严格只返回一个 JSON 对象。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "输出 JSON：kind（图片类型）、summary（200字以内）、visibleText（关键可见文字数组）、actors（参与方数组）、relations（关键关系或流程数组）、keywords（最多20个）、uncertain（无法确认的文字数组）。所有数组的每一项都必须是纯字符串，relations 也不得返回对象。异常分支和成功分支必须分开；整体保持简洁，适合知识库检索。",
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
        ],
      },
    ],
  }, {
    allowLocal: false,
    ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
  });
  return {
    ...parseImageAnalysisContent(result?.choices?.[0]?.message?.content),
    model: String(result?.model || runtime.model || ""),
  };
}

function parseImageAnalysisContent(value) {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Gemini 图片解析结果不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Gemini 图片解析结果格式无效");
  const analysis = {
    kind: requiredText(parsed.kind, "kind", 80),
    summary: requiredText(parsed.summary, "summary", 600),
    visibleText: stringList(parsed.visibleText, "visibleText", 40, 240),
    actors: stringList(parsed.actors, "actors", 20, 120),
    relations: stringList(parsed.relations, "relations", 30, 300),
    keywords: stringList(parsed.keywords, "keywords", 20, 80),
    uncertain: stringList(parsed.uncertain, "uncertain", 20, 160),
  };
  if (!analysis.summary) throw new Error("Gemini 图片解析结果缺少 summary");
  return analysis;
}

function buildImageCaption(analysis) {
  const lines = [
    `图片类型：${analysis.kind}`,
    `图片说明：${analysis.summary}`,
    analysis.visibleText.length ? `可见文字：${analysis.visibleText.join("；")}` : "",
    analysis.actors.length ? `参与方：${analysis.actors.join("、")}` : "",
    analysis.relations.length ? `关键关系：${analysis.relations.join("；")}` : "",
    analysis.keywords.length ? `关键词：${analysis.keywords.join("、")}` : "",
    analysis.uncertain.length ? `待确认文字：${analysis.uncertain.join("；")}` : "",
  ].filter(Boolean);
  const caption = lines.join("\n");
  if (!caption || caption.length > maxCaptionLength) throw new Error("Gemini 图片说明为空或过长");
  return caption;
}

function collectV1ImageItems(contentList) {
  return Array.isArray(contentList)
    ? contentList.map((item, imageIndex) => ({ item, imageIndex })).filter(({ item }) => isMinerUVisualCandidate(item))
    : [];
}

function collectV2ImageItems(contentListV2) {
  const items = [];
  function visit(value, pageIndex = 0) {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, pageIndex));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (isMinerUVisualCandidate(value)) {
      items.push({
        imageIndex: items.length,
        item: {
          type: value.type || "image",
          img_path: value?.content?.image_source?.path || value.img_path || "",
          page_idx: value.page_idx ?? pageIndex,
          bbox: value.bbox,
          anchor: value.anchor,
        },
      });
      return;
    }
    Object.values(value).forEach((item) => visit(item, pageIndex));
  }
  if (Array.isArray(contentListV2)) {
    contentListV2.forEach((page, pageIndex) => visit(page, pageIndex));
  }
  return items;
}

function applyV2ImageCaption(value, imagePath, caption) {
  if (Array.isArray(value)) {
    value.forEach((item) => applyV2ImageCaption(item, imagePath, caption));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isMinerUVisualCandidate(value)) {
    const candidate = normalizeArtifactPath(value?.content?.image_source?.path || value.img_path || "");
    if (candidate === imagePath) {
      if (value.content && typeof value.content === "object") value.content.image_caption = [caption];
      value.image_caption = [caption];
    }
  }
  Object.values(value).forEach((item) => applyV2ImageCaption(item, imagePath, caption));
}

function isMinerUVisualCandidate(item) {
  const imagePath = item?.img_path || item?.image_path || item?.content?.image_source?.path || "";
  if (!String(imagePath).trim()) return false;
  if (item?.type === "image") return true;
  if (item?.type !== "table") return false;
  return !String(item.table_body || item.html || "").trim();
}

function failedImageRecord(item, imageIndex, imagePath, error, imageHash = "") {
  return {
    imageIndex,
    imagePath,
    imageHash,
    pageIndex: Math.max(0, Number(item?.page_idx) || 0),
    bbox: normalizeBbox(item?.bbox),
    anchor: String(item?.anchor || ""),
    status: "failed",
    caption: "",
    metadata: null,
    model: "",
    promptVersion,
    error: String(error || "图片解析失败").slice(0, 500),
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function isGeminiRuntime(runtime) {
  try {
    const url = new URL(String(runtime?.baseUrl || ""));
    return url.hostname === "generativelanguage.googleapis.com"
      && /gemini/i.test(String(runtime?.model || ""))
      && Boolean(runtime?.apiKey);
  } catch {
    return false;
  }
}

function normalizeArtifactPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function requiredText(value, name, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error(`Gemini 图片解析字段 ${name} 无效`);
  return text;
}

function stringList(value, name, maxItems, maxLength) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Gemini 图片解析字段 ${name} 无效`);
  if (value.some((item) => typeof item !== "string")) throw new Error(`Gemini 图片解析字段 ${name} 无效`);
  const items = value.map((item) => item.trim());
  if (items.some((item) => !item || item.length > maxLength)) throw new Error(`Gemini 图片解析字段 ${name} 无效`);
  return [...new Set(items)];
}

export {
  applyV2ImageCaption,
  buildImageCaption,
  enrichMinerUImageCaptions,
  isMinerUVisualCandidate,
  parseImageAnalysisContent,
};

import assert from "node:assert/strict";
import test from "node:test";
import {
  createMinerUEvidenceHighlight,
  createMinerUPageAnchor,
  minerUBboxScale,
  normalizeMinerUBbox,
} from "../src/features/knowledge/pdfEvidenceHighlight.js";
import {
  collectKnowledgeHighlightRanges,
  createKnowledgeDisplayTerms,
  getKnowledgePreview,
  splitKnowledgeHighlightParts,
} from "../src/features/knowledge/searchHighlight.js";

function highlightedText(text, query) {
  return splitKnowledgeHighlightParts(text, query).filter((part) => part.hit).map((part) => part.text);
}

test("MinerU bbox maps to a 0-1000 reference rect the pdf viewer can scale", () => {
  const highlight = createMinerUEvidenceHighlight({ page: 3, bbox: [129, 172, 504, 195], text: "档案录入配置表" });
  assert.equal(highlight.position.pageNumber, 3);
  assert.equal(highlight.position.usePdfCoordinates, false);
  assert.deepEqual(highlight.position.boundingRect, {
    x1: 129, y1: 172, x2: 504, y2: 195,
    width: minerUBboxScale, height: minerUBboxScale, pageNumber: 3,
  });
  assert.deepEqual(highlight.position.rects, [highlight.position.boundingRect]);

  // scaledToViewport 的换算：viewportWidth * x1 / width。595.32pt 宽的页面应还原成 middle.json 的页点坐标。
  const viewportWidth = 595.32;
  const viewportHeight = 841.92;
  const left = viewportWidth * highlight.position.boundingRect.x1 / minerUBboxScale;
  const top = viewportHeight * highlight.position.boundingRect.y1 / minerUBboxScale;
  assert.equal(Math.round(left), 77);
  assert.equal(Math.round(top), 145);
});

test("invalid MinerU locators fail closed instead of drawing a guessed box", () => {
  assert.equal(normalizeMinerUBbox([0, 0, 0, 0]), null);
  assert.equal(normalizeMinerUBbox([10, 10, 5, 40]), null);
  assert.equal(normalizeMinerUBbox([10, 10, 40]), null);
  assert.equal(normalizeMinerUBbox([10, 10, 40, 1200]), null);
  assert.equal(normalizeMinerUBbox(null), null);
  assert.equal(createMinerUEvidenceHighlight({ page: 2, bbox: null }), null);
  assert.equal(createMinerUEvidenceHighlight({ page: 0, bbox: [1, 2, 3, 4] }), null);

  const anchor = createMinerUPageAnchor(4);
  assert.equal(anchor.position.pageNumber, 4);
  assert.deepEqual(anchor.position.rects, []);
  assert.equal(createMinerUPageAnchor(0), null);
});

test("chinese queries highlight the overlapping fragments instead of the whole sentence", () => {
  const text = "投标人应当具备有效的施工劳务资质和安全生产许可证。";
  assert.deepEqual(createKnowledgeDisplayTerms("投标人的资格要求是什么"), ["投标人的资格要求是什么"]);
  assert.deepEqual(highlightedText(text, "投标人的资格要求是什么"), ["投标人"]);
  assert.deepEqual(highlightedText(text, "施工劳务资质"), ["施工劳务资质"]);
  assert.deepEqual(highlightedText(text, "安全生产许可证在哪"), ["安全生产许可证"]);
});

test("latin terms keep whole-term case-insensitive matching", () => {
  const text = "供应商需提供 ISO27001 与 iso9001 认证复印件。";
  assert.deepEqual(highlightedText(text, "ISO27001 认证"), ["ISO27001", "认证"]);
  assert.deepEqual(highlightedText(text, "iso27001"), ["ISO27001"]);
});

test("pure function words never produce highlight noise", () => {
  const text = "本项目的实施范围包括主体结构与安装工程。";
  assert.deepEqual(createKnowledgeDisplayTerms("是什么"), []);
  assert.deepEqual(highlightedText(text, "是什么"), []);
  // 查询尾部的“是什么”在原文里没有对应内容，只标真正重合的“实施范围”。
  assert.deepEqual(highlightedText(text, "实施范围是什么"), ["实施范围"]);
});

test("adjacent and overlapping hits merge into one continuous range", () => {
  const text = "评审办法采用综合评分法";
  assert.deepEqual(collectKnowledgeHighlightRanges(text, "评审办法 综合评分法"), [[0, 4], [6, 11]]);
  assert.deepEqual(highlightedText("综合评分法评审办法", "评审办法综合评分法"), ["综合评分法评审办法"]);
});

test("split parts rebuild the original text exactly", () => {
  const text = "合同工期为 180 日历天，自进场通知之日起算。";
  const parts = splitKnowledgeHighlightParts(text, "合同工期 日历天");
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(parts.filter((part) => part.hit).map((part) => part.text), ["合同工期", "日历天"]);
});

test("preview window centers on the first real hit", () => {
  const text = `${"前置说明".repeat(40)}综合评分法的具体细则如下${"后续补充".repeat(40)}`;
  const preview = getKnowledgePreview(text, "综合评分法", 60);
  assert.equal(preview.startsWith("..."), true);
  assert.equal(preview.includes("综合评分法"), true);
  assert.equal(preview.length <= 66, true);
  assert.equal(getKnowledgePreview("短文本", "综合评分法"), "短文本");
});

test("empty query or empty text produces no highlight", () => {
  assert.deepEqual(splitKnowledgeHighlightParts("", "评审办法"), []);
  assert.deepEqual(splitKnowledgeHighlightParts("评审办法", ""), [{ text: "评审办法", hit: false }]);
  assert.deepEqual(collectKnowledgeHighlightRanges("评审办法", "  "), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImageCaption,
  enrichMinerUImageCaptions,
  isMinerUVisualCandidate,
  parseImageAnalysisContent,
} from "../server/knowledge/image-caption.js";

const analysis = {
  kind: "流程图",
  summary: "管理员发布餐次，用户预约支付后由核销员校验餐券。",
  visibleText: ["预约限额", "8位数字券码"],
  actors: ["管理员", "用户", "核销员"],
  relations: ["名额已满时终止预约", "校验成功后更新为已核销"],
  keywords: ["预约", "支付", "核销"],
  uncertain: [],
};

test("Gemini image analysis accepts fenced JSON and builds bounded retrieval text", () => {
  const parsed = parseImageAnalysisContent(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``);
  assert.deepEqual(parsed, analysis);
  const caption = buildImageCaption(parsed);
  assert.match(caption, /图片说明：管理员发布餐次/);
  assert.match(caption, /名额已满时终止预约/);
  assert.doesNotMatch(caption, /mermaid/i);
});

test("MinerU image enrichment matches exact artifact paths and writes V1/V2 captions", async () => {
  const contentList = [
    { type: "image", img_path: "images/flow.jpg", page_idx: 2, bbox: [1, 2, 3, 4], image_caption: [] },
    { type: "image", img_path: "images/flow.jpg", page_idx: 3, bbox: [5, 6, 7, 8], image_caption: [] },
  ];
  const contentListV2 = [[{
    type: "image",
    content: { image_source: { path: "images/flow.jpg" }, image_caption: [] },
  }]];
  let calls = 0;
  const result = await enrichMinerUImageCaptions({
    artifacts: new Map([["images/flow.jpg", Buffer.from("same-image")]]),
    contentList,
    contentListV2,
    analyze: async () => {
      calls += 1;
      return { ...analysis, model: "gemini-test" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records.every((record) => record.status === "captioned"), true);
  assert.match(contentList[0].image_caption[0], /管理员发布餐次/);
  assert.deepEqual(contentListV2[0][0].content.image_caption, contentList[0].image_caption);
});

test("invalid Gemini image JSON fails closed", () => {
  assert.throws(() => parseImageAnalysisContent('{"summary":"missing kind"}'), /kind/);
  assert.throws(() => parseImageAnalysisContent("not-json"), /不是有效 JSON/);
  assert.throws(() => parseImageAnalysisContent(JSON.stringify({ ...analysis, relations: [{ from: "A", to: "B" }] })), /relations/);
});

test("MinerU V2-only image blocks still receive captions by exact artifact path", async () => {
  const contentListV2 = [[{
    type: "image",
    bbox: [10, 20, 30, 40],
    content: { image_source: { path: "images/v2-only.png" }, image_caption: [] },
  }]];
  const result = await enrichMinerUImageCaptions({
    artifacts: new Map([["images/v2-only.png", Buffer.from("v2-image")]]),
    contentList: null,
    contentListV2,
    analyze: async () => ({ ...analysis, model: "gemini-test" }),
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].imagePath, "images/v2-only.png");
  assert.match(contentListV2[0][0].content.image_caption[0], /管理员发布餐次/);
});

test("empty MinerU table assets are captioned but structured tables are not", async () => {
  const visualTable = { type: "table", img_path: "images/flow.jpg", page_idx: 2, table_body: "", image_caption: [] };
  const structuredTable = { type: "table", img_path: "images/table.jpg", page_idx: 3, table_body: "<table><tr><td>真实表格</td></tr></table>" };
  assert.equal(isMinerUVisualCandidate(visualTable), true);
  assert.equal(isMinerUVisualCandidate(structuredTable), false);
  let calls = 0;
  const result = await enrichMinerUImageCaptions({
    artifacts: new Map([["images/flow.jpg", Buffer.from("flow")], ["images/table.jpg", Buffer.from("table")]]),
    contentList: [visualTable, structuredTable],
    contentListV2: null,
    analyze: async () => {
      calls += 1;
      return { ...analysis, model: "gemini-test" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.records.length, 1);
  assert.match(visualTable.image_caption[0], /管理员发布餐次/);
});

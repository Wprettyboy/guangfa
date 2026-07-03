import assert from "node:assert/strict";

import { extractParagraphSourceCandidate, createParagraphSourceFallbackResult } from "../server/ai/fill-rules.js";

const field = {
  category: "填空",
  fillMode: "paragraph",
  name: "采购范围",
  sourceText: "采购范围：____",
};

const candidate = extractParagraphSourceCandidate(
  field,
  {
    value: "本项目包括施工图范围内全部工作",
    evidence: "施工图范围内的土建、安装及配套工程",
    retrievalQuery: "采购范围 实施范围 施工图范围内",
  },
  [
    {
      documentName: "采购需求",
      scope: "project",
      chunkIndex: 2,
      score: 0.7,
      text: "采购范围：本项目包含施工图范围内的土建、安装及配套工程，包括但不限于材料采购、施工、调试。",
    },
    {
      documentName: "财务资料",
      scope: "project",
      chunkIndex: 3,
      score: 0.9,
      text: "财务要求：供应商应提供近三年财务报表。",
    },
  ],
  [],
);

assert(candidate, "paragraph fallback should find the semantically matching source snippet");
assert.match(candidate.text, /采购范围：本项目包含施工图范围内/);
assert.doesNotMatch(candidate.text, /财务要求/);

const result = createParagraphSourceFallbackResult(candidate);
assert.equal(result.status, "待确认");
assert.equal(result.value, candidate.text);
assert.equal(result.evidence, candidate.text);

const miss = extractParagraphSourceCandidate(
  field,
  { value: "付款方式按月支付", evidence: "付款方式", retrievalQuery: "付款方式" },
  [{ documentName: "财务资料", text: "财务要求：供应商应提供近三年财务报表。", score: 0.9 }],
  [],
);

assert.equal(miss, null, "paragraph fallback should not fill unrelated recalled text");

console.log("paragraph source fallback check passed");

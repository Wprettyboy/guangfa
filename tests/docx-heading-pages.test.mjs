import assert from "node:assert/strict";
import test from "node:test";
import { mapHeadingPathsToPdfPages, normalizeHeadingText } from "../server/knowledge/docx-heading-pages.js";

test("DOCX heading page mapping keeps heading order and uses physical PDF pages", () => {
  const pages = [
    { page: 1, text: "封面" },
    { page: 7, text: "第一章 项目概况\n项目内容" },
    { page: 12, text: "第二章 技术要求\n2.1 设备要求" },
    { page: 18, text: "第三章 评审办法" },
  ];
  assert.deepEqual(
    mapHeadingPathsToPdfPages([
      "第一章 项目概况",
      "第二章 技术要求>2.1 设备要求",
      "第三章 评审办法",
    ], pages),
    [
      { headingPath: "第一章 项目概况", physicalPage: 7 },
      { headingPath: "第二章 技术要求>2.1 设备要求", physicalPage: 12 },
      { headingPath: "第三章 评审办法", physicalPage: 18 },
    ],
  );
});

test("DOCX heading matching normalizes Markdown markers and PDF spacing without fuzzy matching", () => {
  assert.equal(normalizeHeadingText("**4.6.1 业务流程**"), "4.6.1业务流程");
  assert.deepEqual(
    mapHeadingPathsToPdfPages(["4.6.1 业务流程", "不存在的标题"], [{ page: 43, text: "4.6.1 业 务 流 程" }]),
    [{ headingPath: "4.6.1 业务流程", physicalPage: 43 }],
  );
});

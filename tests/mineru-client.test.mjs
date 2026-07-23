import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  buildBlocksFromMinerU,
  buildPagesFromMinerU,
  parseWithMinerU,
  readMinerUConfig,
} from "../server/knowledge/mineru-client.js";
import { buildStructuredKnowledgeChunks } from "../server/knowledge/chunker.js";

test("MinerU v1 blocks preserve page, bbox, heading level and whole-table text", () => {
  const contentList = [
    { type: "text", text: "第一章 招标要求", text_level: 1, page_idx: 0, bbox: [10, 20, 900, 80] },
    { type: "table", table_body: "<table><tr><th>资格</th><th>要求</th></tr><tr><td>资质</td><td>一级</td></tr></table>", page_idx: 1, bbox: [20, 100, 950, 700] },
  ];
  const blocks = buildBlocksFromMinerU(contentList, null);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[0].bbox, [10, 20, 900, 80]);
  assert.match(blocks[1].text, /资格 \| 要求/);
  assert.match(blocks[1].text, /资质 \| 一级/);

  const pages = buildPagesFromMinerU(contentList, null);
  assert.deepEqual(pages.map((page) => page.page), [1, 2]);
  assert.match(pages[1].text, /一级/);
});

test("MinerU v2 remains a fallback when the stable v1 list is absent", () => {
  const contentListV2 = [[
    {
      type: "title",
      content: { title_content: [{ type: "text", content: "投标人资格" }], level: 2 },
      bbox: [50, 80, 900, 130],
      anchor: "_Toc100",
    },
  ]];
  const blocks = buildBlocksFromMinerU(null, contentListV2);
  assert.equal(blocks[0].text, "投标人资格");
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[0].anchor, "_Toc100");
});

test("MinerU runtime configuration fails closed outside Hybrid backends", () => {
  const originalBackend = process.env.MINERU_BACKEND;
  const originalEffort = process.env.MINERU_EFFORT;
  try {
    process.env.MINERU_BACKEND = "pipeline";
    assert.throws(() => readMinerUConfig(), /必须使用 Hybrid 后端/);
    process.env.MINERU_BACKEND = "hybrid-http-client";
    process.env.MINERU_EFFORT = "ultra";
    assert.throws(() => readMinerUConfig(), /medium 或 high/);
  } finally {
    restoreEnvironment("MINERU_BACKEND", originalBackend);
    restoreEnvironment("MINERU_EFFORT", originalEffort);
  }
});

test("MinerU client submits Hybrid tasks and persists structured ZIP artifacts", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "guangfa-mineru-test-"));
  const artifactsDir = path.join(workDir, "artifacts");
  const textPath = path.join(workDir, "source.txt");
  const sourcePath = path.join(workDir, "source.pdf");
  const contentList = [
    { type: "text", text: "第一章 采购要求", text_level: 1, page_idx: 0, bbox: [10, 20, 900, 80] },
    { type: "text", text: "供应商须具备施工资质。", page_idx: 0, bbox: [10, 100, 900, 160] },
  ];
  const zip = new JSZip();
  zip.file("source/hybrid/source.md", "# 第一章 采购要求");
  zip.file("source/hybrid/source_content_list.json", JSON.stringify(contentList));
  const resultZip = await zip.generateAsync({ type: "nodebuffer" });
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.MINERU_API_URL;
  const originalBackend = process.env.MINERU_BACKEND;
  const originalEffort = process.env.MINERU_EFFORT;
  try {
    await writeFile(sourcePath, "%PDF-1.7\n");
    process.env.MINERU_API_URL = "http://mineru.test";
    process.env.MINERU_BACKEND = "hybrid-http-client";
    process.env.MINERU_EFFORT = "medium";
    globalThis.fetch = async (url, options = {}) => {
      if (url === "http://mineru.test/tasks" && options.method === "POST") {
        assert.equal(options.body.get("backend"), "hybrid-http-client");
        assert.equal(options.body.get("effort"), "medium");
        assert.equal(options.body.get("server_url"), "http://mineru-vlm:30000");
        return Response.json({ task_id: "TASK-1" });
      }
      if (url === "http://mineru.test/tasks/TASK-1") return Response.json({ status: "completed" });
      if (url === "http://mineru.test/tasks/TASK-1/result") {
        return new Response(resultZip, { headers: { "content-length": String(resultZip.length) } });
      }
      throw new Error(`Unexpected MinerU request: ${url}`);
    };

    const parsed = await parseWithMinerU({ sourcePath, fileName: "source.pdf", artifactsDir, textPath });
    assert.equal(parsed.parser, "mineru-medium");
    assert.equal(parsed.blocks.length, 2);
    assert.match(await readFile(textPath, "utf8"), /供应商须具备施工资质/);
    assert.match(await readFile(path.join(artifactsDir, "source_content_list.json"), "utf8"), /采购要求/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("MINERU_API_URL", originalApiUrl);
    restoreEnvironment("MINERU_BACKEND", originalBackend);
    restoreEnvironment("MINERU_EFFORT", originalEffort);
    await rm(workDir, { recursive: true, force: true });
  }
});

test("structured chunks keep heading paths, complete tables and precise PDF locators", () => {
  const chunks = buildStructuredKnowledgeChunks({
    documentId: "DOC-1",
    kbId: "KB-1",
    documentName: "招标文件.pdf",
    scope: "project",
    projectId: "P-1",
    fileExt: "pdf",
    createdAt: 1,
    blocks: [
      { type: "title", level: 1, pageIndex: 0, bbox: [1, 2, 3, 4], text: "第三章 资格要求" },
      { type: "paragraph", pageIndex: 0, bbox: [5, 6, 7, 8], text: "投标人须具备施工资质。" },
      { type: "table", pageIndex: 1, bbox: [10, 20, 900, 800], text: "资格 | 要求\n资质 | 一级" },
    ],
  });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].headingPath, "第三章 资格要求");
  assert.equal(chunks[1].parentChunkId, chunks[0].id);
  assert.equal(chunks[2].isTable, 1);
  assert.equal(chunks[2].sourceText, "资格 | 要求\n资质 | 一级");
  assert.equal(chunks[2].text, "路径: 第三章 资格要求\n资格 | 要求\n资质 | 一级");
  assert.equal(chunks[2].locatorGrade, "exact");
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

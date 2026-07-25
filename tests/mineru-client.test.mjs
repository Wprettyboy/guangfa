import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import JSZip from "jszip";
import {
  buildBlocksFromMinerU,
  buildPagesFromMinerU,
  parseWithMinerU,
  readMinerUConfig,
} from "../server/knowledge/mineru-client.js";
import {
  buildStructuredKnowledgeChunks,
  filterRetrievalKnowledgeChunks,
  hasExplicitStarMarker,
} from "../server/knowledge/chunker.js";
import { buildContextWindow, resolveChunkContext } from "../server/knowledge/source-resolver.js";

test("MinerU v1 blocks preserve page, bbox, heading level and whole-table text", () => {
  const contentList = [
    { type: "text", text: "<sub>第一章</sub> 招标要求", text_level: 1, page_idx: 0, bbox: [10, 20, 900, 80] },
    { type: "table", table_body: "<table><tr><th>资格</th><th>要求</th></tr><tr><td>资质</td><td>一级</td></tr></table>", page_idx: 1, bbox: [20, 100, 950, 700] },
    { type: "text", text: "注册资本<5000万且>1000万", page_idx: 1, bbox: [20, 720, 950, 760] },
  ];
  const blocks = buildBlocksFromMinerU(contentList, null);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, "第一章 招标要求");
  assert.deepEqual(blocks[0].bbox, [10, 20, 900, 80]);
  assert.match(blocks[1].text, /资格 \| 要求/);
  assert.match(blocks[1].text, /资质 \| 一级/);
  assert.equal(blocks[2].text, "注册资本<5000万且>1000万");

  const pages = buildPagesFromMinerU(contentList, null);
  assert.deepEqual(pages.map((page) => page.page), [1, 2]);
  assert.match(pages[1].text, /一级/);
});

test("MinerU v2 remains a fallback when the stable v1 list is absent", () => {
  const contentListV2 = [[
    {
      type: "title",
      content: { title_content: [{ type: "text", content: "<sup>投标人</sup>资格" }], level: 2 },
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
  const originalVlmUrl = process.env.MINERU_VLM_URL;
  try {
    await writeFile(sourcePath, "%PDF-1.7\n");
    process.env.MINERU_API_URL = "http://mineru.test";
    process.env.MINERU_BACKEND = "hybrid-http-client";
    process.env.MINERU_EFFORT = "medium";
    delete process.env.MINERU_VLM_URL;
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
    restoreEnvironment("MINERU_VLM_URL", originalVlmUrl);
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
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].blockType, "section-parent");
  assert.equal(chunks[1].headingPath, "第三章 资格要求");
  assert.equal(chunks[1].parentChunkId, chunks[0].id);
  assert.equal(chunks[2].blockType, "table-parent");
  assert.equal(chunks[2].sourceText, "资格 | 要求\n资质 | 一级");
  assert.equal(chunks[3].parentChunkId, chunks[2].id);
  assert.equal(chunks[3].isTable, 1);
  assert.equal(chunks[3].text, "路径: 第三章 资格要求\n资格 | 要求\n资质 | 一级");
  assert.equal(chunks[3].locatorGrade, "exact");
  assert.deepEqual(filterRetrievalKnowledgeChunks(chunks).map((chunk) => chunk.id), [chunks[1].id, chunks[3].id]);
});

test("structured chunks bound long paragraphs and table row groups without indexing parents", () => {
  const longParagraph = Array.from({ length: 120 }, (_, index) => `第${index + 1}项要求必须完整响应。`).join("");
  const longTable = ["序号 | 资格要求", ...Array.from({ length: 180 }, (_, index) => `${index + 1} | 第${index + 1}项资格要求及证明材料`) ].join("\n");
  const chunks = buildStructuredKnowledgeChunks({
    documentId: "DOC-LONG",
    kbId: "KB-1",
    documentName: "采购文件.pdf",
    scope: "project",
    projectId: "P-1",
    fileExt: "pdf",
    createdAt: 1,
    blocks: [
      { type: "title", level: 1, pageIndex: 0, bbox: [1, 2, 3, 4], text: "第四章 评审要求" },
      { type: "paragraph", pageIndex: 1, bbox: [5, 6, 7, 8], text: longParagraph },
      { type: "table", pageIndex: 2, bbox: [10, 20, 900, 800], text: longTable },
    ],
  });
  const retrievalChunks = filterRetrievalKnowledgeChunks(chunks);
  const paragraphSegments = retrievalChunks.filter((chunk) => chunk.blockType === "paragraph-segment");
  const tableSegments = retrievalChunks.filter((chunk) => chunk.blockType === "table-row-group");
  assert.ok(paragraphSegments.length > 1);
  assert.ok(tableSegments.length > 1);
  assert.equal(retrievalChunks.every((chunk) => chunk.text.length <= 1200), true);
  assert.equal(paragraphSegments.every((chunk) => chunk.locatorGrade === "container"), true);
  assert.equal(tableSegments.every((chunk) => chunk.locatorGrade === "container"), true);
  assert.equal(tableSegments.every((chunk) => chunk.sourceText.startsWith("序号 | 资格要求\n")), true);
  assert.equal(chunks.find((chunk) => chunk.blockType === "table-parent").sourceText, longTable);
});

test("star metadata ignores Markdown bold and accepts only explicit clause markers", () => {
  assert.equal(hasExplicitStarMarker("**重要内容**"), false);
  assert.equal(hasExplicitStarMarker("普通 * 强调内容"), false);
  assert.equal(hasExplicitStarMarker("★ 必须响应的条款"), true);
  assert.equal(hasExplicitStarMarker("* 必须响应的条款"), true);
  assert.equal(hasExplicitStarMarker("** 必须响应的条款"), false);
});

test("parent context expands around the matched child within a fixed budget", () => {
  const rows = [
    { id: "C1", chunkIndex: 1, sourceText: "第一段内容" },
    { id: "C2", chunkIndex: 2, sourceText: "命中段内容" },
    { id: "C3", chunkIndex: 3, sourceText: "第三段内容" },
    { id: "C4", chunkIndex: 4, sourceText: "第四段内容" },
  ];
  const context = buildContextWindow(rows, "C2", 18);
  assert.match(context, /命中段内容/);
  assert.ok(context.length <= 18);
});

test("resolved chunk context expands through stored parent and sibling rows", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      chunk_index INTEGER,
      source_text TEXT,
      block_type TEXT,
      parent_chunk_id TEXT
    );
    INSERT INTO knowledge_chunks VALUES
      ('P1', 'DOC-1', 1, '第五章 技术要求', 'section-parent', ''),
      ('C1', 'DOC-1', 2, '第一项技术要求。', 'paragraph-segment', 'P1'),
      ('C2', 'DOC-1', 3, '命中的技术参数。', 'paragraph-segment', 'P1'),
      ('C3', 'DOC-1', 4, '第三项技术要求。', 'paragraph-segment', 'P1');
  `);
  try {
    const context = resolveChunkContext(database, {
      id: "C2",
      documentId: "DOC-1",
      sourceText: "命中的技术参数。",
      text: "路径: 第五章 技术要求\n命中的技术参数。",
      headingPath: "第五章 技术要求",
      parentChunkId: "P1",
    }, 80);
    assert.match(context, /^路径: 第五章 技术要求/);
    assert.match(context, /第一项技术要求。/);
    assert.match(context, /命中的技术参数。/);
    assert.match(context, /第三项技术要求。/);
  } finally {
    database.close();
  }
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

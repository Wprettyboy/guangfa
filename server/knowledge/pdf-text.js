const maxPdfPages = 500;
const maxPdfTextCharacters = 20 * 1024 * 1024;

async function extractPdfPages(pdfPath, options = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { readFile } = await import("node:fs/promises");
  const data = new Uint8Array(await readFile(pdfPath));
  const document = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false, useSystemFonts: false }).promise;
  if (document.numPages > maxPdfPages) {
    await document.destroy();
    throw new Error(`PDF 页数超过限制（${maxPdfPages} 页）`);
  }
  const pages = [];
  let textCharacters = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (options.deadlineAt && Date.now() > options.deadlineAt) {
      await document.destroy();
      throw new Error("PDF 解析超时");
    }
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizePageText(content.items.map((item) => item.str || "").join(" "));
    textCharacters += text.length;
    if (textCharacters > maxPdfTextCharacters) {
      await document.destroy();
      throw new Error("PDF 文本内容超过限制");
    }
    pages.push({
      page: pageNumber,
      text,
    });
  }
  await document.destroy();
  return pages.filter((page) => page.text);
}

function normalizePageText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export { extractPdfPages };

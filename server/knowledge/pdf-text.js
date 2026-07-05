async function extractPdfPages(pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { readFile } = await import("node:fs/promises");
  const data = new Uint8Array(await readFile(pdfPath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({
      page: pageNumber,
      text: normalizePageText(content.items.map((item) => item.str || "").join(" ")),
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

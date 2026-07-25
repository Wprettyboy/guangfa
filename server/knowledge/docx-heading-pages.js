import { rm } from "node:fs/promises";
import { convertDocxToPdf } from "./docx-convert.js";
import { extractPdfPages } from "./pdf-text.js";

async function mapDocxHeadingPages({ documentId, sourcePath, outputPath, title, headingPaths = [] }) {
  const headings = [...new Set(headingPaths.map((value) => String(value || "").trim()).filter(Boolean))];
  if (headings.length === 0) return [];
  try {
    await convertDocxToPdf({ documentId, sourcePath, outputPath, title });
    const pages = await extractPdfPages(outputPath);
    return mapHeadingPathsToPdfPages(headings, pages);
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

function mapHeadingPathsToPdfPages(headingPaths, pages) {
  const mapped = [];
  let firstPage = 1;
  for (const headingPath of headingPaths) {
    const title = String(headingPath).split(">").at(-1)?.trim() || "";
    const normalizedTitle = normalizeHeadingText(title);
    if (!normalizedTitle) continue;
    const page = (pages || []).find((candidate) => (
      Number(candidate?.page) >= firstPage
      && normalizeHeadingText(candidate?.text).includes(normalizedTitle)
    ));
    if (!page) continue;
    mapped.push({ headingPath, physicalPage: Number(page.page) });
    firstPage = Number(page.page);
  }
  return mapped;
}

function normalizeHeadingText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

export { mapDocxHeadingPages, mapHeadingPathsToPdfPages, normalizeHeadingText };

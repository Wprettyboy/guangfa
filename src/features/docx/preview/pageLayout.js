function getRenderedPageCount(container) {
  return container?.querySelectorAll(".docx-wrapper > section")?.length ?? 0;
}

function normalizePreviewPageLayout(container) {
  const wrapper = container?.querySelector(".docx-wrapper");
  if (!wrapper) return;
  [...wrapper.querySelectorAll(":scope > section")].forEach(splitOverlongPreviewPage);
}

function splitOverlongPreviewPage(page) {
  const targetHeight = getPreviewPageTargetHeight(page);
  if (!targetHeight) return;

  page.style.height = `${targetHeight}px`;
  page.style.minHeight = `${targetHeight}px`;
  const overflowLimit = getPreviewPageOverflowLimit(targetHeight);

  const articles = [...page.children].filter((child) => child.tagName?.toLowerCase() === "article");
  if (articles.length !== 1 || articles[0].children.length <= 1) return;

  const template = page.cloneNode(true);
  const sourceBlocks = [...articles[0].children];
  articles[0].replaceChildren();

  let currentPage = page;
  let currentArticle = articles[0];
  let insertAfter = page;

  for (const block of sourceBlocks) {
    currentArticle.append(block);
    const tableSplit = splitPreviewTableIfNeeded({
      block,
      currentPage,
      currentArticle,
      insertAfter,
      pageTemplate: template,
      targetHeight,
      overflowLimit,
    });
    if (tableSplit) {
      currentPage = tableSplit.currentPage;
      currentArticle = tableSplit.currentArticle;
      insertAfter = tableSplit.insertAfter;
      continue;
    }
    // ponytail: paragraph-level split; exact table/line pagination needs a real Word-compatible engine.
    if (currentArticle.children.length <= 1 || currentPage.scrollHeight <= overflowLimit) continue;
    block.remove();
    const nextPage = createPreviewPageClone(template, targetHeight);
    insertAfter.after(nextPage);
    insertAfter = nextPage;
    currentPage = nextPage;
    currentArticle = nextPage.querySelector(":scope > article");
    currentArticle.append(block);
  }
}

function splitPreviewTableIfNeeded({ block, currentPage, currentArticle, insertAfter, pageTemplate, targetHeight, overflowLimit }) {
  if (block.tagName?.toLowerCase() !== "table" || block.rows.length <= 1) return null;

  const rows = [...block.rows];
  const tableTemplate = block.cloneNode(true);
  let activePage = currentPage;
  let activeArticle = currentArticle;
  let activeInsertAfter = insertAfter;
  let activeTable = createEmptyPreviewTable(tableTemplate);
  block.replaceWith(activeTable);

  rows.forEach((row) => {
    getPreviewTableBody(activeTable).append(row);
    if (activeTable.rows.length <= 1 || activePage.scrollHeight <= overflowLimit) return;
    row.remove();
    const nextPage = createPreviewPageClone(pageTemplate, targetHeight);
    activeInsertAfter.after(nextPage);
    activeInsertAfter = nextPage;
    activePage = nextPage;
    activeArticle = nextPage.querySelector(":scope > article");
    activeTable = createEmptyPreviewTable(tableTemplate);
    activeArticle.append(activeTable);
    getPreviewTableBody(activeTable).append(row);
  });

  return { currentPage: activePage, currentArticle: activeArticle, insertAfter: activeInsertAfter };
}

function createEmptyPreviewTable(table) {
  const clone = table.cloneNode(true);
  clone.querySelectorAll("tr").forEach((row) => row.remove());
  if (clone.tBodies.length === 0) clone.append(document.createElement("tbody"));
  return clone;
}

function getPreviewTableBody(table) {
  return table.tBodies[0] || table.appendChild(document.createElement("tbody"));
}

function createPreviewPageClone(template, targetHeight) {
  const clone = template.cloneNode(true);
  clone.removeAttribute("data-preview-page");
  clone.style.height = `${targetHeight}px`;
  clone.style.minHeight = `${targetHeight}px`;
  clone.querySelectorAll(":scope > article").forEach((article, index) => {
    if (index === 0) article.replaceChildren();
    else article.remove();
  });
  return clone;
}

function getPreviewPageTargetHeight(page) {
  const style = getComputedStyle(page);
  const width = parseCssPixels(style.width);
  const minHeight = parseCssPixels(style.minHeight);
  const ratio = width > 0 && minHeight > 0 ? minHeight / width : 0;
  if (ratio >= 0.6 && ratio <= 1.8) return minHeight;
  return width > 0 ? width * (297 / 210) : minHeight;
}

function getPreviewPageOverflowLimit(targetHeight) {
  return targetHeight + Math.max(180, targetHeight * 0.12);
}

function parseCssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function preparePreviewPages(container) {
  const sections = [...(container?.querySelectorAll(".docx-wrapper > section") ?? [])];
  sections.forEach((section, index) => {
    const sectionPage = index + 1;
    section.dataset.previewPage = String(sectionPage);
    section.hidden = false;
  });
}

function getPreviewPageElement(container, pageNumber) {
  return container?.querySelector(`.docx-wrapper > section[data-preview-page="${pageNumber}"]`) ?? null;
}

function scrollPreviewToPage(scrollContainer, pageNumber, behavior = "smooth") {
  const page = getPreviewPageElement(scrollContainer, pageNumber);
  if (!scrollContainer || !page) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const top = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16;
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

function scrollPreviewToElement(scrollContainer, element, behavior = "smooth") {
  if (!scrollContainer || !element) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = scrollContainer.scrollTop + elementRect.top - containerRect.top - Math.min(180, containerRect.height * 0.28);
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

function resolveVisiblePreviewPage(scrollContainer, previewHost) {
  const pages = [...(previewHost?.querySelectorAll(".docx-wrapper > section") ?? [])];
  if (!scrollContainer || pages.length === 0) return 1;

  const containerRect = scrollContainer.getBoundingClientRect();
  const anchorY = containerRect.top + Math.min(180, containerRect.height * 0.35);
  const best = pages
    .map((page, index) => {
      const rect = page.getBoundingClientRect();
      const distance = rect.top <= anchorY && rect.bottom >= anchorY ? 0 : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
      return { page: index + 1, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return best?.page || 1;
}

function isPreviewPageMostlyVisible(scrollContainer, page) {
  if (!scrollContainer || !page) return false;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  return pageRect.top >= containerRect.top + 8 && pageRect.top <= containerRect.top + Math.min(180, containerRect.height * 0.35);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolvePreviewPage(anchorNode, container) {
  if (!anchorNode || !container) return 1;
  const element = anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
  const page = element?.closest?.("section");
  if (!page) return 1;
  return [...container.querySelectorAll(".docx-wrapper > section")].indexOf(page) + 1 || 1;
}

export {
  clampNumber,
  createEmptyPreviewTable,
  createPreviewPageClone,
  getPreviewPageElement,
  getPreviewPageOverflowLimit,
  getPreviewPageTargetHeight,
  getPreviewTableBody,
  getRenderedPageCount,
  isPreviewPageMostlyVisible,
  normalizePreviewPageLayout,
  parseCssPixels,
  preparePreviewPages,
  resolvePreviewPage,
  resolveVisiblePreviewPage,
  scrollPreviewToElement,
  scrollPreviewToPage,
  splitOverlongPreviewPage,
  splitPreviewTableIfNeeded,
};

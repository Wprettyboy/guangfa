import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { PreviewState } from "../fill/FieldControls.jsx";

const emptyPdfHighlights = [];

function AuditPdfPreview({ pdfUrl, previewIdentity, zoomPercent, onReady, onError, onScrollChange, onTextReady, onOutlineReady }) {
  return (
    <div className="pdf-preview-host" data-testid="pdf-preview-host" data-preview-identity={previewIdentity}>
      <PdfLoader
        key={`${previewIdentity}|loader|${pdfUrl}`}
        url={pdfUrl}
        workerSrc={pdfWorkerUrl}
        beforeLoad={<PreviewState state="loading" />}
        errorMessage={<PreviewState state="error" />}
        onError={onError}
      >
        {(pdfDocument) => (
          <AuditPdfHighlighter
            key={`${previewIdentity}|highlighter|${pdfDocument?.fingerprints?.[0] || pdfDocument?.numPages || "pdf"}|${zoomPercent}`}
            pdfDocument={pdfDocument}
            previewIdentity={previewIdentity}
            zoomPercent={zoomPercent}
            onReady={onReady}
            onScrollChange={onScrollChange}
            onTextReady={onTextReady}
            onOutlineReady={onOutlineReady}
          />
        )}
      </PdfLoader>
    </div>
  );
}

function AuditPdfHighlighter({ pdfDocument, previewIdentity, zoomPercent, onReady, onScrollChange, onTextReady, onOutlineReady }) {
  const hostRef = useRef(null);
  const onTextReadyRef = useRef(onTextReady);
  const onOutlineReadyRef = useRef(onOutlineReady);
  const hasPdfOutlineRef = useRef(false);

  useEffect(() => {
    onTextReadyRef.current = onTextReady;
  }, [onTextReady]);

  useEffect(() => {
    onOutlineReadyRef.current = onOutlineReady;
  }, [onOutlineReady]);

  useEffect(() => {
    onReady?.(pdfDocument.numPages || 1);
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    flattenAuditPdfOutline(pdfDocument)
      .then((outline) => {
        if (!cancelled) {
          hasPdfOutlineRef.current = outline.length > 0;
          onOutlineReadyRef.current?.(outline);
        }
      })
      .catch(() => {
        if (!cancelled) {
          hasPdfOutlineRef.current = false;
          onOutlineReadyRef.current?.([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      collectPdfPageTexts(pdfDocument)
        .then((pageTexts) => {
          if (!cancelled) onTextReadyRef.current?.(pageTexts);
        })
        .catch(() => {
          if (!cancelled) onTextReadyRef.current?.([]);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    function attachScrollListener() {
      if (cancelled) return;
      const scrollContainer = getAuditPdfScrollContainer(hostRef.current);
      if (!scrollContainer || scrollContainer === hostRef.current) {
        requestAnimationFrame(attachScrollListener);
        return;
      }
      scrollContainer.addEventListener("scroll", onScrollChange, { passive: true });
      cleanup = () => scrollContainer.removeEventListener("scroll", onScrollChange);
    }

    requestAnimationFrame(attachScrollListener);
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [pdfDocument, onScrollChange]);

  return (
    <div ref={hostRef} className="audit-pdf-viewer" data-preview-identity={previewIdentity}>
      <PdfHighlighter
        key={`${previewIdentity}|pdf-viewer|${pdfDocument?.fingerprints?.[0] || pdfDocument?.numPages || "pdf"}|${zoomPercent}`}
        pdfDocument={pdfDocument}
        pdfScaleValue={zoomPercent === 100 ? "page-width" : String(zoomPercent / 100)}
        highlights={emptyPdfHighlights}
        onScrollChange={onScrollChange}
        scrollRef={() => {}}
        highlightTransform={() => null}
        onSelectionFinished={() => null}
        enableAreaSelection={() => false}
      />
    </div>
  );
}

function getAuditPdfScrollContainer(host) {
  const viewer = host?.querySelector(".pdfViewer");
  return viewer?.parentElement || host;
}

function getAuditPdfPageElement(host, pageNumber) {
  return (
    host?.querySelector(`.pdfViewer .page[data-page-number="${pageNumber}"]`) ??
    host?.querySelector(`.pdfViewer .page:nth-child(${pageNumber})`) ??
    null
  );
}

function scrollAuditPdfToPage(host, pageNumber, behavior = "auto") {
  const scrollContainer = getAuditPdfScrollContainer(host);
  const page = getAuditPdfPageElement(host, pageNumber);
  if (!scrollContainer || !page) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const top = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16;
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

async function collectPdfPageTexts(pdfDocument) {
  const pageCount = pdfDocument?.numPages || 0;
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageTexts.push({
      page: pageNumber,
      text: textContent.items.map((item) => item.str || "").join(" "),
    });
  }
  return pageTexts;
}

function getAuditPdfSearchHits(pageTexts = [], term = "") {
  const keyword = String(term || "").trim().toLowerCase();
  if (!keyword) return [];
  const hits = [];
  pageTexts.forEach((pageText) => {
    const text = String(pageText.text || "").toLowerCase();
    let startIndex = 0;
    while (startIndex <= text.length - keyword.length) {
      const index = text.indexOf(keyword, startIndex);
      if (index < 0) break;
      hits.push({ page: pageText.page || 1, index });
      startIndex = index + Math.max(1, keyword.length);
    }
  });
  return hits;
}

async function resolveAuditPdfOutlinePage(pdfDocument, dest) {
  try {
    const destination = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest;
    if (!Array.isArray(destination) || !destination[0]) return null;
    const pageIndex = await pdfDocument.getPageIndex(destination[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function flattenAuditPdfOutline(pdfDocument) {
  const outline = await pdfDocument.getOutline();
  if (!outline?.length) return [];
  const nodes = [];
  let order = 0;

  async function visit(items, level) {
    for (const item of items) {
      order += 1;
      nodes.push({
        id: `pdf-outline-${order}`,
        title: String(item.title || `第 ${order} 项`),
        page: await resolveAuditPdfOutlinePage(pdfDocument, item.dest),
        level: Math.max(0, level - 1),
        index: order,
      });
      if (item.items?.length) {
        await visit(item.items, level + 1);
      }
    }
  }

  await visit(outline, 1);
  return nodes.filter((item) => item.page);
}

function flashAuditPdfPage(host, pageNumber) {
  const page = getAuditPdfPageElement(host, pageNumber);
  if (!page) return;
  gsap.fromTo(page, { autoAlpha: 0.84 }, { autoAlpha: 1, duration: 0.22, ease: "power1.out" });
}

function resolveVisibleAuditPdfPage(host) {
  const scrollContainer = getAuditPdfScrollContainer(host);
  const pages = [...(host?.querySelectorAll(".pdfViewer .page") ?? [])];
  if (!scrollContainer || pages.length === 0) return 1;

  const containerRect = scrollContainer.getBoundingClientRect();
  const anchorY = containerRect.top + Math.min(180, containerRect.height * 0.35);
  const best = pages
    .map((page, index) => {
      const rect = page.getBoundingClientRect();
      const distance = rect.top <= anchorY && rect.bottom >= anchorY ? 0 : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
      return { page: Number(page.dataset.pageNumber) || index + 1, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return best?.page || 1;
}

export {
  AuditPdfHighlighter,
  AuditPdfPreview,
  collectPdfPageTexts,
  flashAuditPdfPage,
  flattenAuditPdfOutline,
  getAuditPdfPageElement,
  getAuditPdfScrollContainer,
  getAuditPdfSearchHits,
  resolveAuditPdfOutlinePage,
  resolveVisibleAuditPdfPage,
  scrollAuditPdfToPage,
};

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileSearch, X } from "lucide-react";
import { Highlight, PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PreviewState } from "../docx/fill/FieldControls.jsx";

function buildKnowledgeHighlightQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function KnowledgeSourcePreviewModal({ blob, page, highlightText, onClose }) {
  const pdfUrl = useMemo(() => URL.createObjectURL(blob), [blob]);
  const query = useMemo(() => buildKnowledgeHighlightQuery(highlightText), [highlightText]);

  useEffect(() => () => URL.revokeObjectURL(pdfUrl), [pdfUrl]);
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="knowledge-source-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="knowledge-source-modal" role="dialog" aria-modal="true" aria-label="知识库原文 PDF">
        <header>
          <div>
            <FileSearch size={18} />
            <strong>原文溯源</strong>
            <span>第 {page} 页</span>
          </div>
          <button className="icon-button quiet" type="button" aria-label="关闭原文预览" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <PdfLoader url={pdfUrl} workerSrc={pdfWorkerUrl} beforeLoad={<PreviewState state="loading" />} errorMessage={<PreviewState state="error" />}>
          {(pdfDocument) => <KnowledgeSourcePdfViewer pdfDocument={pdfDocument} page={page} query={query} />}
        </PdfLoader>
      </section>
    </div>,
    document.body,
  );
}

function KnowledgeSourcePdfViewer({ pdfDocument, page, query }) {
  const scrollToRef = useRef(null);
  const [highlights, setHighlights] = useState([]);
  const [matchCount, setMatchCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    buildKnowledgePdfHighlights(pdfDocument, page, query)
      .then((result) => {
        if (cancelled) return;
        setHighlights([result.highlight || result.pageAnchor]);
        setMatchCount(result.highlight ? 1 : 0);
      })
      .catch(() => {
        if (!cancelled) setMatchCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, page, query]);

  useEffect(() => {
    if (highlights.length === 0 || !scrollToRef.current) return;
    const frame = requestAnimationFrame(() => scrollToRef.current?.(highlights[0]));
    return () => cancelAnimationFrame(frame);
  }, [highlights]);

  return (
    <div className="knowledge-source-pdf-shell">
      <div className={matchCount > 0 ? "knowledge-source-match-status found" : "knowledge-source-match-status"}>
        {matchCount == null ? "正在定位引用原文..." : matchCount > 0 ? `已高亮 ${matchCount} 处引用原文` : "当前引用未找到完整文本，已定位到来源页"}
      </div>
      <div className="knowledge-source-pdf-container">
        {highlights.length > 0 ? (
          <PdfHighlighter
            pdfDocument={pdfDocument}
            pdfScaleValue="page-width"
            highlights={highlights}
            onScrollChange={() => {}}
            scrollRef={(scrollTo) => {
              scrollToRef.current = scrollTo;
            }}
            highlightTransform={(highlight, _index, _setTip, _hideTip, _viewportToScaled, _screenshot, isScrolledTo) => (
              highlight.id === "source-page-anchor" ? null : <Highlight key={highlight.id} position={highlight.position} isScrolledTo={isScrolledTo} />
            )}
            onSelectionFinished={() => null}
            enableAreaSelection={() => false}
          />
        ) : <PreviewState state="loading" />}
      </div>
    </div>
  );
}

async function buildKnowledgePdfHighlights(pdfDocument, requestedPage, query) {
  const pageNumber = Math.min(pdfDocument.numPages || 1, Math.max(1, Number(requestedPage) || 1));
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageAnchor = createKnowledgeHighlight("source-page-anchor", pageNumber, [{
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    width: viewport.width,
    height: viewport.height,
    pageNumber,
  }], "");
  if (!query) return { highlight: null, pageAnchor };

  const content = await page.getTextContent();
  const segments = [];
  let pageText = "";
  content.items.forEach((item) => {
    const text = String(item.str || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    if (pageText) pageText += " ";
    const start = pageText.length;
    pageText += text;
    segments.push({ item, text, start, end: pageText.length });
  });
  const start = pageText.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return { highlight: null, pageAnchor };
  const end = start + query.length;
  const rects = segments
    .filter((segment) => segment.end > start && segment.start < end)
    .map((segment) => createTextItemHighlightRect(segment, start, end, viewport, pageNumber))
    .filter(Boolean);
  return {
    highlight: rects.length ? createKnowledgeHighlight("source-citation", pageNumber, rects, query) : null,
    pageAnchor,
  };
}

function createTextItemHighlightRect(segment, matchStart, matchEnd, viewport, pageNumber) {
  const item = segment.item;
  const transform = multiplyPdfMatrices(viewport.transform, item.transform);
  const height = Math.max(1, Math.hypot(transform[2], transform[3]) || Number(item.height || 0));
  const width = Math.max(1, Number(item.width || 0) * viewport.scale);
  const relativeStart = Math.max(0, matchStart - segment.start) / segment.text.length;
  const relativeEnd = Math.min(segment.text.length, matchEnd - segment.start) / segment.text.length;
  return {
    x1: transform[4] + width * relativeStart,
    y1: transform[5] - height,
    x2: transform[4] + width * relativeEnd,
    y2: transform[5],
    width: viewport.width,
    height: viewport.height,
    pageNumber,
  };
}

function multiplyPdfMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function createKnowledgeHighlight(id, pageNumber, rects, text) {
  const x1 = Math.min(...rects.map((rect) => rect.x1));
  const y1 = Math.min(...rects.map((rect) => rect.y1));
  const x2 = Math.max(...rects.map((rect) => rect.x2));
  const y2 = Math.max(...rects.map((rect) => rect.y2));
  return {
    id,
    content: { text },
    comment: { text: "", emoji: "" },
    position: {
      pageNumber,
      boundingRect: { ...rects[0], x1, y1, x2, y2 },
      rects,
    },
  };
}

export { buildKnowledgeHighlightQuery };
export default KnowledgeSourcePreviewModal;

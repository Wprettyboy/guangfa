import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import useApiAssetUrl from "../../hooks/useApiAssetUrl.js";
import { createMinerUEvidenceHighlight, createMinerUPageAnchor } from "./pdfEvidenceHighlight.js";

function KnowledgePdfEvidenceViewer({ documentId, page, bbox, documentName, sourceText, onClose }) {
  const asset = useApiAssetUrl(
    documentId ? `/api/knowledge-documents/${encodeURIComponent(documentId)}/source-pdf` : "",
    "原文 PDF 读取失败",
  );
  const highlight = useMemo(
    () => createMinerUEvidenceHighlight({ page, bbox, text: sourceText }),
    [page, bbox, sourceText],
  );
  const scrollTarget = useMemo(() => highlight || createMinerUPageAnchor(page), [highlight, page]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="knowledge-table-backdrop knowledge-pdf-evidence-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="knowledge-pdf-evidence-modal"
        role="dialog"
        aria-modal="true"
        aria-label="原文 PDF 证据"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="knowledge-pdf-evidence-header">
          <div>
            <strong>{documentName || "原文 PDF"}</strong>
            <span>第{page}页 · {highlight ? "已按解析区域高亮" : "该结果没有可用解析区域，仅定位到页"}</span>
          </div>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭原文 PDF" title="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="knowledge-pdf-evidence-body">
          {asset.loading ? <div className="knowledge-source-viewer-status"><Loader2 size={18} className="spin" />正在加载原文 PDF</div> : null}
          {asset.error ? <div className="knowledge-source-viewer-status error">{asset.error}</div> : null}
          {asset.url ? (
            <KnowledgePdfEvidenceDocument url={asset.url} highlight={highlight} scrollTarget={scrollTarget} />
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function KnowledgePdfEvidenceDocument({ url, highlight, scrollTarget }) {
  const highlights = useMemo(() => (highlight ? [highlight] : []), [highlight]);
  return (
    <PdfLoader
      url={url}
      workerSrc={pdfWorkerUrl}
      beforeLoad={<div className="knowledge-source-viewer-status"><Loader2 size={18} className="spin" />正在解析原文 PDF</div>}
      errorMessage={<div className="knowledge-source-viewer-status error">原文 PDF 渲染失败</div>}
    >
      {(pdfDocument) => (
        <KnowledgePdfEvidenceHighlighter pdfDocument={pdfDocument} highlights={highlights} scrollTarget={scrollTarget} />
      )}
    </PdfLoader>
  );
}

function KnowledgePdfEvidenceHighlighter({ pdfDocument, highlights, scrollTarget }) {
  const scrolledRef = useRef(false);

  useEffect(() => {
    scrolledRef.current = false;
  }, [pdfDocument, scrollTarget]);

  return (
    <div className="knowledge-pdf-evidence-viewer">
      <PdfHighlighter
        pdfDocument={pdfDocument}
        pdfScaleValue="page-width"
        highlights={highlights}
        onScrollChange={() => {}}
        scrollRef={(scrollTo) => {
          // PdfHighlighter 在文档就绪时回调；只在首次定位，之后不抢用户滚动。
          if (!scrollTarget || scrolledRef.current) return;
          const pageCount = pdfDocument?.numPages || 0;
          if (scrollTarget.position.pageNumber > pageCount) return;
          scrolledRef.current = true;
          scrollTo(scrollTarget);
        }}
        highlightTransform={(viewportHighlight) => <KnowledgeEvidenceRect position={viewportHighlight.position} />}
        onSelectionFinished={() => null}
        enableAreaSelection={() => false}
      />
    </div>
  );
}

function KnowledgeEvidenceRect({ position }) {
  const rects = position.rects?.length ? position.rects : [position.boundingRect];
  return (
    <div className="knowledge-pdf-evidence-highlight">
      {rects.map((rect, index) => (
        <div
          className="knowledge-pdf-evidence-highlight-part"
          key={`evidence-rect-${index}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}

export default KnowledgePdfEvidenceViewer;

import React, { useEffect, useMemo, useRef, useState } from "react";

import gsap from "gsap";

import { renderAsync } from "docx-preview";

import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck2,
  Search,
} from "lucide-react";

import {
  getTemplateFieldSourceText,
} from "../../utils/fields.js";

import {
  PreviewState,
} from "./fill/FieldControls.jsx";

import {
  applyFillPreviewValues,
} from "./fill/previewAndExport.js";

import {
  OnlyOfficePreview,
  readOnlyOfficePageNumber,
} from "./office/bridge.jsx";

import {
  AuditPdfPreview,
  flashAuditPdfPage,
  getAuditPdfSearchHits,
  resolveVisibleAuditPdfPage,
  scrollAuditPdfToPage,
} from "./preview/pdfAuditPreview.jsx";

import {
  clampNumber,
  getPreviewPageElement,
  getRenderedPageCount,
  isPreviewPageMostlyVisible,
  normalizePreviewPageLayout,
  preparePreviewPages,
  resolvePreviewPage,
  resolveVisiblePreviewPage,
  scrollPreviewToElement,
  scrollPreviewToPage,
} from "./preview/pageLayout.js";

import {
  extractOutlineItems,
  getSearchHits,
  highlightSearchMatches,
  setActiveSearchHit,
  syncRenderedTocEntries,
} from "./preview/outlineSearch.js";

import {
  applyPreviewMarker,
  createAnnotationMarkerData,
  restoreAnnotationPreviewMarkers,
} from "./annotate/markers.js";

import {
  readDocxOutlineItems,
} from "./structure/docxStructure.js";



function createPreviewId(prefix = "doc") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function getFillFieldDisplayPage(field, fieldPageMap = {}, hasDynamicFieldPages = false) {
  const mappedPage = hasDynamicFieldPages ? Number(fieldPageMap[field.id]) : 0;
  return Number.isFinite(mappedPage) && mappedPage > 0 ? mappedPage : field.inputPoint?.page || field.page || 1;
}

function DocumentFrame({
  mode,
  templateFile,
  annotationFields = [],
  fillFields = [],
  selectedTemplateFieldId,
  selectedFieldId,
  brushActive,
  currentPage = 1,
  onSlotClick,
  onSelectField,
  onPageChange,
  onFieldPagesChange,
  onUploadClick,
  onInputPointCaptured,
  onOpenPlaceholderPanel,
  onOpenComplexFillPanel,
  onOpenSolutionWritingPanel,
  onOfficeOutlineChange,
  onOfficeDocumentReady,
  aiKnowledgeContext,
  trackRevisionsEnabled = false,
}) {
  const title = templateFile?.name ?? "未加载模板";
  const bodyRef = useRef(null);
  const canvasRef = useRef(null);
  const styleRef = useRef(null);
  const pdfUrlRef = useRef("");
  const auditPreviewRequestRef = useRef(0);
  const auditPdfPageTextsRef = useRef([]);
  const auditPdfOutlineRef = useRef([]);
  const auditPdfSearchHitsRef = useRef([]);
  const lastBrushAtRef = useRef(0);
  const [officePreview, setOfficePreview] = useState(null);
  const [localPage, setLocalPage] = useState(currentPage);
  const [renderState, setRenderState] = useState(templateFile?.buffer ? "loading" : "empty");
  const [pdfUrl, setPdfUrl] = useState("");
  const [outlineItems, setOutlineItems] = useState([]);
  const [outlineWidth, setOutlineWidth] = useState(170);
  const [pageCount, setPageCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [zoomPercent, setZoomPercent] = useState(100);
  const isAuditPdfMode = mode === "audit";
  const isOfficeMode = mode === "audit" || mode === "annotate" || mode === "fill" || mode === "layout";
  const canRenderDocx = Boolean(templateFile?.buffer);
  const isReady = renderState === "ready";
  const activePage = onPageChange ? currentPage : localPage;
  const activePageRef = useRef(activePage);
  const stablePreviewId = templateFile?.previewId || [templateFile?.name || "", templateFile?.uploadedAt || "", templateFile?.size || "", templateFile?.buffer?.byteLength || 0].join("|");
  const officeReloadBufferKey = mode === "fill" ? Boolean(templateFile?.buffer) : templateFile?.buffer;
  const previewIdentity = useMemo(
    () =>
      mode === "fill"
        ? [mode, stablePreviewId, templateFile?.supported === false ? "unsupported" : "supported"].join("|")
        : [
            mode,
            templateFile?.previewId || "",
            templateFile?.name || "",
            templateFile?.size || "",
            templateFile?.uploadedAt || "",
            templateFile?.buffer?.byteLength || 0,
            templateFile?.supported === false ? "unsupported" : "supported",
          ].join("|"),
    [mode, stablePreviewId, templateFile?.previewId, templateFile?.name, templateFile?.size, templateFile?.uploadedAt, templateFile?.buffer, templateFile?.supported],
  );
  const activeOfficePreview = officePreview?.previewIdentity === previewIdentity ? officePreview : null;
  const visibleAnnotationFields = annotationFields.filter((field) => (field.page || 1) === activePage);
  const confirmedFillFields = fillFields.filter((field) => field.value);

  function releasePdfUrlLater(url) {
    if (!url) return;
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  function setActivePage(pageNumber) {
    if (onPageChange) {
      onPageChange(pageNumber);
    } else {
      setLocalPage(pageNumber);
    }
  }

  useEffect(() => {
    if (!isOfficeMode) return;

    onOfficeDocumentReady?.("");
    if (pdfUrlRef.current) {
      releasePdfUrlLater(pdfUrlRef.current);
      pdfUrlRef.current = "";
    }
    setOfficePreview(null);
    setPdfUrl("");
    setOutlineItems([]);
    setPageCount(0);
    setPageInput("1");
    setActivePage(1);
    auditPdfPageTextsRef.current = [];
    auditPdfOutlineRef.current = [];
    auditPdfSearchHitsRef.current = [];
    setSearchCount(0);
    setSearchIndex(0);

    if (!templateFile?.buffer) {
      setRenderState(templateFile && templateFile.supported === false ? "unsupported" : "empty");
      return;
    }

    let cancelled = false;
    const requestId = auditPreviewRequestRef.current + 1;
    auditPreviewRequestRef.current = requestId;
    const sourceBuffer = templateFile.buffer.slice(0);
    const officeBufferPromise = Promise.resolve(sourceBuffer.slice(0));
    setRenderState("loading");

    const officeParams = new URLSearchParams({
      title: templateFile.name || "document.docx",
      previewId: templateFile.previewId || "",
    });
    officeBufferPromise
      .then((officeBuffer) =>
        fetch(`/api/office/documents?${officeParams.toString()}`, {
          method: "POST",
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          body: officeBuffer,
        }),
      )
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "OnlyOffice 文档初始化失败");
        return data;
      })
      .then((data) => {
        if (cancelled || requestId !== auditPreviewRequestRef.current) return;
        if (data.available && data.config && data.serverUrl) {
          setOfficePreview({ previewIdentity, config: data.config, serverUrl: data.serverUrl, id: data.id });
          onOfficeDocumentReady?.(data.id || "");
          return;
        }
        throw new Error("OnlyOffice 服务不可用");
      })
      .catch(() => {
        if (!cancelled && requestId === auditPreviewRequestRef.current) setRenderState("error");
      });

    return () => {
      cancelled = true;
      onOfficeDocumentReady?.("");
      if (pdfUrlRef.current) {
        releasePdfUrlLater(pdfUrlRef.current);
        pdfUrlRef.current = "";
      }
    };
  }, [isOfficeMode, mode, onOfficeDocumentReady, previewIdentity, officeReloadBufferKey, templateFile?.supported]);

  function refreshAuditPdfOutlinePages() {
    if (!isAuditPdfMode) return;
    setOutlineItems(auditPdfOutlineRef.current);
  }

  useEffect(() => {
    if (isOfficeMode) return;
    if (!bodyRef.current || !styleRef.current) return;
    bodyRef.current.innerHTML = "";
    styleRef.current.innerHTML = "";

    if (!templateFile?.buffer) {
      setRenderState(templateFile && templateFile.supported === false ? "unsupported" : "empty");
      setOutlineItems([]);
      setPageCount(0);
      setSearchCount(0);
      setSearchIndex(0);
      setPageInput("1");
      setActivePage(1);
      return;
    }

    let cancelled = false;
    const sourceBuffer = templateFile.buffer.slice(0);
    const previewBufferPromise = Promise.resolve(sourceBuffer.slice(0));
    const outlinePromise = readDocxOutlineItems(sourceBuffer.slice(0)).catch(() => []);
    setRenderState("loading");
    previewBufferPromise
      .then((previewBuffer) =>
        renderAsync(previewBuffer, bodyRef.current, styleRef.current, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
        }),
      )
      .then(() => {
        if (cancelled) return;
        setRenderState("ready");
        requestAnimationFrame(() => {
          (document.fonts?.ready ?? Promise.resolve()).finally(() => {
            requestAnimationFrame(() => {
              if (cancelled) return;
              outlinePromise.then((docxOutline) => {
                if (cancelled) return;
                syncRenderedTocEntries(bodyRef.current, docxOutline);
                normalizePreviewPageLayout(bodyRef.current);
                preparePreviewPages(bodyRef.current);
                const nextPageCount = Math.max(1, getRenderedPageCount(bodyRef.current));
                const nextPage = clampNumber(activePageRef.current || 1, 1, nextPageCount);
                setPageCount(nextPageCount);
                setPageInput(String(nextPage));
                setOutlineItems(extractOutlineItems(bodyRef.current, docxOutline));
                scrollPreviewToPage(canvasRef.current, nextPage, "auto");
                gsap.fromTo(
                  bodyRef.current?.querySelector(`.docx-wrapper > section[data-preview-page="${nextPage}"]`) ??
                    bodyRef.current?.querySelector(".docx-wrapper > section") ??
                    bodyRef.current,
                  { y: 12, autoAlpha: 0 },
                  { y: 0, autoAlpha: 1, duration: 0.35, ease: "power2.out" },
                );
              });
            });
          });
        });
      })
      .catch(() => {
        if (!cancelled) setRenderState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isOfficeMode, templateFile?.buffer, templateFile?.name, templateFile?.supported]);

  useEffect(() => {
    if (isOfficeMode) return;
    if (renderState !== "ready" || !bodyRef.current) return;
    const result = highlightSearchMatches(bodyRef.current, searchTerm);
    setSearchCount(result.count);
    const nextIndex = result.count > 0 ? 0 : 0;
    setSearchIndex(nextIndex);
    if (result.count > 0) {
      jumpToSearchHit(nextIndex, "auto", result.count);
    }
  }, [isOfficeMode, searchTerm, renderState]);

  useEffect(() => {
    if (!isAuditPdfMode) return;
    if (renderState !== "ready") {
      auditPdfSearchHitsRef.current = [];
      setSearchCount(0);
      setSearchIndex(0);
      return;
    }
    updateAuditPdfSearch(searchTerm);
  }, [isAuditPdfMode, searchTerm, renderState]);

  useEffect(() => {
    if (isOfficeMode) return;
    if (renderState !== "ready") return;
    const nextPage = clampNumber(activePage, 1, pageCount || 1);
    setPageInput(String(nextPage));
    if (bodyRef.current) preparePreviewPages(bodyRef.current);
    const visiblePage = getPreviewPageElement(bodyRef.current, nextPage);
    if (visiblePage && !isPreviewPageMostlyVisible(canvasRef.current, visiblePage)) {
      scrollPreviewToPage(canvasRef.current, nextPage, "smooth");
      gsap.fromTo(visiblePage, { autoAlpha: 0.82 }, { autoAlpha: 1, duration: 0.18, ease: "power1.out" });
    } else if (visiblePage) {
      gsap.fromTo(visiblePage, { autoAlpha: 0.82 }, { autoAlpha: 1, duration: 0.18, ease: "power1.out" });
    }
  }, [isAuditPdfMode, activePage, pageCount, renderState, mode, zoomPercent]);

  useEffect(() => {
    if (renderState !== "ready" || mode !== "fill" || !bodyRef.current) return;
    applyFillPreviewValues(bodyRef.current, confirmedFillFields);
  }, [confirmedFillFields, mode, renderState]);

  useEffect(() => {
    if (renderState !== "ready" || mode !== "annotate" || !bodyRef.current) return;
    restoreAnnotationPreviewMarkers(bodyRef.current, annotationFields, selectedTemplateFieldId, activePage);
  }, [activePage, annotationFields, mode, renderState, selectedTemplateFieldId]);

  useEffect(() => {
    if (mode !== "annotate" && mode !== "fill") return;
    function handleOfficeAnnotation(event) {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom") return;
      if (data.action === "onlyoffice-page-change") {
        const nextPage = readOnlyOfficePageNumber(data.page);
        if (nextPage > 0 && nextPage !== activePageRef.current) setActivePage(nextPage);
        return;
      }
      if (data.action === "onlyoffice-field-pages") {
        onFieldPagesChange?.(data.fieldPages?.pages || {});
        return;
      }
      if (data.action === "annotation-restore") {
        console.log("[annotate] annotation-restore", data.restore);
        return;
      }
      if (data.action === "input-point") {
        console.log("[onlyoffice-input-point]", data.result);
        onInputPointCaptured?.(data.result);
        return;
      }
      if (data.action === "open-placeholder-panel") {
        onOpenPlaceholderPanel?.();
        return;
      }
      if (data.action === "open-complex-fill-panel") {
        onOpenComplexFillPanel?.();
        return;
      }
      if (data.action === "open-solution-writing-panel") {
        onOpenSolutionWritingPanel?.();
        return;
      }
      if (data.action === "onlyoffice-outline-probe") {
        onOfficeOutlineChange?.(data.outline);
        return;
      }
      if (data.action === "field-bookmark" || data.action === "field-fill") {
        console.log("[onlyoffice-field]", data.action, data.result);
        return;
      }
      if (mode !== "annotate") return;
      if (data.action !== "annotate-selection") return;
      console.log("[annotate] onlyoffice-selection", data.selection);
      const selectedText = String(data.selection?.text || "").replace(/\s+/g, " ").trim();
      if (!selectedText) {
        window.alert(data.selection?.error || "请先在 zl办公 中选中文字，再点击标注字段。");
        return;
      }
      if (data.selection?.highlight && data.selection.highlight.ok === false) {
        window.alert(data.selection.highlight.error || "字段已记录，但 zl办公 高亮失败。");
      }
      const selectionPage = Number(data.selection?.page || activePageRef.current || 1);
      if (selectionPage > 0 && selectionPage !== activePageRef.current) setActivePage(selectionPage);
      onSlotClick?.({
        text: selectedText,
        page: selectionPage || 1,
        officeDocId: activeOfficePreview?.id || "",
        path: "zl办公选区",
        marker: {
          kind: "office-selection",
          text: selectedText.slice(0, 500),
          source: data.selection?.source || "onlyoffice",
          selectionState: data.selection?.selectionState || null,
        },
      });
    }
    window.addEventListener("message", handleOfficeAnnotation);
    return () => window.removeEventListener("message", handleOfficeAnnotation);
  }, [activeOfficePreview?.id, mode, onFieldPagesChange, onInputPointCaptured, onOfficeOutlineChange, onOpenComplexFillPanel, onOpenPlaceholderPanel, onOpenSolutionWritingPanel, onSlotClick]);

  function jumpToPage(pageNumber) {
    if (!isReady) return;
    const nextPage = clampNumber(pageNumber, 1, pageCount || 1);
    setActivePage(nextPage);
    setPageInput(String(nextPage));
    if (isAuditPdfMode) {
      requestAnimationFrame(() => scrollAuditPdfToPage(canvasRef.current, nextPage));
    }
  }

  function jumpToOutline(item) {
    if (!isReady) return;
    if (isAuditPdfMode) {
      jumpToPage(item.page || 1);
      requestAnimationFrame(() => flashAuditPdfPage(canvasRef.current, item.page || 1));
      return;
    }
    if (!bodyRef.current) return;
    const target = bodyRef.current.querySelector(`[data-outline-id="${item.id}"]`);
    const page = target ? resolvePreviewPage(target, bodyRef.current) : item.page;
    jumpToPage(page);
    if (!target) return;
    requestAnimationFrame(() => {
      scrollPreviewToElement(canvasRef.current, target, "auto");
      gsap.fromTo(target, { backgroundColor: "rgba(15, 99, 233, 0.14)" }, { backgroundColor: "transparent", duration: 0.65 });
    });
  }

  function handlePageSubmit(event) {
    event.preventDefault();
    jumpToPage(Number(pageInput));
  }

  function changePage(delta) {
    jumpToPage(activePage + delta);
  }

  function jumpToSearchHit(nextIndex, behavior = "smooth", countOverride = searchCount) {
    if (isAuditPdfMode) {
      if (!isReady || countOverride <= 0) return;
      const hits = auditPdfSearchHitsRef.current;
      if (hits.length === 0) return;
      const normalizedIndex = ((nextIndex % hits.length) + hits.length) % hits.length;
      const target = hits[normalizedIndex];
      setSearchIndex(normalizedIndex);
      setActivePage(target.page);
      setPageInput(String(target.page));
      requestAnimationFrame(() => {
        scrollAuditPdfToPage(canvasRef.current, target.page, behavior);
        flashAuditPdfPage(canvasRef.current, target.page);
      });
      return;
    }
    if (!isReady || !bodyRef.current || countOverride <= 0) return;
    const hits = getSearchHits(bodyRef.current);
    if (hits.length === 0) return;
    const normalizedIndex = ((nextIndex % hits.length) + hits.length) % hits.length;
    const target = setActiveSearchHit(bodyRef.current, normalizedIndex);
    if (!target) return;
    const page = resolvePreviewPage(target, bodyRef.current);
    setSearchIndex(normalizedIndex);
    setActivePage(page);
    setPageInput(String(page));
    requestAnimationFrame(() => {
      scrollPreviewToElement(canvasRef.current, target, behavior);
    });
  }

  function changeSearchHit(delta) {
    jumpToSearchHit(searchIndex + delta);
  }

  function updateAuditPdfSearch(term) {
    const hits = getAuditPdfSearchHits(auditPdfPageTextsRef.current, term);
    auditPdfSearchHitsRef.current = hits;
    setSearchCount(hits.length);
    setSearchIndex(0);
    if (hits.length > 0) {
      const firstHit = hits[0];
      setActivePage(firstHit.page);
      setPageInput(String(firstHit.page));
      requestAnimationFrame(() => {
        scrollAuditPdfToPage(canvasRef.current, firstHit.page, "auto");
        flashAuditPdfPage(canvasRef.current, firstHit.page);
      });
    }
  }

  function syncPageFromScroll() {
    if (!isReady || !canvasRef.current) return;
    const page = isAuditPdfMode
      ? resolveVisibleAuditPdfPage(canvasRef.current)
      : resolveVisiblePreviewPage(canvasRef.current, bodyRef.current);
    if (!page || page === activePageRef.current) return;
    setActivePage(page);
    setPageInput(String(page));
  }

  function startOutlineResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = outlineWidth;

    function handleMove(moveEvent) {
      const nextWidth = clampNumber(startWidth + moveEvent.clientX - startX, 150, 360);
      setOutlineWidth(nextWidth);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("is-resizing-outline");
    }

    document.body.classList.add("is-resizing-outline");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function resizeOutlineByKeyboard(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 12;
    setOutlineWidth((width) => clampNumber(width + (event.key === "ArrowRight" ? step : -step), 150, 360));
  }

  function markFromPreview(event) {
    if (!canRenderDocx || !brushActive || mode !== "annotate") return;
    if (event?.target?.closest?.(".preview-mark-list, button")) return;
    const now = Date.now();
    if (now - lastBrushAtRef.current < 250) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    const eventTarget = event?.target;
    const anchorNode =
      selectedText && selection?.anchorNode
        ? selection.anchorNode
        : eventTarget?.nodeType === 1
          ? eventTarget
          : eventTarget?.parentElement;
    const container = bodyRef.current;
    const insidePreview = anchorNode && container?.contains(anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement);
    if (!insidePreview) return;

    const fallbackText =
      selectedText ||
      (insidePreview
        ? anchorNode?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)
        : "");
    const marker = createAnnotationMarkerData({
      container,
      selection,
      anchorNode,
      text: fallbackText,
      page: resolvePreviewPage(anchorNode, container),
    });

    const fieldId = onSlotClick?.({
      text: fallbackText,
      page: marker?.page ?? resolvePreviewPage(anchorNode, container),
      path: selectedText ? "文档选区" : "文档点击位置",
      marker,
    });
    if (fieldId) {
      lastBrushAtRef.current = now;
      applyPreviewMarker({
        fieldId,
        container,
        selection,
        anchorNode,
        text: fallbackText,
      });
    }
  }

  function markSelectionOnMouseUp(event) {
    if (!brushActive || mode !== "annotate") return;
    const selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
    if (selectedText) markFromPreview(event);
  }

  if (isOfficeMode) {
    return (
      <div className={`document-frame audit-office-frame ${activeOfficePreview ? "" : "empty-preview-frame"}`}>
        {activeOfficePreview ? (
          <OnlyOfficePreview
            key={`${activeOfficePreview.previewIdentity}|office|${activeOfficePreview.config?.document?.key || ""}`}
            config={activeOfficePreview.config}
            annotationFields={annotationFields}
            fillFields={fillFields}
            aiKnowledgeContext={aiKnowledgeContext}
            trackRevisionsEnabled={trackRevisionsEnabled}
            mode={mode}
            serverUrl={activeOfficePreview.serverUrl}
            onReady={() => setRenderState("ready")}
            onError={() => setRenderState("error")}
          />
        ) : (
          <PreviewState state={renderState} onUploadClick={onUploadClick} />
        )}
      </div>
    );
  }

  return (
    <div className={mode === "annotate" ? "document-frame annotate-frame" : "document-frame fill-frame"}>
      <div className="document-toolbar">
        <div className="doc-file">
          <FileCheck2 size={18} />
          {title}
        </div>
        <div className="doc-search">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                changeSearchHit(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="搜索文档"
            disabled={!isReady}
          />
          {searchTerm ? <em>{searchCount > 0 ? `${searchIndex + 1}/${searchCount}` : "0"}</em> : null}
          {searchTerm ? (
            <div className="search-nav">
              <button
                className="icon-button quiet"
                type="button"
                aria-label="上一处搜索结果"
                onClick={() => changeSearchHit(-1)}
                disabled={!isReady || searchCount === 0}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button quiet"
                type="button"
                aria-label="下一处搜索结果"
                onClick={() => changeSearchHit(1)}
                disabled={!isReady || searchCount === 0}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}
        </div>
        <form className="page-pager" onSubmit={handlePageSubmit}>
          <button
            className="icon-button quiet"
            type="button"
            aria-label="上一页"
            onClick={() => changePage(-1)}
            disabled={!isReady || activePage <= 1}
          >
            <ChevronLeft size={17} />
          </button>
          <span>页</span>
          <input
            value={pageInput}
            onChange={(event) => {
              const nextValue = event.target.value.replace(/\D/g, "");
              setPageInput(nextValue);
              if (nextValue) {
                jumpToPage(Number(nextValue));
              }
            }}
            disabled={!isReady}
            aria-label="页码"
          />
          <span>/ {pageCount || "--"}</span>
          <button
            className="icon-button quiet"
            type="button"
            aria-label="下一页"
            onClick={() => changePage(1)}
            disabled={!isReady || activePage >= pageCount}
          >
            <ChevronRight size={17} />
          </button>
        </form>
        <select
          className="zoom"
          value={zoomPercent}
          onChange={(event) => setZoomPercent(Number(event.target.value))}
          disabled={!isReady}
          aria-label="缩放比例"
        >
          {[50, 75, 90, 100, 110, 125, 150, 200].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
        <button className="ghost-button compact">
          <Eye size={16} />
          标注显示
        </button>
      </div>

      <div className="preview-layout" style={{ "--outline-width": `${outlineWidth}px` }}>
        <aside className="outline-panel">
          <div className="outline-head">
            <strong>大纲</strong>
            <span>{outlineItems.length} 项</span>
          </div>
          <div className="outline-list">
            {outlineItems.length === 0 ? (
              <div className="outline-empty">暂无大纲</div>
            ) : (
              outlineItems.map((item) => (
                <button key={item.id} onClick={() => jumpToOutline(item)} style={{ "--outline-depth": Math.min(item.level || 0, 6) }}>
                  <span>{item.title}</span>
                  <em>P{item.page}</em>
                </button>
              ))
            )}
          </div>
          <div
            className="outline-resizer"
            onPointerDown={startOutlineResize}
            onKeyDown={resizeOutlineByKeyboard}
            role="separator"
            aria-label="调整大纲宽度"
            aria-orientation="vertical"
            tabIndex={0}
            title="拖动调整大纲宽度"
          />
        </aside>
        <div
          className={`page-canvas ${renderState !== "ready" && !officePreview && !pdfUrl ? "empty-preview-canvas" : ""}`}
          ref={canvasRef}
          onScroll={syncPageFromScroll}
        >
        {isAuditPdfMode ? (
          officePreview ? (
            <OnlyOfficePreview
              key={`${previewIdentity}|office|${officePreview.config?.document?.key || ""}`}
              config={officePreview.config}
              serverUrl={officePreview.serverUrl}
              onReady={() => {
                setPageCount(1);
                setPageInput("1");
                setRenderState("ready");
              }}
              onError={() => {
                setOfficePreview(null);
                setRenderState("error");
              }}
            />
          ) : pdfUrl ? (
            <AuditPdfPreview
              key={`${previewIdentity}|${pdfUrl}`}
              pdfUrl={pdfUrl}
              previewIdentity={previewIdentity}
              zoomPercent={zoomPercent}
              onScrollChange={syncPageFromScroll}
              onTextReady={(pageTexts) => {
                auditPdfPageTextsRef.current = pageTexts;
                updateAuditPdfSearch(searchTerm);
                refreshAuditPdfOutlinePages();
              }}
              onOutlineReady={(pdfOutline) => {
                auditPdfOutlineRef.current = pdfOutline;
                setOutlineItems(pdfOutline);
              }}
              onReady={(nextPageCount) => {
                setPageCount(nextPageCount);
                const nextPage = clampNumber(activePageRef.current || 1, 1, nextPageCount || 1);
                setPageInput(String(nextPage));
                setRenderState("ready");
                requestAnimationFrame(() => {
                  scrollAuditPdfToPage(canvasRef.current, nextPage, "auto");
                  refreshAuditPdfOutlinePages();
                  window.setTimeout(refreshAuditPdfOutlinePages, 500);
                  window.setTimeout(refreshAuditPdfOutlinePages, 1400);
                });
              }}
              onError={() => setRenderState("error")}
            />
          ) : (
            <PreviewState state={renderState} onUploadClick={onUploadClick} />
          )
        ) : (
          <>
            <div className="docx-style-host" ref={styleRef} />
            {renderState !== "ready" ? <PreviewState state={renderState} onUploadClick={onUploadClick} /> : null}
            <div
              className={[
                "docx-preview-host",
                renderState === "ready" ? "ready" : "",
                brushActive && mode === "annotate" && renderState === "ready" ? "brush-mode" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--preview-zoom": `${zoomPercent}%` }}
              data-testid="docx-preview-host"
              onClick={markFromPreview}
              onMouseUp={markSelectionOnMouseUp}
              ref={bodyRef}
            />
            {mode === "annotate" && visibleAnnotationFields.length > 0 ? (
              <div className="preview-mark-list">
                {visibleAnnotationFields.map((field) => (
                  <button
                    className={[
                      "preview-chip",
                      field.id === selectedTemplateFieldId ? "active" : "",
                      field.status !== "已标注" ? "pending" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={field.id}
                    onClick={() => onSelectField?.(field.id)}
                  >
                    {getTemplateFieldSourceText(field) || field.name}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

export {
  createPreviewId,
  waitForNextFrame,
  getFillFieldDisplayPage,
  DocumentFrame,
};

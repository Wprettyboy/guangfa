import React, { useEffect, useMemo, useRef, useState } from "react";

import { renderAsync } from "docx-preview";

import JSZip from "jszip";

import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {

  Check,

  ChevronLeft,

  ChevronRight,

  CircleAlert,

  Database,

  Download,

  Eye,

  FileText,

  Highlighter,

  Info,

  Loader2,

  Search,

  Upload,

  Wand2,

  X,

} from "lucide-react";

import StatusPill from "../../components/StatusPill.jsx";

import { buildExportFileName, downloadDocxBuffer } from "../../utils/files.js";

import {

  canUseMarkedSelectionAsFillTarget,

  fieldCategoryOptions,

  getFieldDisplayText,

  getFillModeOptions,

  getTemplateFieldSourceText,

  hasFillBlank,

  hasInputPoint,

  inferFillMode,

  isReplacementField,

  normalizeFieldCategory,

  normalizeFillMode,

  requiresInputPoint,

} from "../../utils/fields.js";



function createPreviewId(prefix = "doc") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const auditConfigStorageKey = "format-audit-config";

const auditConfigItems = [
  { id: "page-margin", group: "页面版式", name: "页边距" },
  { id: "body-font", group: "基础文字", name: "正文字体" },
  { id: "body-size", group: "基础文字", name: "正文字号" },
  { id: "first-line-indent", group: "段落格式", name: "首行缩进" },
  { id: "line-spacing", group: "段落格式", name: "行距" },
  { id: "paragraph-spacing", group: "段落格式", name: "段前段后" },
  { id: "blank-lines", group: "段落格式", name: "空行" },
  { id: "body-outline", group: "标题体系", name: "正文误入标题（AI审查，脚本移出大纲）" },
  { id: "missing-heading-style", group: "标题体系", name: "标题未入大纲（AI审查，脚本套用标题层级）" },
  { id: "heading-level", group: "标题体系", name: "标题层级" },
  { id: "heading-visual-style", group: "标题体系", name: "标题字体字号" },
  { id: "split-heading", group: "标题体系", name: "标题拆分（合并被断开的标题段落）" },
  { id: "word-outline", group: "目录大纲", name: "Word 大纲（AI审查，脚本修正文档导航窗格层级）" },
  { id: "toc-items", group: "目录大纲", name: "目录项（按当前标题重建目录项）" },
];

const auditIssueConfigMap = {
  "section-normalize": ["page-margin"],
  "body-font-format": ["body-font"],
  "body-size-format": ["body-size"],
  "first-line-indent-format": ["first-line-indent"],
  "line-spacing-format": ["line-spacing"],
  "paragraph-spacing-format": ["paragraph-spacing"],
  "blank-lines-format": ["blank-lines"],
  "body-outline": ["body-outline"],
  "missing-heading-style": ["missing-heading-style"],
  "heading-level-format": ["heading-level"],
  "heading-visual-style-format": ["heading-visual-style"],
  "split-heading": ["split-heading"],
  "word-outline-format": ["word-outline"],
  "toc-items-format": ["toc-items"],
  "ai-body-outline": ["body-outline"],
  "ai-missing-heading-style": ["missing-heading-style"],
  "ai-word-outline-format": ["word-outline"],
};

const aiOutlineSourceIssueIds = new Set(["body-outline", "missing-heading-style", "word-outline-format"]);

const defaultAuditConfig = {
  version: 2,
  enabled: auditConfigItems.map((item) => item.id),
  params: {
    pageMarginTopMm: 37,
    pageMarginRightMm: 26,
    pageMarginBottomMm: 35,
    pageMarginLeftMm: 28,
    bodyFont: "仿宋",
    bodyFontSizePt: 16,
    firstLineChars: 2,
    lineSpacing: 1.5,
    paragraphBeforePt: 0,
    paragraphAfterPt: 0,
    headingLevel1Font: "小标宋",
    headingLevel1SizePt: 22,
    headingLevel2Font: "黑体",
    headingLevel2SizePt: 16,
    headingLevel3Font: "楷体",
    headingLevel3SizePt: 16,
  },
};

const emptyPdfHighlights = [];

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const XML_NS = "http://www.w3.org/XML/1998/namespace";

let aiRevisionId = 1000;

let fillBookmarkId = 50000;

let fillBookmarkNames = new Set();

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
  onOfficeDocumentReady,
  aiKnowledgeContext,
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
  const isOfficeMode = mode === "audit" || mode === "annotate" || mode === "fill";
  const canRenderDocx = Boolean(templateFile?.buffer);
  const isReady = renderState === "ready";
  const activePage = onPageChange ? currentPage : localPage;
  const activePageRef = useRef(activePage);
  const previewIdentity = useMemo(
    () =>
      [
        mode,
        templateFile?.previewId || "",
        templateFile?.name || "",
        templateFile?.size || "",
        templateFile?.uploadedAt || "",
        templateFile?.buffer?.byteLength || 0,
        templateFile?.supported === false ? "unsupported" : "supported",
      ].join("|"),
    [mode, templateFile?.previewId, templateFile?.name, templateFile?.size, templateFile?.uploadedAt, templateFile?.buffer, templateFile?.supported],
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
      onOfficeDocumentReady?.("");
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
      if (pdfUrlRef.current) {
        releasePdfUrlLater(pdfUrlRef.current);
        pdfUrlRef.current = "";
      }
    };
  }, [isOfficeMode, mode, onOfficeDocumentReady, previewIdentity, templateFile?.buffer, templateFile?.supported]);

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
  }, [activeOfficePreview?.id, mode, onFieldPagesChange, onInputPointCaptured, onSlotClick]);

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

function OnlyOfficePreview({ config, annotationFields = [], fillFields = [], aiKnowledgeContext = null, mode, serverUrl, onReady, onError }) {
  const containerRef = useRef(null);
  const holderIdRef = useRef(`onlyoffice-${Math.random().toString(36).slice(2)}`);
  const annotationFieldPayloadRef = useRef([]);
  const fillFieldPayloadRef = useRef([]);
  const aiKnowledgeContextRef = useRef(aiKnowledgeContext);

  useEffect(() => {
    annotationFieldPayloadRef.current = buildOnlyOfficeAnnotationFieldPayload(annotationFields);
  }, [annotationFields, mode]);

  useEffect(() => {
    fillFieldPayloadRef.current = buildOnlyOfficeFillFieldPayload(fillFields);
    if (mode === "fill") {
      postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "sync-fill-fields",
        fields: fillFieldPayloadRef.current,
      }, 2);
    }
  }, [fillFields, mode]);

  useEffect(() => {
    aiKnowledgeContextRef.current = aiKnowledgeContext;
    if (mode === "fill") {
      postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "sync-ai-knowledge-context",
        context: aiKnowledgeContext,
      }, 2);
    }
  }, [aiKnowledgeContext, mode]);

  useEffect(() => {
    let cancelled = false;
    let editor = null;
    const container = containerRef.current;
    if (!container) return undefined;

    container.replaceChildren();
    const holder = document.createElement("div");
    holder.id = holderIdRef.current;
    holder.style.width = "100%";
    holder.style.height = "100%";
    container.append(holder);

    loadOnlyOfficeApi(serverUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI?.DocEditor) return;
        editor = new window.DocsAPI.DocEditor(holderIdRef.current, {
          ...config,
          width: "100%",
          height: "100%",
          events: {
            ...(config.events || {}),
            onAppReady: () => {
              config.events?.onAppReady?.();
              onReady?.();
              if (mode === "fill") {
                window.setTimeout(() => {
                  postOnlyOfficeCommand(container, { source: "guangfa-parent", action: "enable-track-revisions" });
                  postOnlyOfficeCommand(container, {
                    source: "guangfa-parent",
                    action: "sync-fill-fields",
                    fields: fillFieldPayloadRef.current,
                  });
                  postOnlyOfficeCommand(container, {
                    source: "guangfa-parent",
                    action: "sync-ai-knowledge-context",
                    context: aiKnowledgeContextRef.current,
                  });
                }, 350);
              }
            },
            onDocumentReady: () => {
              config.events?.onDocumentReady?.();
            },
            onDownloadAs: (event) => {
              config.events?.onDownloadAs?.(event);
              window.dispatchEvent(new CustomEvent("guangfa-onlyoffice-download-as", { detail: event?.data || {} }));
            },
            onError: () => onError?.(),
          },
        });
        window.__guangfaActiveOnlyOfficeEditor = editor;
      })
      .catch(() => onError?.());

    return () => {
      cancelled = true;
      if (window.__guangfaActiveOnlyOfficeEditor === editor) window.__guangfaActiveOnlyOfficeEditor = null;
      try {
        editor?.destroyEditor?.();
      } catch {}
      if (container.contains(holder)) container.removeChild(holder);
    };
  }, [config, serverUrl]);

  return <div className="onlyoffice-preview-host" ref={containerRef} />;
}

function buildOnlyOfficeAnnotationFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    name: getTemplateFieldSourceText(field) || field.name,
    page: field.page,
    marker: field.marker
      ? {
          text: field.marker.text || "",
        }
      : null,
  }));
}

function buildOnlyOfficeFillFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    bookmarkName: getFillTargetBookmarkName(field),
    name: getFieldDisplayText(field),
    category: normalizeFieldCategory(field.category || field.type),
    sourceText: getTemplateFieldSourceText(field),
    requiresInputPoint: requiresInputPoint(field),
    hasInputPoint: hasInputPoint(field),
    page: field.page,
    marker: field.marker?.text ? { text: field.marker.text } : null,
    answerFormat: field.answerFormat,
    question: field.question,
    value: field.value || "",
    amountValue: field.amountValue || "",
    choiceValue: field.choiceValue || "",
    fillMode: normalizeFillMode(field.fillMode, field),
    fillText: buildOnlyOfficeLiveFillText(field),
  }));
}

function postOnlyOfficeCommand(container, message, attempts = 8) {
  const frames = [...(container?.querySelectorAll?.("iframe") || [])];
  frames.forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
    } catch {}
  });
  if (attempts > 0) {
    window.setTimeout(() => postOnlyOfficeCommand(container, message, attempts - 1), 250);
  }
}

function requestOnlyOfficeDocumentSave(trigger = "manual") {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage({ source: "guangfa-parent", action: "save-document", trigger }, "*");
    } catch {}
  });
}

function requestOnlyOfficeAddFieldBookmark(field) {
  if (!field?.marker?.selectionState) return;
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "add-field-bookmark",
    field: {
      id: field.id,
      bookmarkName: getFillBookmarkName(field),
      selectionState: field.marker.selectionState,
    },
  });
}

function requestOnlyOfficeAddInputPoint(field) {
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "add-input-point",
    field: {
      id: field.id,
      bookmarkName: field.inputPoint?.bookmarkName || getInputPointBookmarkName(field),
    },
  });
}

function requestOnlyOfficeFillField(field) {
  if (!field?.value && !field?.choiceValue) return;
  if (requiresInputPoint(field) && !hasInputPoint(field)) {
    console.warn("[fill] skip write without input point", { id: field.id, sourceText: getTemplateFieldSourceText(field) });
    return;
  }
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "fill-field-value",
    field: {
      id: field.id,
      bookmarkName: getFillTargetBookmarkName(field),
      page: field.page,
      marker: field.marker?.text ? { text: field.marker.text } : null,
      name: getFieldDisplayText(field),
      category: normalizeFieldCategory(field.category || field.type),
      sourceText: getTemplateFieldSourceText(field),
      value: field.value,
      amountValue: field.amountValue || "",
      choiceValue: field.choiceValue || "",
      fillMode: normalizeFillMode(field.fillMode, field),
      fillText: buildOnlyOfficeLiveFillText(field),
    },
  }, 0);
}

function postAllOnlyOfficeFrames(message, attempts = 8) {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
    } catch {}
  });
  if (attempts > 0) window.setTimeout(() => postAllOnlyOfficeFrames(message, attempts - 1), 250);
}

function requestOnlyOfficeDocumentDownloadAs(fileType = "docx", timeoutMs = 20000) {
  const editor = window.__guangfaActiveOnlyOfficeEditor;
  if (!editor || typeof editor.downloadAs !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (buffer) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("guangfa-onlyoffice-download-as", handleDownloadAs);
      resolve(buffer || null);
    };
    const handleDownloadAs = async (event) => {
      const url = event.detail?.url;
      if (!url) return finish(null);
      try {
        finish(await fetchOnlyOfficeDownloadAsBuffer(url));
      } catch {
        finish(null);
      }
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("guangfa-onlyoffice-download-as", handleDownloadAs);
    try {
      editor.downloadAs(fileType);
    } catch {
      finish(null);
    }
  });
}

async function fetchOnlyOfficeDownloadAsBuffer(url) {
  const response = await fetch("/api/office/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return response.ok ? response.arrayBuffer() : null;
}

function buildOnlyOfficeLiveFillText(field = {}) {
  const value = getFieldAmountValue(field);
  if (!value) return "";
  if (hasInputPoint(field) && !isReplacementField(field)) return value;
  const source = getTemplateFieldSourceText(field);
  if (!source) return value;
  if (isDateField(field) && hasDateSegmentBlank(source)) return buildDateSegmentFillText(source, value) || source;
  if (/[□☐○〇▢☑✓✔]/.test(source)) return buildOnlyOfficeChoiceFillText(source, getFieldChoiceValue(field) || value);
  if (/[_＿—-]{2,}|\s{2,}/.test(source)) return source.replace(/_{2,}|＿+|—+|-{2,}|\s{2,}/, value);
  const quoteBlank = source.match(/^(.*?[“"])\s+([”"].*)$/);
  if (quoteBlank) return `${quoteBlank[1]}${value}${quoteBlank[2]}`;
  const punctBlank = source.match(/^(.*?[：:][^。；;，,）)]*?)\s+([。；;，,）)].*)$/);
  if (punctBlank) return `${punctBlank[1]}${value}${punctBlank[2]}`;
  const colonBlank = source.match(/^(.*?[：:])\s+(.*)$/);
  if (colonBlank) return `${colonBlank[1]}${value}${colonBlank[2]}`;
  if (/[：:]\s*$/.test(source)) return `${source}${value}`;
  return value;
}

function getFieldAmountValue(field = {}) {
  return String(field.amountValue || field.value || "").trim();
}

function getFieldChoiceValue(field = {}) {
  if (normalizeFillMode(field.fillMode, field) === "amount-choice") return String(field.choiceValue || "").trim();
  return String(field.choiceValue || field.value || "").trim();
}

function buildOnlyOfficeChoiceFillText(source, value) {
  const cleanValue = normalizeChoiceText(value);
  const base = source.replace(/[☑✓✔]/g, "□");
  const match = [...base.matchAll(/[□☐○〇▢]\s*([^□☐○〇▢☑✓✔]{1,80})/g)]
    .map((item) => ({ item, score: scoreChoiceOptionMatch(item[1], cleanValue) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || normalizeChoiceText(b.item[1]).length - normalizeChoiceText(a.item[1]).length)[0]?.item;
  return match ? `${base.slice(0, match.index)}☑${base.slice(match.index + 1)}` : value;
}

function scoreChoiceOptionMatch(optionText, normalizedValue) {
  const option = normalizeChoiceText(optionText);
  if (!option || !normalizedValue) return 0;
  if (option === normalizedValue) return 100;
  if (option.includes(normalizedValue)) return 90;
  if (normalizedValue.includes(option)) return 70;
  return 0;
}

function readOnlyOfficePageNumber(payload) {
  const value =
    typeof payload === "number" || typeof payload === "string"
      ? payload
      : payload?.page ?? payload?.currentPage ?? payload?.visiblePage ?? payload?.value;
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function loadOnlyOfficeApi(serverUrl) {
  const scriptUrl = `${String(serverUrl || "").replace(/\/$/, "")}/web-apps/apps/api/documents/api.js?gf=5`;
  const existing = [...document.scripts].find((script) => script.src === scriptUrl);
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

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

function FieldLine({ slot, field, mode, active, brushActive, onClick }) {
  const isAnnotate = mode === "annotate";
  const isMarked = Boolean(field);
  const tag = isAnnotate ? (isMarked ? "已标注" : brushActive ? "点击标注" : "未标注") : field?.status;
  const value = isAnnotate ? (isMarked ? `{{${getTemplateFieldSourceText(field) || field.name || slot.suggestedName}}}` : "") : field?.value ?? "";

  return (
    <button
      className={[
        "field-line",
        "doc-slot",
        active ? "active" : "",
        isMarked ? "marked" : "",
        isAnnotate && brushActive && !isMarked ? "brush-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={!isAnnotate}
      onClick={onClick}
      type="button"
    >
      <span>{slot.label}</span>
      <div className="blank-line">
        <strong>{value}</strong>
      </div>
      {tag ? <em>{tag}</em> : null}
    </button>
  );
}

function PreviewState({ state, onUploadClick }) {
  const meta = {
    empty: {
      icon: Upload,
      title: "请先上传 DOCX 模板",
      desc: "上传后在 OnlyOffice 中选中文字，点击定制组件里的标注字段。",
    },
    loading: {
      icon: Loader2,
      title: "正在加载文档预览",
      desc: "正在解析上传的 DOCX 模板。",
    },
    unsupported: {
      icon: CircleAlert,
      title: "暂不支持该文件格式",
      desc: "浏览器预览阶段请上传 .docx 文件；.doc 文件后续由后端转换后再支持。",
    },
    error: {
      icon: CircleAlert,
      title: "文档预览加载失败",
      desc: "请确认文件没有损坏，或换一个 DOCX 模板重试。",
    },
  };
  const current = meta[state] ?? meta.empty;
  const Icon = current.icon;
  const canUpload = state === "empty" && onUploadClick;

  return (
    <div
      className={`preview-state ${state} ${canUpload ? "clickable" : ""}`}
      onClick={canUpload ? onUploadClick : undefined}
      onKeyDown={
        canUpload
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") onUploadClick();
            }
          : undefined
      }
      role={canUpload ? "button" : undefined}
      tabIndex={canUpload ? 0 : undefined}
    >
      <Icon size={24} className={state === "loading" ? "spin" : ""} />
      <strong>{current.title}</strong>
      <span>{current.desc}</span>
      {canUpload ? (
        <button
          className="mini-button blue"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUploadClick();
          }}
        >
          <Upload size={15} />
          上传文档
        </button>
      ) : null}
    </div>
  );
}

function FieldForm({ field, onChange, onAddInputPoint }) {
  if (!field) {
    return (
      <div className="field-form empty-form">
        <Info size={20} />
        <span>在文档中选中文字并点击标注字段，或选择字段编辑</span>
      </div>
    );
  }

  function updateType(type) {
    const category = normalizeFieldCategory(type);
    onChange({ type: category, category, fillMode: inferFillMode({ ...field, category, type: category }) });
  }
  function updateFillMode(fillMode) {
    onChange({ fillMode });
  }
  const sourceText = getTemplateFieldSourceText(field);
  const category = normalizeFieldCategory(field.category || field.type);
  const fillMode = normalizeFillMode(field.fillMode, field);
  const modeOptions = getFillModeOptions({ ...field, category, type: category });
  const modeLabel = category === "单选项" ? "单选细分" : "填空类型";
  const hasInput = hasInputPoint(field);
  const usesMarkedSelectionTarget = !hasInput && canUseMarkedSelectionAsFillTarget(field);

  return (
    <div className="field-form">
      <div className="field-context">
        <span>模板选区原文</span>
        <p>{sourceText || "暂无选区上下文"}</p>
      </div>
      <div className="field-context input-point-context">
        <span>填写输入点</span>
        <p>{hasInput ? `已设置，第 ${field.inputPoint?.page || field.page || 1} 页` : isReplacementField(field) ? "单选项将使用标注选区作为写入范围" : usesMarkedSelectionTarget ? "将使用标注选区作为填写范围" : "未设置，请把光标放到实际填写位置后点击添加输入点"}</p>
      </div>
      <label>
        <span>自动填充类别</span>
        <select value={category} onChange={(event) => updateType(event.target.value)}>
          {fieldCategoryOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>{modeLabel}</span>
        <select value={fillMode} onChange={(event) => updateFillMode(event.target.value)}>
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="field-form-actions">
        <button className={hasInput ? "tool-button is-selected" : "tool-button"} type="button" onClick={onAddInputPoint}>
          <PenLine size={16} />
          {hasInput ? "重设输入点" : "添加输入点"}
        </button>
      </div>
    </div>
  );
}

function FillFieldRow({ field, index, selected, onSelect, onGenerate, generateDisabled, onUpdateValue, onConfirm }) {
  const rowRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(field.value || "");
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const choiceOptions = useMemo(() => getChoiceEditOptions(field), [field]);
  const isChoiceEditing = field.type === "单选项" && choiceOptions.length > 0;
  const isDateEditing = isDateField(field);
  const sourceSnippetText = String(field.sourceSnippetText || "").trim();
  const supplementReason = getFillSupplementReason(field);

  useEffect(() => {
    if (!editing) setDraftValue(field.value || "");
  }, [editing, field.value]);

  useEffect(() => {
    setSourceExpanded(false);
  }, [field.id, field.sourceSnippetText]);

  useGSAP(
    () => {
      if (!selected) return;
      gsap.fromTo(
        rowRef.current,
        { backgroundColor: "#eef5ff" },
        { backgroundColor: "#ffffff", duration: 0.7, ease: "power1.out" },
      );
    },
    { dependencies: [selected], scope: rowRef },
  );

  return (
    <div
      className={selected ? "field-row selected" : "field-row"}
      data-testid={`fill-row-${field.id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      ref={rowRef}
      role="button"
      tabIndex={0}
    >
      <div className="field-row-toolbar">
        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
          <StatusPill status={field.status} />
          {editing ? (
            <>
              <button
                className="mini-button blue"
                onClick={() => {
                  onUpdateValue(draftValue);
                  setEditing(false);
                }}
              >
                <Save size={15} />
                保存
              </button>
              <button
                className="mini-button"
                onClick={() => {
                  setDraftValue(field.value || "");
                  setEditing(false);
                }}
              >
                <X size={15} />
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="mini-button blue"
                data-testid={`generate-${field.id}`}
                onClick={onGenerate}
                disabled={generateDisabled || field.status === "生成中"}
              >
                {field.status === "生成中" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
                AI填充
              </button>
              <button
                className="mini-button"
                onClick={() => {
                  setDraftValue(field.value || "");
                  setEditing(true);
                }}
                disabled={field.status === "生成中"}
              >
                <PenLine size={15} />
                编辑
              </button>
              <button
                className="mini-button"
                data-testid={`confirm-${field.id}`}
                onClick={onConfirm}
                disabled={field.status === "已确认" || !field.value}
              >
                <Check size={15} />
                确认
              </button>
            </>
          )}
        </div>
      </div>
      <div className="field-card-head">
        <span className="row-index">{index + 1}</span>
        <strong title={getFieldDisplayText(field)}>{getFieldDisplayText(field)}</strong>
      </div>
      {editing ? (
        isChoiceEditing ? (
          <div className="field-choice-editor" onClick={(event) => event.stopPropagation()}>
            {choiceOptions.map((option) => {
              const active = normalizeChoiceText(option) === normalizeChoiceText(draftValue);
              return (
                <button
                  className={active ? "choice-edit-option selected" : "choice-edit-option"}
                  key={option}
                  type="button"
                  onClick={() => setDraftValue(option)}
                >
                  {active ? "☑" : "□"}
                  <span>{option}</span>
                </button>
              );
            })}
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="选中项文本"
            />
          </div>
        ) : isDateEditing ? (
          <div className="field-date-editor" onClick={(event) => event.stopPropagation()}>
            <input
              className="field-value-editor compact"
              type="date"
              value={toDateInputValue(draftValue)}
              onChange={(event) => setDraftValue(formatChineseDateFromInput(event.target.value))}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="YYYY年MM月DD日 HH时mm分"
            />
          </div>
        ) : (
          <textarea
            className="field-value-editor"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="输入填充内容"
            rows={4}
          />
        )
      ) : (
        <div className={field.value ? "field-value rich" : supplementReason ? "field-reason" : "field-value empty"}>
          {field.value || supplementReason || "暂未生成"}
        </div>
      )}
      {(field.source || sourceSnippetText) && field.status !== "未填充" ? (
        <div className="field-evidence" onClick={(event) => event.stopPropagation()}>
          <span>溯源</span>
          <div className="field-evidence-line">
            <em>{field.source || "未找到来源片段"}</em>
            {sourceSnippetText ? (
              <button
                type="button"
                onClick={() => setSourceExpanded((value) => !value)}
              >
                {sourceExpanded ? "收起" : "展开"}
              </button>
            ) : null}
          </div>
          {sourceExpanded && sourceSnippetText ? <p>{sourceSnippetText}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function getChoiceEditOptions(field) {
  const context = [field.answerFormat, field.question, getFieldChoiceValue(field)]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").trim())
    .filter(Boolean)
    .join("\n");
  const options = [];

  [...context.matchAll(/[□☐○〇▢☑✓✔]\s*([^□☐○〇▢☑✓✔\n\r]{2,80})/g)].forEach((match) => {
    options.push(cleanChoiceOptionText(match[1]));
  });

  if (options.length === 0) {
    const lineOptions = context
      .split(/\n+/)
      .map((line) => cleanChoiceOptionText(line))
      .filter((line) => /^[^\s].{1,80}$/.test(line) && /综合评估法|综合评分法|最低投标价法|含税|不含税/.test(line));
    options.push(...lineOptions);
  }

  if (options.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), options);
  }
  if (getFieldChoiceValue(field)) options.push(getFieldChoiceValue(field));

  return [...new Map(options
    .map((option) => cleanChoiceOptionText(option))
    .filter((option) => normalizeChoiceText(option).length >= 2)
    .map((option) => [normalizeChoiceText(option), option])).values()];
}

function cleanChoiceOptionText(value) {
  return String(value || "")
    .replace(/^模板上下文[：:]/, "")
    .replace(/^[□☐○〇▢☑✓✔]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getFillSupplementReason(field = {}) {
  if (field.status !== "需补充资料" || field.value) return "";
  const reason = String(field.evidence || "")
    .split("可参考相近原文：")[0]
    .split("系统判断：")[0]
    .replace(/\s+/g, " ")
    .trim();
  return reason ? `召回原因：${reason.slice(0, 180)}` : "";
}

function toDateInputValue(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

function formatChineseDateFromInput(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}年${padDatePart(parts.month)}月${padDatePart(parts.day)}日`;
}

function getNextFieldNumber(fields) {
  return (
    fields.reduce((max, field) => {
      const number = Number(field.id.replace(/\D/g, ""));
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0) + 1
  );
}

function readAuditConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(auditConfigStorageKey) || "null");
    if (Array.isArray(parsed)) return defaultAuditConfig;
    if (parsed && typeof parsed === "object") {
      const enabled = parsed.version === defaultAuditConfig.version && Array.isArray(parsed.enabled) ? parsed.enabled.filter(isKnownAuditConfigId) : defaultAuditConfig.enabled;
      return {
        version: defaultAuditConfig.version,
        enabled: enabled.length > 0 ? enabled : defaultAuditConfig.enabled,
        params: { ...defaultAuditConfig.params, ...(parsed.params || {}) },
      };
    }
  } catch {
    // ignore bad local config
  }
  return defaultAuditConfig;
}

function isKnownAuditConfigId(id) {
  return auditConfigItems.some((item) => item.id === id);
}

function isAuditIssueEnabled(issue, enabledItems) {
  if (!issue?.fixable || issue.layer === "evidence") return false;
  const keys = auditIssueConfigMap[issue.id] || (issue.auditConfigKey ? [issue.auditConfigKey] : null);
  return Boolean(keys?.some((key) => enabledItems.has(key)));
}

function shouldRunAiOutlineAudit(config) {
  const enabledSet = new Set(config.enabled || []);
  return enabledSet.has("body-outline") || enabledSet.has("missing-heading-style") || enabledSet.has("word-outline");
}

async function enhanceAuditWithAiOutline(auditResult, file, config, onlyOfficeOutline, userInstruction = "") {
  const enabledSet = new Set(config.enabled || []);
  const aiOutlineEnabled = shouldRunAiOutlineAudit(config);
  const baseIssues = (auditResult.issues || []).filter((issue) => !aiOutlineSourceIssueIds.has(issue.id));
  if (!aiOutlineEnabled) return { ...auditResult, issues: baseIssues };
  if (!onlyOfficeOutline?.ok || !Array.isArray(onlyOfficeOutline.items) || onlyOfficeOutline.items.length === 0) {
    return { ...auditResult, aiError: "OnlyOffice 大纲未挂载，不能开始 AI 审查。", issues: baseIssues };
  }

  const structure = file.structure || (await readDocxStructure(file.buffer.slice(0)).catch(() => null));
  const candidates = buildAiOutlineCandidates(structure, onlyOfficeOutline);
  if (candidates.length === 0) return { ...auditResult, issues: baseIssues };

  let data = {};
  try {
    const response = await fetch("/api/ai/format-outline-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates,
        onlyOfficeOutline: normalizeOnlyOfficeOutlineForAi(onlyOfficeOutline),
        auditRules: getUniversalOutlineAuditRules(),
        userInstruction,
      }),
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AI 标题/大纲审查失败");
  } catch (error) {
    return {
      ...auditResult,
      aiError: error?.message || "AI 标题/大纲审查失败，请检查模型配置。",
      issues: baseIssues,
    };
  }
  const plannedTargets = mergeAiOutlineTargets(buildForcedOutlineTargets(candidates), data.targets || []);
  const aiIssues = createAiOutlineIssues(filterResolvedAiOutlineTargets(plannedTargets, candidates), enabledSet);
  return {
    ...auditResult,
    aiError: "",
    issues: [...baseIssues, ...aiIssues],
  };
}

function buildForcedOutlineTargets(candidates) {
  return candidates
    .filter((item) => item.sourceIssue === "onlyoffice-empty-outline")
    .map((item) => ({
      paragraphIndex: item.paragraphIndex,
      outlineIndex: item.outlineIndex,
      outlineLevel: item.outlineLevel,
      text: item.text,
      operation: "demote",
      level: null,
      reason: "空标题",
    }));
}

function mergeAiOutlineTargets(baseTargets, aiTargets) {
  const seen = new Set();
  return [...baseTargets, ...aiTargets].filter((target) => {
    const key = `${target.outlineIndex ?? target.paragraphIndex}-${target.operation}-${target.level ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getUniversalOutlineAuditRules() {
  return [
    "只判断样式和大纲层级，不修改正文文本。",
    "先根据当前文档 OnlyOffice 大纲中占多数的编号形态、样式名称、层级分布归纳本文档规则。",
    "不要假设所有文档都使用“第X章/一、/1.”对应固定层级。",
    "明显标题形态不应降为正文；只在层级异常时调整 displayLevel。",
    "正文长段、说明性句子、承诺正文、单位落款、空标题不应进入大纲。",
    "不确定的项目标记 manual，不强行修复。",
    "只输出脚本可安全执行的结构化修复计划。",
  ];
}

function normalizeOnlyOfficeOutlineForAi(outline) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  return outline.items.slice(0, 300).map((item) => ({
    index: Number(item.index) || 0,
    level: Number(item.level) || 0,
    title: item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim(),
    isEmptyItem: Boolean(item.isEmptyItem),
    isNotHeader: Boolean(item.isNotHeader),
  }));
}

function buildAiOutlineCandidates(structure, onlyOfficeOutline) {
  return buildOnlyOfficeOutlineCandidates(onlyOfficeOutline, structure);
}

function buildOnlyOfficeOutlineCandidates(outline, structure) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  const headingBlocks = (structure?.blocks || []).filter((block) => block.type === "paragraph" && block.isHeading);
  const byText = new Map();
  headingBlocks.forEach((block) => {
    const key = normalizeOutlineMatchText(block.text);
    const list = byText.get(key) || [];
    list.push(block);
    byText.set(key, list);
  });

  return outline.items.slice(0, 300).map((item, order) => {
    const title = item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim();
    const textMatch = byText.get(normalizeOutlineMatchText(title))?.shift();
    const block = textMatch || headingBlocks[order] || null;
    return {
      paragraphIndex: block?.paragraphIndex || null,
      outlineIndex: Number(item.index) || 0,
      outlineLevel: Number(item.level) || 0,
      text: title,
      currentLevel: Number(item.level) || 0,
      isHeading: true,
      styleName: block?.styleName || "",
      sourceIssue: item.isEmptyItem ? "onlyoffice-empty-outline" : "onlyoffice-outline-table",
      isEmptyOutline: Boolean(item.isEmptyItem),
    };
  }).filter((item) => item.paragraphIndex);
}

function buildOnlyOfficeOutlineTextMap(outline) {
  const map = new Map();
  if (!outline?.ok || !Array.isArray(outline.items)) return map;
  outline.items.forEach((item) => {
    const key = normalizeOutlineMatchText(item.title || item.displayTitle || "");
    if (!key || item.isEmptyItem) return;
    const list = map.get(key) || [];
    list.push({ index: Number(item.index), level: Number(item.level) });
    map.set(key, list);
  });
  return map;
}

function normalizeOutlineMatchText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getAiOutlineBlockLevel(block) {
  if (!block?.isHeading || !Number.isInteger(block.level) || block.level <= 0) return null;
  return block.level - 1;
}

function filterResolvedAiOutlineTargets(targets, candidates) {
  const candidatesByParagraph = new Map(candidates.map((item) => [Number(item.paragraphIndex), item]));
  const candidatesByOutline = new Map(candidates.map((item) => [Number(item.outlineIndex), item]));
  return targets.map((target) => {
    const candidate = candidatesByOutline.get(Number(target.outlineIndex)) || candidatesByParagraph.get(Number(target.paragraphIndex));
    const operation = target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep";
    const targetLevel = Number(target.level);
    const valid = operation === "demote"
      ? Boolean(candidate?.isHeading || Number.isInteger(candidate?.currentLevel)) && isSafeOutlineDemoteTarget(candidate)
      : operation === "heading" && Number.isInteger(targetLevel)
        ? candidate?.currentLevel !== targetLevel
        : false;
    if (!valid) return null;
    return {
      ...target,
      text: target.text || candidate?.text || "",
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : candidate?.outlineIndex,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : candidate?.outlineLevel,
    };
  }).filter(Boolean);
}

function isSafeOutlineDemoteTarget(candidate) {
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "空标题" || candidate?.sourceIssue === "onlyoffice-empty-outline") return true;
  if (isProtectedOutlineHeading(text)) return false;
  if (/[。；;]$/.test(text)) return true;
  if (text.length > 42) return true;
  if (text.length > 24 && /[，,。；;：:]/.test(text)) return true;
  if (/供应商名称|盖章|公章|日期/.test(text)) return true;
  return false;
}

function isProtectedOutlineHeading(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || /[。；;：:]$/.test(value)) return false;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,60}$/.test(value)) return true;
  if (/^（[一二三四五六七八九十]+）\S{1,60}$/.test(value)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．]?\S{1,48}$/.test(value)) return true;
  return false;
}

function isAiOutlineCandidateBlock(block) {
  const text = String(block.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "目录" || text.length > 140) return false;
  if (block.isHeading || /标题|heading/i.test(block.styleName || "")) return true;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,40}$/.test(text)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．\s]\S{1,48}$/.test(text)) return true;
  return false;
}

function createAiOutlineIssues(targets, enabledSet) {
  const normalizedTargets = targets
    .map((target) => ({
      index: Number(target.paragraphIndex) - 1,
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : null,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : null,
      text: String(target.text || "").slice(0, 120),
      operation: target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep",
      level: Number.isInteger(Number(target.level)) ? Number(target.level) : null,
      reason: String(target.reason || "").slice(0, 120),
    }))
    .filter((target) => target.index >= 0 && target.operation !== "keep");
  return normalizedTargets
    .map((target) => makeAiOutlineIssue(target))
    .filter((issue) => isAuditIssueEnabled(issue, enabledSet));
}

function makeAiOutlineIssue(target) {
  const isHeading = target.operation === "heading";
  const auditConfigKey = isHeading ? "missing-heading-style" : "body-outline";
  const title = isHeading ? "标题未入大纲" : "正文误入标题";
  const description = isHeading ? "AI 判断该段应进入标题层级，修复时由脚本套用对应 Word 标题样式。" : "AI 判断该段应为正文，修复时由脚本移出 Word 大纲。";
  return {
    id: `ai-outline-${target.operation}-${target.outlineIndex ?? target.index}-${target.level ?? "body"}`,
    title,
    category: "标题体系",
    description,
    severity: "medium",
    layer: "safe",
    fixable: true,
    auditConfigKey,
    action: "applyAiOutlinePlan",
    count: 1,
    targets: [target],
    samples: [`${target.text || target.reason || "AI 审查项"}${target.reason ? `（${target.reason}）` : ""}`],
  };
}

function getOutlineRevisionReason(target) {
  const text = String(target?.text || "").trim();
  const reason = String(target?.reason || "").trim();
  if (!text) return "空标题";
  if (/空标题/.test(reason)) return "空标题";
  if (target?.operation === "demote") return "正文误入";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return "层级异常";
  return reason.slice(0, 4) || "大纲异常";
}

function getOutlineRevisionAction(target) {
  if (target?.operation === "demote") return "改正文";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return `改L${target.level + 1}`;
  return "人工确认";
}

function applyPreviewMarker({ fieldId, container, selection, anchorNode }) {
  if (!container) return;
  const selectedText = selection?.toString().trim();
  try {
    if (selection && selectedText && selection.rangeCount > 0 && container.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
        const marked = markRangeTextNodes(range, fieldId, container);
      if (!marked) {
        const marker = document.createElement("span");
        marker.className = "docx-field-marker";
        marker.dataset.fieldId = fieldId;
        range.surroundContents(marker);
      }
      selection.removeAllRanges();
      return;
    }
  } catch {
    // Some DOCX fragments split text across nodes; paragraph marking still gives visible feedback.
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const paragraph = element?.closest?.("p, table, li, div");
  if (paragraph && container.contains(paragraph)) {
    paragraph.classList.add("docx-field-marker-block");
    paragraph.dataset.fieldId = fieldId;
  }
}

function markRangeTextNodes(range, fieldId, container, extraClasses = [], restored = false) {
  const textNodes = collectTextNodesInRange(range, container);
  if (textNodes.length === 0) return false;

  textNodes.forEach((node) => {
    let start = node === range.startContainer ? range.startOffset : 0;
    let end = node === range.endContainer ? range.endOffset : node.textContent.length;
    if (start > end) [start, end] = [end, start];
    if (start === end) return;

    const nodeRange = document.createRange();
    nodeRange.setStart(node, start);
    nodeRange.setEnd(node, end);
    const marker = document.createElement("span");
    marker.className = ["docx-field-marker", ...extraClasses].filter(Boolean).join(" ");
    marker.dataset.fieldId = fieldId;
    if (restored) marker.dataset.restoredFieldId = fieldId;
    try {
      nodeRange.surroundContents(marker);
    } catch {
      const parent = node.parentElement?.closest?.("p, table, li, div");
      parent?.classList.add("docx-field-marker-block", ...extraClasses);
      if (parent) {
        parent.dataset.fieldId = fieldId;
        if (restored) parent.dataset.restoredFieldId = fieldId;
      }
    }
  });

  return true;
}

function collectTextNodesInRange(range, container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function createAnnotationMarkerData({ container, selection, anchorNode, text, page }) {
  if (!container) return null;
  const pageElement = getPreviewPageElement(container, page) || getClosestPreviewSection(anchorNode);
  if (!pageElement) return null;
  const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";

  if (selection && selectedText && selection.rangeCount > 0 && pageElement.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    return {
      kind: "range",
      page,
      text: selectedText.slice(0, 500),
      startPath: getNodePath(pageElement, range.startContainer),
      startOffset: range.startOffset,
      endPath: getNodePath(pageElement, range.endContainer),
      endOffset: range.endOffset,
    };
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const target = element?.closest?.("p, table, li, td, div");
  if (target && pageElement.contains(target)) {
    return {
      kind: "block",
      page,
      text: String(text || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
      elementPath: getNodePath(pageElement, target),
    };
  }

  return null;
}

function getClosestPreviewSection(anchorNode) {
  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  return element?.closest?.(".docx-wrapper > section") ?? null;
}

function getNodePath(root, node) {
  if (!root || !node || !root.contains(node)) return [];
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return [];
    path.unshift([...parent.childNodes].indexOf(current));
    current = parent;
  }
  return path;
}

function resolveNodePath(root, path = []) {
  if (!root || !Array.isArray(path)) return null;
  return path.reduce((node, index) => node?.childNodes?.[index] ?? null, root);
}

function removePreviewMarker(fieldId) {
  document.querySelectorAll(`[data-field-id="${fieldId}"]`).forEach((node) => {
    node.classList.remove("docx-field-marker-block");
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
    } else {
      delete node.dataset.fieldId;
    }
  });
}

function clearPreviewMarkers() {
  [...document.querySelectorAll("[data-field-id]")].forEach((node) => {
    const fieldId = node.dataset.fieldId;
    if (fieldId) removePreviewMarker(fieldId);
  });
}

function restoreAnnotationPreviewMarkers(container, fields, selectedFieldId, activePage) {
  clearRestoredAnnotationMarkers(container);
  if (!selectedFieldId) return;
  const page = getPreviewPageElement(container, activePage);
  if (!page) return;

  const field = fields.find((item) => item.id === selectedFieldId && (item.page || 1) === activePage);
  if (!field) return;

  if (restoreAnnotationMarkerByData(page, field)) return;

  const target = findAnnotationFieldTarget(page, field);
  if (!target) return;
  target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
  target.dataset.fieldId = field.id;
  target.dataset.restoredFieldId = field.id;
}

function clearRestoredAnnotationMarkers(container) {
  container?.querySelectorAll("[data-restored-field-id]").forEach((node) => {
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
      return;
    }
    node.classList.remove("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    delete node.dataset.fieldId;
    delete node.dataset.restoredFieldId;
  });
}

function restoreAnnotationMarkerByData(page, field) {
  const marker = field.marker;
  if (!marker) return false;

  if (marker.kind === "range" && marker.startPath && marker.endPath) {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    if (!startNode || !endNode) return false;
    try {
      const range = document.createRange();
      range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
      range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
      return markRangeTextNodes(range, field.id, page, ["docx-field-marker-restored", "docx-field-marker-active"], true);
    } catch {
      return false;
    }
  }

  if (marker.kind === "block" && marker.elementPath) {
    const target = resolveNodePath(page, marker.elementPath);
    if (!target?.classList) return false;
    target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    target.dataset.fieldId = field.id;
    target.dataset.restoredFieldId = field.id;
    return true;
  }

  return false;
}

function findAnnotationFieldTarget(page, field) {
  const candidates = [...page.querySelectorAll("span, p, td, li, table")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!text || text.length > 360) return null;
      const score = scoreAnnotationTarget(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length || getAnnotationNodeRank(a.node) - getAnnotationNodeRank(b.node));
  return candidates[0]?.node || null;
}

function scoreAnnotationTarget(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const tokens = createAnnotationTargetTokens(field, false);
  let score = 0;
  tokens.forEach((token, index) => {
    if (normalizedText.includes(token)) {
      score += Math.max(6, 28 - index * 3);
    }
  });

  if (score === 0) {
    createAnnotationTargetTokens(field, true).forEach((token) => {
      if (normalizedText.includes(token)) score += 4;
    });
  }
  return score;
}

function createAnnotationTargetTokens(field, includeFallbackName = false) {
  const rawTokens = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, "")];
  if (includeFallbackName) rawTokens.push(field.name);

  return [...new Set(rawTokens.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function splitAnnotationContextTokens(value) {
  return String(value || "")
    .split(/[□☐○〇▢_＿—\-]+/)
    .map((item) => item.replace(/[{}]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeAnnotationText(value) {
  return String(value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/[{}（）()：:，,。；;、\s]/g, "")
    .trim();
}

function getAnnotationNodeRank(node) {
  const tag = node?.tagName?.toLowerCase();
  if (tag === "span") return 0;
  if (tag === "p") return 1;
  if (tag === "td" || tag === "li") return 2;
  if (tag === "table") return 3;
  return 4;
}

const WORD_XML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function readDocxStructure(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);
  if (!documentXml) return { outline: [], blocks: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const styles = stylesXml ? parseDocxOutlineStyles(parser.parseFromString(stylesXml, "application/xml")) : new Map();
  const numbering = numberingXml ? parseDocxNumbering(parser.parseFromString(numberingXml, "application/xml")) : { nums: new Map() };
  const body = structureDescendants(doc, "body")[0];
  if (!body) return { outline: [], blocks: [] };

  const root = {
    id: "audit-out-root",
    parentId: "",
    level: 0,
    order: 0,
    title: "文档正文",
    paragraphIndex: 0,
    blockIds: [],
  };
  const outline = [];
  const stack = [root];
  const blocks = [];
  let currentOutline = root;
  let paragraphIndex = 0;
  let tableIndex = 0;
  let tocFieldDepth = 0;
  const numberingState = new Map();

  structureElementChildren(body).forEach((child) => {
    const name = structureLocalName(child);
    if (name === "p") {
      paragraphIndex += 1;
      const text = getStructureNodeText(child);
      const styleId = getStructureParagraphStyleId(child);
      const styleInfo = styles.get(styleId);
      const styleName = styleInfo?.name || "";
      const pPr = structureElementChildren(child, "pPr")[0];
      const directOutline = pPr ? structureElementChildren(pPr, "outlineLvl")[0] : null;
      const directLevel = parseOutlineLevel(getStructureAttr(directOutline, "val"));
      const actualLevel = Number.isInteger(directLevel) ? directLevel : styleInfo?.level;
      const fieldInfo = getParagraphFieldInfo(child);
      const insideToc = tocFieldDepth > 0 || fieldInfo.startsToc || isTocStyle(styleInfo, styleId);
      if (fieldInfo.startsToc) tocFieldDepth += Math.max(1, fieldInfo.beginCount);
      if (tocFieldDepth > 0 && fieldInfo.endCount > 0) tocFieldDepth = Math.max(0, tocFieldDepth - fieldInfo.endCount);
      const isHeading = !insideToc && Number.isInteger(actualLevel) && actualLevel >= 0 && actualLevel <= 8;
      if (!text && !isHeading) return;
      const displayText = text || "空标题";
      if (isHeading) {
        const numberPrefix = formatAndAdvanceNumbering(numberingState, numbering, resolveParagraphNumbering(child, styleInfo));
        currentOutline = addStructureOutlineNode(outline, stack, actualLevel + 1, structureOutlineTitle(joinOutlineNumbering(numberPrefix, displayText)), paragraphIndex);
      }

      const block = {
        id: `audit-block-${String(blocks.length + 1).padStart(4, "0")}`,
        outlineId: currentOutline.id,
        outlineTitle: currentOutline.title,
        type: "paragraph",
        order: blocks.length + 1,
        paragraphIndex,
        tableIndex: 0,
        level: isHeading ? actualLevel + 1 : 0,
        styleId,
        styleName,
        isHeading,
        text: displayText,
        preview: structureBlockPreview(displayText),
      };
      blocks.push(block);
      currentOutline.blockIds.push(block.id);
      return;
    }

    if (name === "tbl") {
      tableIndex += 1;
      const text = getStructureTableText(child);
      if (!text) return;
      const block = {
        id: `audit-block-${String(blocks.length + 1).padStart(4, "0")}`,
        outlineId: currentOutline.id,
        outlineTitle: currentOutline.title,
        type: "table",
        order: blocks.length + 1,
        paragraphIndex,
        tableIndex,
        level: 0,
        styleId: "",
        styleName: "",
        isHeading: false,
        text,
        preview: structureBlockPreview(text),
      };
      blocks.push(block);
      currentOutline.blockIds.push(block.id);
    }
  });

  return {
    outline: outline.map((item) => ({
      id: item.id,
      title: item.title,
      level: Math.max(0, item.level - 1),
      index: item.paragraphIndex,
      page: 1,
      blockIds: item.blockIds,
    })),
    blocks,
  };
}

function structureLocalName(node) {
  return String(node?.localName || node?.nodeName || "").split(":").pop();
}

function structureElementChildren(node, name) {
  const children = [];
  for (let index = 0; index < (node?.childNodes?.length || 0); index += 1) {
    const child = node.childNodes[index];
    if (child.nodeType === 1 && (!name || structureLocalName(child) === name)) children.push(child);
  }
  return children;
}

function structureDescendants(node, name) {
  const found = [];
  function visit(current) {
    for (let index = 0; index < (current?.childNodes?.length || 0); index += 1) {
      const child = current.childNodes[index];
      if (child.nodeType !== 1) continue;
      if (!name || structureLocalName(child) === name) found.push(child);
      visit(child);
    }
  }
  visit(node);
  return found;
}

function getStructureAttr(node, name) {
  return node?.getAttribute?.(`w:${name}`) || node?.getAttribute?.(name) || "";
}

function getStructureNodeText(node) {
  return structureDescendants(node)
    .map((item) => {
      const name = structureLocalName(item);
      if (name === "t") return item.textContent || "";
      if (name === "tab") return " ";
      if (name === "br" || name === "cr") return "\n";
      return "";
    })
    .join("")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function getStructureTableText(table) {
  return structureElementChildren(table, "tr")
    .map((row) =>
      structureElementChildren(row, "tc")
        .map((cell) => getStructureNodeText(cell))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

function getStructureParagraphStyleId(paragraph) {
  const pPr = structureElementChildren(paragraph, "pPr")[0];
  const pStyle = pPr ? structureElementChildren(pPr, "pStyle")[0] : null;
  return getStructureAttr(pStyle, "val");
}

async function readStructureStyleMap(zip, parser) {
  const stylesXml = await zip.file("word/styles.xml")?.async("text");
  const styleMap = new Map();
  if (!stylesXml) return styleMap;
  const doc = parser.parseFromString(stylesXml, "application/xml");
  structureDescendants(doc, "style").forEach((style) => {
    const styleId = getStructureAttr(style, "styleId");
    const type = getStructureAttr(style, "type");
    const name = getStructureAttr(structureElementChildren(style, "name")[0], "val");
    if (styleId) styleMap.set(styleId, { styleId, type, name });
  });
  return styleMap;
}

function structureChineseNumberToInt(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (map[raw]) return map[raw];
  if (raw === "十一") return 11;
  if (raw === "十二") return 12;
  return 0;
}

function structureHeadingLevelFromStyle(styleId, styleName = "") {
  const source = `${styleId} ${styleName}`.toLowerCase();
  if (/\btoc\b|目录/.test(source)) return 0;
  const headingMatch = /(heading|标题)\s*([1-6一二三四五六])/.exec(source);
  if (headingMatch) return structureChineseNumberToInt(headingMatch[2]);
  const titleMatch = /^([1-6])$/.exec(String(styleId || ""));
  if (titleMatch && /标题/.test(styleName)) return Number(titleMatch[1]);
  return 0;
}

function normalizeStructureString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inferStructureHeadingLevel(text, styleId, styleName) {
  const styledLevel = structureHeadingLevelFromStyle(styleId, styleName);
  const value = normalizeStructureString(text);
  if (!value || value.length > 90 || value === "目 录" || value === "目录") return 0;
  if (/^□?第[一二三四五六七八九十0-9]+章/.test(value)) return 1;
  if (/^(询比采购公告|采购公告)$/.test(value)) return 1;
  if (/^(供应商须知|供应商资格证明材料|项目详细要求|响应文件格式|合同主要条款)$/.test(value)) return 1;
  if (/^□?第五章\s*评审办法/.test(value)) return 1;

  const isChineseSection = /^[一二三四五六七八九十]+[、.．]\s*\S+/.test(value);
  if (styledLevel === 2 && isChineseSection) return 2;
  if (styledLevel === 1) return 1;
  if (styledLevel === 2 && !/^[0-9]+(?:\.[0-9]+)*[、.．\s]/.test(value)) return 2;
  return 0;
}

function structureOutlineTitle(text) {
  return normalizeStructureString(text).replace(/\s+/g, " ").slice(0, 80) || "未命名章节";
}

function structureBlockPreview(text, maxLength = 220) {
  const value = normalizeStructureString(text);
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function addStructureOutlineNode(outline, stack, level, title, paragraphIndex) {
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
  const parent = stack[stack.length - 1];
  const order = outline.length + 1;
  const node = {
    id: `audit-out-${String(order).padStart(3, "0")}`,
    parentId: parent?.id || "",
    level,
    order,
    title,
    paragraphIndex,
    blockIds: [],
  };
  outline.push(node);
  stack.push(node);
  return node;
}

async function readDocxOutlineItems(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);
  if (!documentXml) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const styles = stylesXml ? parseDocxOutlineStyles(parser.parseFromString(stylesXml, "application/xml")) : new Map();
  const numbering = numberingXml ? parseDocxNumbering(parser.parseFromString(numberingXml, "application/xml")) : { nums: new Map() };
  return collectDocxOutlineItems(doc, styles, numbering);
}

function collectDocxOutlineItems(doc, styles, numbering) {
  const numberingState = new Map();
  let tocFieldDepth = 0;

  return getWordXmlElements(doc, "p")
    .map((paragraph, index) => {
      const text = getXmlParagraphText(paragraph).replace(/\s+/g, " ").trim();

      const pPr = getWordXmlChild(paragraph, "pPr");
      const pStyle = getWordXmlChild(pPr, "pStyle");
      const styleId = getWordXmlAttr(pStyle, "val");
      const styleInfo = styles.get(styleId);
      const fieldInfo = getParagraphFieldInfo(paragraph);
      const insideToc = tocFieldDepth > 0 || fieldInfo.startsToc || isTocStyle(styleInfo, styleId);
      if (fieldInfo.startsToc) tocFieldDepth += Math.max(1, fieldInfo.beginCount);
      if (tocFieldDepth > 0 && fieldInfo.endCount > 0) tocFieldDepth = Math.max(0, tocFieldDepth - fieldInfo.endCount);
      if (insideToc || !text) return null;

      const directOutline = getWordXmlChild(pPr, "outlineLvl");
      const directLevel = parseOutlineLevel(getWordXmlAttr(directOutline, "val"));
      const styleLevel = styleInfo?.level;
      const level = Number.isInteger(directLevel) ? directLevel : styleLevel;
      if (!Number.isInteger(level) || level < 0 || level > 8) return null;

      const numberPrefix = formatAndAdvanceNumbering(
        numberingState,
        numbering,
        resolveParagraphNumbering(paragraph, styleInfo),
      );

      return {
        id: `outline-${index}`,
        title: joinOutlineNumbering(numberPrefix, text),
        level,
        index,
      };
    })
    .filter(Boolean);
}

function parseDocxOutlineStyles(stylesDoc) {
  const styles = new Map();
  getWordXmlElements(stylesDoc, "style").forEach((style) => {
    const styleId = getWordXmlAttr(style, "styleId");
    if (!styleId) return;

    const name = getWordXmlAttr(getWordXmlChild(style, "name"), "val");
    const pPr = getWordXmlChild(style, "pPr");
    const outline = getWordXmlChild(pPr, "outlineLvl");
    const outlineLevel = parseOutlineLevel(getWordXmlAttr(outline, "val"));
    const headingLevel = parseHeadingStyleLevel(name);
    const level = Number.isInteger(outlineLevel) ? outlineLevel : headingLevel;
    styles.set(styleId, { name, level, numPr: parseNumberingProperties(getWordXmlChild(pPr, "numPr")) });
  });
  return styles;
}

function parseDocxNumbering(numberingDoc) {
  const abstracts = new Map();
  getWordXmlElements(numberingDoc, "abstractNum").forEach((abstractNum) => {
    const abstractId = getWordXmlAttr(abstractNum, "abstractNumId");
    if (!abstractId) return;
    const levels = new Map();
    getWordXmlChildren(abstractNum, "lvl").forEach((levelNode) => {
      const level = parseOutlineLevel(getWordXmlAttr(levelNode, "ilvl"));
      if (Number.isInteger(level)) levels.set(level, parseNumberingLevel(levelNode));
    });
    abstracts.set(abstractId, levels);
  });

  const nums = new Map();
  getWordXmlElements(numberingDoc, "num").forEach((numNode) => {
    const numId = getWordXmlAttr(numNode, "numId");
    const abstractId = getWordXmlAttr(getWordXmlChild(numNode, "abstractNumId"), "val");
    if (!numId || !abstracts.has(abstractId)) return;

    const levels = new Map([...abstracts.get(abstractId)].map(([level, info]) => [level, { ...info }]));
    getWordXmlChildren(numNode, "lvlOverride").forEach((override) => {
      const level = parseOutlineLevel(getWordXmlAttr(override, "ilvl"));
      if (!Number.isInteger(level)) return;
      const overrideLevel = getWordXmlChild(override, "lvl");
      const base = overrideLevel ? parseNumberingLevel(overrideLevel) : levels.get(level) || {};
      const startOverride = Number(getWordXmlAttr(getWordXmlChild(override, "startOverride"), "val"));
      levels.set(level, {
        ...levels.get(level),
        ...base,
        ...(Number.isInteger(startOverride) ? { start: startOverride } : {}),
      });
    });

    nums.set(numId, { levels });
  });

  return { nums };
}

function parseNumberingLevel(levelNode) {
  const start = Number(getWordXmlAttr(getWordXmlChild(levelNode, "start"), "val") || "1");
  return {
    start: Number.isInteger(start) ? start : 1,
    numFmt: getWordXmlAttr(getWordXmlChild(levelNode, "numFmt"), "val") || "decimal",
    lvlText: getWordXmlAttr(getWordXmlChild(levelNode, "lvlText"), "val") || "",
  };
}

function parseNumberingProperties(numPr) {
  if (!numPr) return null;
  const numId = getWordXmlAttr(getWordXmlChild(numPr, "numId"), "val");
  const ilvl = parseOutlineLevel(getWordXmlAttr(getWordXmlChild(numPr, "ilvl"), "val"));
  if (!numId && !Number.isInteger(ilvl)) return null;
  return { numId, ilvl: Number.isInteger(ilvl) ? ilvl : 0 };
}

function resolveParagraphNumbering(paragraph, styleInfo) {
  const pPr = getWordXmlChild(paragraph, "pPr");
  const direct = parseNumberingProperties(getWordXmlChild(pPr, "numPr"));
  const inherited = styleInfo?.numPr;
  const numId = direct?.numId || inherited?.numId;
  if (!numId) return null;
  return {
    numId,
    ilvl: Number.isInteger(direct?.ilvl) ? direct.ilvl : Number.isInteger(inherited?.ilvl) ? inherited.ilvl : 0,
  };
}

function formatAndAdvanceNumbering(state, numbering, numPr) {
  if (!numPr) return "";
  const num = numbering.nums.get(String(numPr.numId));
  const level = Number.isInteger(numPr.ilvl) ? numPr.ilvl : 0;
  const levelInfo = num?.levels.get(level);
  if (!levelInfo) return "";

  const counters = state.get(numPr.numId) || [];
  const previous = Number.isInteger(counters[level]) ? counters[level] : levelInfo.start - 1;
  counters[level] = previous + 1;
  for (let index = level + 1; index < counters.length; index += 1) counters[index] = undefined;
  state.set(numPr.numId, counters);

  if (levelInfo.numFmt === "none") return "";
  const pattern = levelInfo.lvlText || `%${level + 1}`;
  return pattern.replace(/%([1-9])/g, (_, levelNumber) => {
    const levelIndex = Number(levelNumber) - 1;
    const value = counters[levelIndex];
    const format = num.levels.get(levelIndex)?.numFmt || "decimal";
    return Number.isInteger(value) ? formatNumberValue(value, format) : "";
  });
}

function formatNumberValue(value, format) {
  const normalizedFormat = String(format || "decimal").toLowerCase();
  if (normalizedFormat.includes("chinese") || normalizedFormat.includes("japanese")) return toChineseNumber(value);
  if (normalizedFormat === "lowerletter") return toLetterNumber(value, false);
  if (normalizedFormat === "upperletter") return toLetterNumber(value, true);
  if (normalizedFormat === "lowerroman") return toRomanNumber(value).toLowerCase();
  if (normalizedFormat === "upperroman") return toRomanNumber(value);
  return String(value);
}

function toChineseNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const chars = String(value).split("").map(Number);
  let result = "";
  let pendingZero = false;
  chars.forEach((digit, index) => {
    const unit = units[chars.length - index - 1];
    if (digit === 0) {
      pendingZero = Boolean(result);
      return;
    }
    if (pendingZero) result += "零";
    result += `${digits[digit]}${unit}`;
    pendingZero = false;
  });
  return result.replace(/^一十/, "十");
}

function toLetterNumber(value, uppercase) {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(97 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return uppercase ? result.toUpperCase() : result;
}

function toRomanNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 3999) return String(value);
  const pairs = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let current = value;
  let result = "";
  pairs.forEach(([number, roman]) => {
    while (current >= number) {
      result += roman;
      current -= number;
    }
  });
  return result;
}

function joinOutlineNumbering(numberPrefix, text) {
  const prefix = String(numberPrefix || "").trim();
  if (!prefix) return text;
  return normalizeOutlineTitle(text).startsWith(normalizeOutlineTitle(prefix)) ? text : `${prefix} ${text}`;
}

function getParagraphFieldInfo(paragraph) {
  const instrText = getWordXmlElements(paragraph, "instrText")
    .map((node) => node.textContent || "")
    .join(" ");
  const fldChars = getWordXmlElements(paragraph, "fldChar");
  return {
    startsToc: /\bTOC\b/i.test(instrText),
    beginCount: fldChars.filter((node) => getWordXmlAttr(node, "fldCharType") === "begin").length,
    endCount: fldChars.filter((node) => getWordXmlAttr(node, "fldCharType") === "end").length,
  };
}

function isTocStyle(styleInfo, styleId) {
  return /^toc\b/i.test(styleInfo?.name || "") || /^TOC/i.test(styleId || "");
}

function parseHeadingStyleLevel(name) {
  const match = String(name || "").match(/^heading\s*([1-9])$/i);
  return match ? Number(match[1]) - 1 : null;
}

function parseOutlineLevel(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const level = Number(value);
  return Number.isInteger(level) ? level : null;
}

function getWordXmlAttr(node, name) {
  if (!node) return "";
  return (
    node.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name) ||
    node.getAttribute(`w:${name}`) ||
    node.getAttribute(name) ||
    ""
  );
}

function getWordXmlChild(node, localName) {
  if (!node) return null;
  return [...node.children].find((child) => child.localName === localName) || null;
}

function getWordXmlChildren(node, localName) {
  if (!node) return [];
  return [...node.children].filter((child) => child.localName === localName);
}

function getWordXmlElements(node, localName) {
  if (!node) return [];
  const namespaced = node.getElementsByTagNameNS ? [...node.getElementsByTagNameNS(WORD_XML_NS, localName)] : [];
  return namespaced.length > 0 ? namespaced : [...node.getElementsByTagName?.(`w:${localName}`) ?? []];
}

function getWordXmlParagraphText(paragraph) {
  return getWordXmlElements(paragraph, "t")
    .map((node) => node.textContent || "")
    .join("");
}

function syncRenderedTocEntries(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return;
  const tocNodes = [...container.querySelectorAll(".docx-wrapper p")].filter(isRenderedTocNode);
  tocNodes.forEach((node) => {
    const level = getRenderedTocLevel(node);
    const match = findRenderedTocOutlineMatch(node.textContent, level, docxOutlineItems);
    if (!match) return;
    if (normalizeOutlineTitle(node.textContent) === normalizeOutlineTitle(match.title)) return;
    node.textContent = match.title;
  });
}

function getRenderedTocLevel(node) {
  const className = [...(node?.classList || [])].find((name) => /^docx_toc\d*$/i.test(name));
  const match = className?.match(/toc(\d*)$/i);
  const level = Number(match?.[1]);
  return Number.isInteger(level) && level > 0 ? level - 1 : null;
}

function findRenderedTocOutlineMatch(text, level, outlineItems) {
  const normalizedText = normalizeOutlineTitle(text);
  const candidates = outlineItems.filter((item) => level === null || item.level === level);
  const direct = candidates.find((item) => {
    const title = normalizeOutlineTitle(item.title);
    return title === normalizedText || title.endsWith(normalizedText) || normalizedText.endsWith(title);
  });
  if (direct) return direct;

  const chapter = getChapterKey(normalizedText);
  if (!chapter) return null;
  const chapterMatches = candidates.filter((item) => getChapterKey(normalizeOutlineTitle(item.title)) === chapter);
  return chapterMatches.length === 1 ? chapterMatches[0] : null;
}

function getChapterKey(value) {
  return String(value || "").match(/第[一二三四五六七八九十百千万0-9]+章/)?.[0] || "";
}

function extractOutlineItems(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return [];

  const paragraphNodes = getRenderedDocumentParagraphNodes(container);
  const nodes = paragraphNodes
    .map((node) => ({
      node,
      text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      normalized: normalizeOutlineTitle(node.textContent),
    }))
    .filter((item) => item.normalized && !isRenderedTocNode(item.node));

  let searchStart = 0;
  return docxOutlineItems.map((item) => {
    const normalizedTitle = normalizeOutlineTitle(item.title);
    const directNode = getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle);
    const matchIndex = directNode
      ? -1
      : nodes.findIndex((candidate, index) => {
          if (index < searchStart) return false;
          return isOutlineTitleMatch(candidate.normalized, normalizedTitle);
        });
    const matched = directNode ? { node: directNode } : matchIndex >= 0 ? nodes[matchIndex] : null;
    if (matched) {
      if (matchIndex >= 0) searchStart = matchIndex + 1;
      matched.node.dataset.outlineId = item.id;
    }
    return {
      ...item,
      page: matched ? resolvePreviewPage(matched.node, container) : 1,
    };
  });
}

function getRenderedDocumentParagraphNodes(container) {
  return [...(container?.querySelectorAll(".docx-wrapper > section > article p") ?? [])];
}

function getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle) {
  const node = paragraphNodes[item.index];
  if (!node || isRenderedTocNode(node)) return null;
  const normalizedNodeText = normalizeOutlineTitle(node.textContent);
  return isOutlineTitleMatch(normalizedNodeText, normalizedTitle) ? node : null;
}

function normalizeOutlineTitle(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isRenderedTocNode(node) {
  return [...(node?.classList || [])].some((className) => /^docx_toc\d*$/i.test(className));
}

function isOutlineTitleMatch(candidate, title) {
  if (!candidate || !title) return false;
  if (candidate === title) return true;
  return title.endsWith(candidate);
}

function highlightSearchMatches(container, term) {
  clearSearchHighlights(container);
  const keyword = term.trim();
  if (!container || !keyword) return { count: 0, firstPage: null };

  const nodes = collectSearchTextNodes(container);
  let count = 0;
  let firstPage = null;
  nodes.forEach((node) => {
    const text = node.textContent || "";
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const matches = [];
    let startIndex = 0;
    while (startIndex <= lowerText.length - lowerKeyword.length) {
      const index = lowerText.indexOf(lowerKeyword, startIndex);
      if (index < 0) break;
      matches.push(index);
      startIndex = index + Math.max(1, lowerKeyword.length);
    }

    matches.reverse().forEach((index) => {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + keyword.length);
      const marker = document.createElement("mark");
      marker.className = "doc-search-hit";
      try {
        range.surroundContents(marker);
        count += 1;
        if (!firstPage) {
          firstPage = resolvePreviewPage(marker, container);
        }
      } catch {
        // Search highlighting is best effort; document rendering should stay stable.
      }
    });
  });

  setActiveSearchHit(container, 0);
  return { count, firstPage };
}

function getSearchHits(container) {
  return [...(container?.querySelectorAll(".doc-search-hit") ?? [])];
}

function setActiveSearchHit(container, index) {
  const hits = getSearchHits(container);
  hits.forEach((hit) => hit.classList.remove("active"));
  const target = hits[index] || null;
  target?.classList.add("active");
  return target;
}

function collectSearchTextNodes(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest?.(".doc-search-hit, .preview-mark-list")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function clearSearchHighlights(container) {
  if (!container) return;
  [...container.querySelectorAll(".doc-search-hit")].forEach((node) => {
    const parent = node.parentNode;
    while (node.firstChild) parent?.insertBefore(node.firstChild, node);
    parent?.removeChild(node);
    parent?.normalize?.();
  });
}

function applyFillPreviewValues(container, fields) {
  if (!container) return;
  container.querySelectorAll("[data-fill-original-html]").forEach((node) => {
    node.innerHTML = node.dataset.fillOriginalHtml || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalHtml;
  });
  container.querySelectorAll("[data-fill-original-text]").forEach((node) => {
    node.textContent = node.dataset.fillOriginalText || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalText;
  });
  container.querySelectorAll(".docx-replaced-source").forEach((node) => {
    node.classList.remove("docx-replaced-source");
    delete node.dataset.replacedByField;
  });
  container.querySelectorAll(".docx-choice-selected").forEach((node) => {
    node.classList.remove("docx-choice-selected");
    collectTextNodes(node).forEach((textNode) => {
      textNode.textContent = (textNode.textContent || "").replace(/[☑✓✔]/g, "□");
    });
  });
  container.normalize?.();

  fields.forEach((field) => {
    if (!field.name || !field.value) return;
    if (field.type === "单选项" && applySectionLeadFillValue(container, field)) return;

    if (field.type === "单选项") {
      const choiceScope = getPreviewPageElement(container, field.page || 1) || container;
      const choiceTarget = findChoiceTarget(choiceScope, field);
      if (choiceTarget) {
        markChoiceTarget(choiceTarget);
        if (!shouldContinueFillAfterChoice(field)) return;
        if (applyAmountUnitFillValue(choiceTarget.element ?? choiceTarget, field)) return;
      }
    }

    if (isDateField(field) && applyDateSegmentFillValue(container, field)) return;
    if (applyAmountUnitFillValue(container, field)) return;
    if (applyMarkerFillValue(container, field)) return;
    if (applyContextualFillValue(container, field)) return;
    if (applyTemplateContextBlankFillValue(container, field)) return;

    const target = findFillTarget(container, field.name);
    if (!target) return;
    applyLabelFillValue(target, field);
  });
}

function applyDateSegmentFillValue(container, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const scope = getPreviewPageElement(container, field.marker?.page || field.page || 1) || container;
  const markerTarget = field.marker ? findMarkerFillTarget(scope, field.marker) : null;
  if (markerTarget && replaceDateSegmentInTarget(markerTarget, field, parts)) return true;

  const candidates = getScopedCandidateNodes(scope, "p, td, li, div")
    .map((node) => {
      const text = node.textContent || "";
      if (text.length > 260 || !hasDateSegmentBlank(text)) return null;
      return { node, score: scoreDateSegmentCandidate(text, field), length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (replaceDateSegmentInTarget(candidate.node, field, parts)) return true;
  }
  return false;
}

function replaceDateSegmentInTarget(target, field, parts) {
  const text = target.textContent || "";
  const match = getDateSegmentBlankPattern().exec(text);
  if (!match) return false;
  const replacement = buildDateSegmentReplacement(match[0], parts);
  if (!replacement) return true;

  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(text.slice(0, match.index)));
  appendDateFillPart(target, field, parts.year);
  target.append(document.createTextNode("年"));
  appendDateFillPart(target, field, parts.month);
  target.append(document.createTextNode("月"));
  appendDateFillPart(target, field, parts.day);
  target.append(document.createTextNode("日"));
  if (dateSegmentNeedsTime(match[0])) {
    appendDateFillPart(target, field, parts.hour);
    target.append(document.createTextNode("时"));
    appendDateFillPart(target, field, parts.minute);
    target.append(document.createTextNode("分"));
  }
  target.append(document.createTextNode(text.slice(match.index + match[0].length)));
  target.classList.add("docx-fill-mutated");
  return true;
}

function appendDateFillPart(target, field, value) {
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value date-piece";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = value;
  target.append(valueNode);
}

function hasDateSegmentBlank(text) {
  return getDateSegmentBlankPattern().test(text || "");
}

function getDateSegmentBlankPattern() {
  return /[_＿—\-\s]{0,12}年[_＿—\-\s]{0,8}月[_＿—\-\s]{0,8}日(?:[_＿—\-\s]{0,8}时[_＿—\-\s]{0,8}分)?/;
}

function buildDateSegmentFillText(source, value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return String(source || "").replace(getDateSegmentBlankPattern(), (match) => buildDateSegmentReplacement(match, parts) || match);
}

function buildDateSegmentReplacement(segment, parts) {
  if (!parts?.year || !parts.month || !parts.day) return "";
  if (dateSegmentNeedsTime(segment) && (!parts.hour || !parts.minute)) return "";
  const dateText = `${parts.year}年${parts.month}月${parts.day}日`;
  return dateSegmentNeedsTime(segment) ? `${dateText}${parts.hour}时${parts.minute}分` : dateText;
}

function dateSegmentNeedsTime(segment) {
  return /时[_＿—\-\s]{0,8}分/.test(segment || "");
}

function scoreDateSegmentCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const context = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 5;
  if (normalizedText.includes("日期") || normalizedText.includes("年月日")) score += 8;
  if (context.includes("日期") || context.includes("年月日")) score += 6;
  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 5;
  });
  return score;
}

function applyAmountUnitFillValue(container, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return false;

  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = getScopedCandidateNodes(scope, "td, p, li, div")
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length > 1200 || !/(金额|限价|报价|费用)[^。；;]{0,80}[：:]\s*(元|万元)/.test(text)) return null;
      const score = scoreAmountUnitCandidate(text, field);
      return { node, score, length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function getScopedCandidateNodes(scope, selector) {
  if (!scope) return [];
  const nodes = [...scope.querySelectorAll(selector)];
  if (scope.matches?.(selector)) nodes.unshift(scope);
  return nodes;
}

function scoreAmountUnitCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const normalizedContext = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 0;

  ["询比保证金", "投标保证金", "最高限价", "采购控制价", "安全文明施工费", "规费", "专业工程暂估价", "暂列金额"].forEach((label) => {
    const normalizedLabel = normalizeAnnotationText(label);
    if (normalizedContext.includes(normalizedLabel) && normalizedText.includes(normalizedLabel)) score += 50;
  });

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  if (/金额[^。；;]{0,20}[：:]\s*(元|万元)/.test(text)) score += 8;
  return score;
}

function applyMarkerFillValue(container, field) {
  const marker = field.marker;
  if (!container || !marker) return false;
  const page = getPreviewPageElement(container, marker.page || field.page || 1) || container;
  const target = findMarkerFillTarget(page, marker);
  if (!target) return false;

  if (field.type === "单选项") {
    const choiceTarget = findChoiceTarget(target, field);
    if (choiceTarget) {
      markChoiceTarget(choiceTarget);
      if (!shouldContinueFillAfterChoice(field)) return true;
    }
  }

  if (applyFirstBlankFillValue(target, field)) return true;
  if (marker.kind === "range") return applyMarkerRangeFillValue(page, marker, field);
  return false;
}

function shouldContinueFillAfterChoice(field) {
  const context = `${field.answerFormat || ""} ${field.question || ""}`;
  const value = getFieldAmountValue(field);
  return hasFillBlank(context) || /金额|限价|费用|报价|%|％|元|万元/.test(context) || /[0-9]/.test(value);
}

function findMarkerFillTarget(page, marker) {
  if (marker.kind === "range") {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    const startTarget = startNode?.parentElement?.closest?.("p, td, li, div");
    const endTarget = endNode?.parentElement?.closest?.("p, td, li, div");
    if (startTarget && startTarget === endTarget) return startTarget;
    return startTarget?.closest?.("td") || startTarget || endTarget;
  }

  if (marker.kind === "block") {
    const target = resolveNodePath(page, marker.elementPath);
    return target?.closest?.("p, td, li, div") || target;
  }

  return null;
}

function applyTemplateContextBlankFillValue(container, field) {
  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = [...scope.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!hasFillBlank(text) || text.length > 1800) return null;
      if (!isBlankCandidateCompatible(text, field)) return null;
      const score = scoreBlankFillCandidate(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function isBlankCandidateCompatible(text, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (expectsAmountBlank(context, getFieldAmountValue(field))) {
    return /(?:金额|限价|报价|费用)[^。；;]{0,30}[：:]\s*(?:元|万元)/.test(text);
  }
  return true;
}

function scoreBlankFillCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const contexts = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, ""), field.name].filter(Boolean);
  let score = 0;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  const contextTokens = [...new Set(contexts.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  contextTokens.forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(10, token.length);
  });

  if (score > 0 && hasFillBlank(text)) score += 5;
  return score;
}

function applyFirstBlankFillValue(target, field) {
  const text = target.textContent || "";
  const matches = collectBlankMatches(target).filter((item) => isUsefulFillBlank(text, item.match));
  if (matches.length === 0) return false;

  const bestMatch = chooseBestBlankMatch(text, matches, field);
  if (!bestMatch) return false;
  return replaceBlankMatchWithValue(target, bestMatch, field);
}

function applyMarkerRangeFillValue(page, marker, field) {
  const startNode = resolveNodePath(page, marker.startPath);
  const endNode = resolveNodePath(page, marker.endPath);
  if (!startNode || !endNode) return false;
  const target = startNode.parentElement?.closest?.("p, td, li, div");
  if (!target) return false;

  try {
    storeOriginalText(target);
    const range = document.createRange();
    range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
    range.deleteContents();
    const valueNode = document.createElement("span");
    valueNode.className = "docx-fill-value";
    valueNode.dataset.fieldId = field.id;
    valueNode.textContent = field.value;
    range.insertNode(valueNode);
    target.classList.add("docx-fill-mutated");
    return true;
  } catch {
    return false;
  }
}

function isUsefulFillBlank(text, match) {
  const index = match.index ?? 0;
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + match[0].length, index + match[0].length + 18);
  return /[：:（(，,、\u4e00-\u9fa5A-Za-z0-9□☐○〇▢]/.test(before) && /[\u4e00-\u9fa5A-Za-z0-9□☐○〇▢）),，,。；;]/.test(after);
}

function chooseBestBlankMatch(text, matches, field) {
  const compatibleMatches = filterCompatibleBlankMatches(text, matches, field);
  if (compatibleMatches.length === 0) return null;
  if (expectsAmountBlank(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`, getFieldAmountValue(field))) {
    return compatibleMatches[0];
  }
  const tokens = getFieldNameTokens(field.name);
  if (tokens.length === 0) return compatibleMatches[0];

  const ranked = compatibleMatches
    .map((item) => {
      const index = item.match.index ?? 0;
      const tokenDistances = tokens.map((token) => {
        const tokenIndex = text.lastIndexOf(token, index);
        return tokenIndex >= 0 ? index - tokenIndex : Number.POSITIVE_INFINITY;
      });
      const distance = Math.min(...tokenDistances);
      const labelScore = scoreBlankLocalLabel(text, index, field);
      return { item, distance, labelScore };
    })
    .sort((a, b) => b.labelScore - a.labelScore || a.distance - b.distance);

  const best = ranked[0];
  if (!best || (best.labelScore === 0 && !Number.isFinite(best.distance))) return null;
  return best.item;
}

function filterCompatibleBlankMatches(text, matches, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return matches;

  return matches.filter((item) => {
    const index = item.match.index ?? 0;
    const before = text.slice(Math.max(0, index - 42), index);
    const after = text.slice(index + item.match[0].length, index + item.match[0].length + 12);
    return /金额|限价|报价|费用/.test(before) && /元|万元/.test(after);
  });
}

function expectsAmountBlank(context, value) {
  return /金额|报价|费用|元|万元/.test(`${context || ""} ${value || ""}`) && /[0-9]/.test(String(value || ""));
}

function collectBlankMatches(target) {
  const items = [];
  let baseIndex = 0;
  collectTextNodes(target).forEach((node) => {
    const text = node.textContent || "";
    [...text.matchAll(/[_＿—-]{2,}|\s{2,}|(?<=[：:])\s+(?=元|万元|%|％|日历天|分钟|天)|(?<=的)\s+(?=%|％)/g)].forEach((match) => {
      items.push({
        node,
        localIndex: match.index ?? 0,
        match: {
          ...match,
          index: baseIndex + (match.index ?? 0),
          0: match[0],
        },
      });
    });
    baseIndex += text.length;
  });
  return items;
}

function replaceBlankMatchWithValue(target, item, field) {
  const { node, localIndex, match } = item;
  const text = node.textContent || "";
  if (!text || localIndex < 0) return false;
  storeOriginalHtml(target);
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = getBlankPreviewValue(field, target.textContent || "", match.index ?? 0);

  const afterNode = node.splitText(localIndex);
  afterNode.textContent = afterNode.textContent.slice(match[0].length);
  afterNode.parentNode?.insertBefore(valueNode, afterNode);
  target.classList.add("docx-fill-mutated");
  return true;
}

function getBlankPreviewValue(field, fullText, blankIndex) {
  const value = getFieldAmountValue(field);
  const before = fullText.slice(Math.max(0, blankIndex - 42), blankIndex);
  const label = before.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]+)\s*[：:]?\s*$/)?.[1] || "";
  if (!label || !value) return value;

  const normalizedLabel = normalizeAnnotationText(label);
  if (normalizedLabel.includes("金额") || normalizedLabel.includes("报价") || normalizedLabel.includes("费用") || normalizedLabel.includes("限价")) {
    const labelledAmount = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]?\\s*([^，,；;。\\s元]+)`));
    if (labelledAmount?.[1]) return labelledAmount[1].trim();
    const amount = value.match(/(?:人民币)?\s*([0-9][0-9,，.]*)\s*(?:万?元)?/);
    if (amount?.[1]) return amount[1].replace(/，/g, ",");
  }

  const labelledValue = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]\\s*([^，,；;。]+)`));
  if (labelledValue?.[1]) return labelledValue[1].trim();
  return value;
}

function scoreBlankLocalLabel(text, index, field) {
  const before = text.slice(Math.max(0, index - 36), index);
  const normalizedBefore = normalizeAnnotationText(before);
  return getFieldNameTokens(field.name).reduce((score, token) => {
    return normalizedBefore.includes(normalizeAnnotationText(token)) ? score + token.length : score;
  }, 0);
}

function getFieldNameTokens(name = "") {
  return String(name)
    .split(/[\s/／|｜,，、:：()（）]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(-4);
}

function applyLabelFillValue(target, field) {
  const text = target.textContent || "";
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const match = pattern.exec(text);
  if (!match) return false;

  replaceTargetTextWithValue({
    target,
    field,
    beforeValue: text.slice(0, match.index) + match[1],
    afterValue: text.slice(match.index + match[0].length),
  });
  return true;
}

function applyContextualFillValue(container, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const target = findContextualFillTarget(container, descriptor);
    if (!target) continue;
    const match = descriptor.pattern.exec(target.textContent || "");
    if (!match) continue;
    replaceTargetTextWithValue({
      target,
      field,
      beforeValue: target.textContent.slice(0, match.index) + match[1],
      afterValue: target.textContent.slice(match.index + match[0].length),
    });
    return true;
  }
  return false;
}

function applySectionLeadFillValue(container, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadDomTarget(container, sectionLabel, field);
  if (!target) return false;

  storeOriginalText(target);
  replaceTargetTextWithValue({
    target,
    field: { ...field, value: getSectionAnswerValue(field, sectionLabel) },
    beforeValue: `${sectionLabel}：`,
    afterValue: "",
    lead: true,
  });

  getSectionReplacementSourceNodes(target, sectionLabel).forEach((node) => {
    node.classList.add("docx-replaced-source");
    node.dataset.replacedByField = field.id;
  });
  return true;
}

function getSectionReplacementSourceNodes(target, sectionLabel) {
  const nodes = [];
  let current = target.nextElementSibling;
  while (current) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text) {
      current = current.nextElementSibling;
      continue;
    }
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      nodes.push(current);
    }
    current = current.nextElementSibling;
  }
  return nodes;
}

function findSectionLeadDomTarget(container, sectionLabel, field) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => isSectionLeadParagraph(node.textContent || "", sectionLabel))
    .map((node) => ({
      node,
      score: scoreSectionLeadCandidate(
        [node.textContent || "", ...getSectionFollowingDomTexts(node, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || (a.node.textContent?.length || 0) - (b.node.textContent?.length || 0))[0]?.node || null;
}

function getSectionFollowingDomTexts(target, sectionLabel) {
  const texts = [];
  let current = target.nextElementSibling;
  while (current && texts.length < 4) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
    current = current.nextElementSibling;
  }
  return texts;
}

function isNextSectionLead(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  if (!/^\d+[.、]/.test(text.trim())) return false;
  return !normalizedText.startsWith(normalizedLabel);
}

function isSectionNoRequirementOption(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return /^无.{0,12}要求/.test(normalizedText) && normalizedLabel.includes("要求");
}

function isSectionTemplateOptionParagraph(text, sectionLabel) {
  const trimmedText = String(text || "").trim();
  return /^[□☐○〇▢]/.test(trimmedText) || isSectionNoRequirementOption(trimmedText, sectionLabel);
}

function isSectionReplacementChoiceField(field) {
  return field.type === "单选项" && normalizeFillMode(field.fillMode, field) === "choice-replace" && Boolean(resolveSectionLeadLabel(field)) && shouldReplaceSectionWithAnswer(field);
}

function getSectionAnswerValue(field, sectionLabel) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  const label = normalizeChoiceText(sectionLabel).replace(/^\d+/, "");
  return value.replace(new RegExp(`^\\s*(?:\\d+[.、]\\s*)?${escapeRegExp(label)}\\s*[：:]?\\s*`), "").trim() || value;
}

function shouldReplaceSectionWithAnswer(field) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  if (/^无.{0,12}要求/.test(normalizeChoiceText(value))) return false;
  if (normalizeFillMode(field.fillMode, field) === "choice-replace") return true;
  if (value.length < 60) return false;
  return /[。；;，,]/.test(value) || value.length >= 90;
}

function scoreSectionLeadCandidate(candidateText, field, sectionLabel) {
  const candidate = normalizeChoiceText(candidateText);
  const format = normalizeChoiceText(field.answerFormat || "");
  const name = normalizeChoiceText(field.name || "");
  let score = 0;

  if (candidate.includes(normalizeChoiceText(sectionLabel))) score += 10;
  if (name && candidate.includes(name)) score += 6;
  if (!format) return score;

  const tokens = createSectionMatchTokens(format);
  tokens.forEach((token) => {
    if (candidate.includes(token)) score += Math.min(12, token.length);
  });
  return score;
}

function createSectionMatchTokens(text) {
  return [...new Set(String(text || "").split(/[□☐○〇▢_＿—\-]+/))]
    .map((item) => normalizeChoiceText(item))
    .filter((item) => item.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function getContextualFillDescriptors(field) {
  const contexts = [field.answerFormat, field.question, field.name]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return contexts
    .map((context) => {
      const quoteMatch = context.match(/^(.*?[“"])\s*([”"].*)$/);
      if (quoteMatch) return createContextualFillDescriptor(quoteMatch[1], quoteMatch[2]);

      const blankMatch = context.match(/^(.*?)(_{2,}|＿+|—+|-{2,}|\s{2,})(.*)$/);
      if (blankMatch) return createContextualFillDescriptor(blankMatch[1], blankMatch[3]);

      const punctBlankMatch = context.match(/^(.*?[：:][^。；;，,）)]*?)\s+([。；;，,）)].*)$/);
      if (punctBlankMatch) return createContextualFillDescriptor(punctBlankMatch[1], punctBlankMatch[2]);

      return null;
    })
    .filter(Boolean);
}

function createContextualFillDescriptor(prefix, suffix) {
  const cleanPrefix = prefix.trimEnd();
  const cleanSuffix = suffix.trimStart();
  if (!cleanPrefix || !cleanSuffix) return null;
  return {
    pattern: new RegExp(`(${escapeFlexibleContext(cleanPrefix)})([_＿—\\-\\s]*)(?=${escapeFlexibleContext(cleanSuffix)})`),
  };
}

function findContextualFillTarget(container, descriptor) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.length <= 240 && descriptor.pattern.test(node.textContent || "");
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))[0] || null;
}

function replaceTargetTextWithValue({ target, field, beforeValue, afterValue }) {
  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(beforeValue));
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = field.value;
  target.append(valueNode);
  target.append(document.createTextNode(afterValue));
  target.classList.add("docx-fill-mutated");
  if (arguments[0]?.lead) {
    target.classList.add("docx-section-fill-lead");
  }
}

function storeOriginalText(target) {
  if (!target.dataset.fillOriginalText) {
    target.dataset.fillOriginalText = target.textContent || "";
  }
}

function storeOriginalHtml(target) {
  if (!target.dataset.fillOriginalHtml && !target.dataset.fillOriginalText) {
    target.dataset.fillOriginalHtml = target.innerHTML || "";
  }
}

async function buildFilledDocxBuffer(templateFile, fields) {
  const filledFields = fields.filter((field) => field.value);
  fillBookmarkId = 50000;
  fillBookmarkNames = new Set();
  const zip = await JSZip.loadAsync(templateFile.buffer.slice(0));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX 缺少 word/document.xml");

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const xmlText = await documentFile.async("text");
  const doc = parser.parseFromString(xmlText, "application/xml");
  const paragraphs = [...doc.getElementsByTagName("w:p")];

  filledFields.forEach((field) => {
    if (applySectionLeadFillToDocxXml(paragraphs, field)) return;
    if (field.type === "单选项") {
      const choiceApplied = applyChoiceToDocxXml(paragraphs, field);
      if (choiceApplied && !shouldContinueFillAfterChoice(field)) return;
    }
    if (isDateField(field) && applyDateSegmentFillToDocxXml(paragraphs, field)) return;
    if (applyContextualFillToDocxXml(paragraphs, field)) return;
    applyLabelFillToDocxXml(paragraphs, field);
  });

  zip.file("word/document.xml", serializer.serializeToString(doc));
  await enableDocxTrackRevisions(zip, parser, serializer);
  return zip.generateAsync({
    type: "arraybuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function exportFilledDocx(templateFile, fields) {
  downloadDocxBuffer(await buildFilledDocxBuffer(templateFile, fields), buildExportFileName(templateFile.name));
}

async function enableDocxTrackRevisions(zip, parser, serializer) {
  const settingsFile = zip.file("word/settings.xml");
  if (!settingsFile) return;
  const settingsDoc = parser.parseFromString(await settingsFile.async("text"), "application/xml");
  const root = settingsDoc.documentElement;
  if (!root || root.getElementsByTagName("w:trackRevisions").length > 0) return;
  root.appendChild(settingsDoc.createElementNS(WORD_NS, "w:trackRevisions"));
  zip.file("word/settings.xml", serializer.serializeToString(settingsDoc));
}

function setXmlParagraphWithFill(paragraph, beforeValue, fillValue, afterValue, field, options = {}) {
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlRun(paragraph, beforeValue);
  appendXmlInsertedRun(paragraph, fillValue, field, options);
  appendXmlRun(paragraph, afterValue);
}

function appendXmlRun(parent, text, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const run = doc.createElementNS(WORD_NS, "w:r");
  const rPr = createXmlRunProperties(doc, options);
  if (rPr) run.appendChild(rPr);
  const textNode = doc.createElementNS(WORD_NS, "w:t");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  parent.appendChild(run);
}

function appendXmlInsertedRun(parent, text, field, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const bookmarkName = getFillBookmarkName(field);
  const shouldBookmark = bookmarkName && !fillBookmarkNames.has(bookmarkName);
  const bookmarkId = shouldBookmark ? fillBookmarkId++ : 0;
  if (shouldBookmark) {
    fillBookmarkNames.add(bookmarkName);
    const start = doc.createElementNS(WORD_NS, "w:bookmarkStart");
    start.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    start.setAttributeNS(WORD_NS, "w:name", bookmarkName);
    parent.appendChild(start);
  }
  const inserted = doc.createElementNS(WORD_NS, "w:ins");
  inserted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  inserted.setAttributeNS(WORD_NS, "w:author", getFillRevisionAuthor(field));
  inserted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  appendXmlRun(inserted, text, options);
  parent.appendChild(inserted);
  if (shouldBookmark) {
    const end = doc.createElementNS(WORD_NS, "w:bookmarkEnd");
    end.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    parent.appendChild(end);
  }
}

function getFillBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_FIELD_${id}` : "";
}

function getInputPointBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_INPUT_${id}` : "";
}

function getFillTargetBookmarkName(field) {
  return !isReplacementField(field) && field?.inputPoint?.bookmarkName ? field.inputPoint.bookmarkName : getFillBookmarkName(field);
}

function setXmlParagraphDeleted(paragraph) {
  const text = getXmlParagraphText(paragraph);
  if (!text.trim()) return;
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlDeletedRun(paragraph, text);
}

function appendXmlDeletedRun(parent, text) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const deleted = doc.createElementNS(WORD_NS, "w:del");
  deleted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  deleted.setAttributeNS(WORD_NS, "w:author", "AI填充");
  deleted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  const run = doc.createElementNS(WORD_NS, "w:r");
  const textNode = doc.createElementNS(WORD_NS, "w:delText");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  deleted.appendChild(run);
  parent.appendChild(deleted);
}

function createXmlRunProperties(doc, options = {}) {
  if (!options.underline) return null;
  const rPr = doc.createElementNS(WORD_NS, "w:rPr");
  const underline = doc.createElementNS(WORD_NS, "w:u");
  underline.setAttributeNS(WORD_NS, "w:val", "single");
  rPr.appendChild(underline);
  return rPr;
}

function getFillRevisionAuthor(field) {
  return String(field?.source || "").includes("人工") ? "人工填写" : "AI填充";
}

function shouldUnderlineFilledValue(blankText) {
  return /[_＿—\-\s]{2,}/.test(blankText || "");
}

function applyDateSegmentFillToDocxXml(paragraphs, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const candidates = paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => text.length <= 260 && hasDateSegmentBlank(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreDateSegmentCandidate(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  const target = candidates[0];
  if (!target) return false;

  const match = getDateSegmentBlankPattern().exec(target.text);
  if (!match) return false;
  const replacement = buildDateSegmentReplacement(match[0], parts);
  if (!replacement) return true;

  setXmlParagraphWithFill(
    target.item,
    target.text.slice(0, match.index),
    replacement,
    target.text.slice(match.index + match[0].length),
    field,
    { underline: shouldUnderlineFilledValue(match[0]) },
  );
  return true;
}

function applyChoiceToDocxXml(paragraphs, field) {
  const keywords = getChoiceKeywords(getFieldChoiceValue(field), `${field.name || ""} ${field.question || ""} ${field.answerFormat || ""}`);
  if (keywords.length === 0) return false;

  const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => {
    return /[□☐○〇▢☑✓✔]/.test(text) && Boolean(findMatchedChoiceKeyword(text, keywords));
  });
  if (!paragraph) return false;

  const textNodes = getXmlTextNodes(paragraph);
  textNodes.forEach((node) => {
    node.textContent = (node.textContent || "").replace(/[☑✓✔]/g, "□");
  });

  const keyword = findMatchedChoiceKeyword(getXmlParagraphText(paragraph), keywords);
  const keywordPosition = findXmlKeywordPosition(textNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestXmlChoiceMarkerBefore(textNodes, keywordPosition)
    : findFirstXmlChoiceMarker(textNodes);

  if (!markerPosition) return false;
  const markerIndex = getXmlTextNodeOffset(textNodes, markerPosition.node, markerPosition.index);
  const paragraphText = getXmlParagraphText(paragraph);
  if (markerIndex < 0) return false;
  setXmlParagraphWithFill(paragraph, paragraphText.slice(0, markerIndex), "☑", paragraphText.slice(markerIndex + 1), field);
  return true;
}

function getXmlTextNodeOffset(nodes, targetNode, localIndex) {
  let offset = 0;
  for (const node of nodes) {
    if (node === targetNode) return offset + localIndex;
    offset += (node.textContent || "").length;
  }
  return -1;
}

function applyContextualFillToDocxXml(paragraphs, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => descriptor.pattern.test(text));
    if (!paragraph) continue;
    const text = getXmlParagraphText(paragraph);
    const match = descriptor.pattern.exec(text);
    if (!match) continue;
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }
  return false;
}

function applySectionLeadFillToDocxXml(paragraphs, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadXmlTarget(paragraphs, sectionLabel, field);
  const paragraph = target?.item;
  if (!paragraph) return false;

  setXmlParagraphWithFill(paragraph, `${sectionLabel}：`, getSectionAnswerValue(field, sectionLabel), "", field);
  removeSectionTemplateOptionParagraphs(paragraphs, target.index, sectionLabel);
  return true;
}

function findSectionLeadXmlTarget(paragraphs, sectionLabel, field) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => isSectionLeadParagraph(text, sectionLabel))
    .map((target) => ({
      ...target,
      score: scoreSectionLeadCandidate(
        [target.text, ...getSectionFollowingXmlTexts(paragraphs, target.index, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0];
}

function getSectionFollowingXmlTexts(paragraphs, startIndex, sectionLabel) {
  const texts = [];
  for (let index = startIndex + 1; index < paragraphs.length && texts.length < 4; index += 1) {
    const text = getXmlParagraphText(paragraphs[index]).replace(/\s+/g, " ").trim();
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
  }
  return texts;
}

function removeSectionTemplateOptionParagraphs(paragraphs, startIndex, sectionLabel) {
  for (let index = startIndex + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const text = getXmlParagraphText(paragraph);
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      setXmlParagraphDeleted(paragraph);
    }
  }
}

function resolveSectionLeadLabel(field) {
  const source = getTemplateFieldSourceText(field) || field.name || "";
  const match = source.match(/^\s*(\d+[.、]\s*)?[□☐○〇▢☑✓✔]?\s*([^：:；;。]{2,24}要求)\s*[：:]/);
  if (match) return `${(match[1] || "").replace(/\s+/g, "")}${match[2].replace(/\s+/g, "")}`;
  return "";
}

function isSectionLeadParagraph(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return normalizedText.startsWith(normalizedLabel) && (normalizedText.length <= normalizedLabel.length + 8 || normalizedLabel.includes("要求"));
}

function applyLabelFillToDocxXml(paragraphs, field) {
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const paragraph = findBestXmlParagraphForField(
    paragraphs,
    field,
    (text) => text.includes(field.name) && /[：:]/.test(text),
  );
  if (!paragraph) return false;
  const text = getXmlParagraphText(paragraph);
  const match = pattern.exec(text);
  if (match) {
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }

  return applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field);
}

function applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field) {
  const labelIndex = findFieldLabelIndex(text, field.name);
  if (labelIndex < 0) return false;

  const colonIndex = findColonAfterIndex(text, labelIndex);
  const searchStart = colonIndex >= 0 ? colonIndex + 1 : labelIndex + field.name.length;
  const tail = text.slice(searchStart);
  const blankMatch = /[_＿—\-\s]{2,}/.exec(tail);
  if (!blankMatch) return false;

  const blankStart = searchStart + blankMatch.index;
  setXmlParagraphWithFill(
    paragraph,
    text.slice(0, blankStart),
    field.value,
    text.slice(blankStart + blankMatch[0].length),
    field,
    { underline: shouldUnderlineFilledValue(blankMatch[0]) },
  );
  return true;
}

function findBestXmlParagraphForField(paragraphs, field, predicate) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => predicate(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreXmlParagraphForField(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.index - b.index)[0]?.item || null;
}

function scoreXmlParagraphForField(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  let score = 0;
  if (field.name && text.includes(field.name)) score += 12;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 6;
  });

  getFieldContextTokens(field).forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(24, token.length * 2);
  });

  getFieldContextTexts(field).forEach((context) => {
    const normalizedContext = normalizeAnnotationText(context);
    if (!normalizedContext) return;
    if (normalizedText.includes(normalizedContext)) score += 120;
    else if (normalizedContext.includes(normalizedText) && normalizedText.length >= 8) score += 60;
  });

  return score;
}

function getFieldContextTexts(field) {
  return [
    field.marker?.text,
    field.answerFormat,
    field.question?.replace(/^模板上下文[：:]/, ""),
  ]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2);
}

function getFieldContextTokens(field) {
  return [...new Set(getFieldContextTexts(field).flatMap((text) => {
    return text
      .split(/[□☐○〇▢_＿—\-\s,，。；;:：（）()、/／]+/)
      .map((item) => normalizeAnnotationText(item))
      .filter((item) => item.length >= 2);
  }))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function findFieldLabelIndex(text, fieldName) {
  const names = [
    fieldName,
    String(fieldName || "").replace(/^\s*\d+[.、]\s*/, ""),
    String(fieldName || "").replace(/[（）()]/g, ""),
  ]
    .map((name) => name.trim())
    .filter(Boolean);

  for (const name of [...new Set(names)]) {
    const index = text.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function findColonAfterIndex(text, startIndex) {
  const colonIndex = text.indexOf("：", startIndex);
  const halfColonIndex = text.indexOf(":", startIndex);
  if (colonIndex < 0) return halfColonIndex;
  if (halfColonIndex < 0) return colonIndex;
  return Math.min(colonIndex, halfColonIndex);
}

function getXmlTextNodes(paragraph) {
  return [...paragraph.getElementsByTagName("w:t")];
}

function getXmlParagraphText(paragraph) {
  return getXmlTextNodes(paragraph)
    .map((node) => node.textContent || "")
    .join("");
}

function setXmlParagraphText(paragraph, text) {
  const textNodes = getXmlTextNodes(paragraph);
  if (textNodes.length === 0) return;
  textNodes[0].textContent = text;
  for (let index = 1; index < textNodes.length; index += 1) {
    textNodes[index].textContent = "";
  }
}

function findXmlKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };
    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestXmlChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstXmlChoiceMarker(nodes);
}

function findFirstXmlChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function findChoiceTarget(container, field) {
  const value = typeof field === "string" ? field : getFieldChoiceValue(field);
  const context = typeof field === "string" ? "" : `${field?.name || ""} ${field?.question || ""} ${field?.answerFormat || ""}`;
  const keywords = getChoiceKeywords(value, context);
  if (keywords.length === 0) return null;

  const splitNodeTarget = collectTextNodes(container)
    .map((node) => {
      const matchedKeyword = findMatchedChoiceKeyword(node.textContent || "", keywords);
      if (!matchedKeyword) return null;
      const paragraph = node.parentElement?.closest?.("p, td, li, div");
      if (!paragraph || !hasChoiceMarker(paragraph)) return null;
      return { element: paragraph, keyword: matchedKeyword };
    })
    .find(Boolean);
  if (splitNodeTarget) return splitNodeTarget;

  const candidates = [...container.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!/[□☐○〇▢☑✓✔]/.test(text)) return null;
      const matchedKeyword = findMatchedChoiceKeyword(text, keywords);
      return matchedKeyword ? { element: node, keyword: matchedKeyword } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.element.textContent?.length || 0) - (b.element.textContent?.length || 0));
  return candidates[0] || null;
}

function hasChoiceMarker(node) {
  return collectTextNodes(node).some((textNode) => /[□☐○〇▢☑✓✔]/.test(textNode.textContent || ""));
}

function markChoiceTarget(target) {
  const element = target?.element ?? target;
  const keyword = target?.keyword ?? "";
  if (!element) return;

  const nearbyNodes = collectTextNodes(element);
  const keywordPosition = findKeywordPosition(nearbyNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestChoiceMarkerBefore(nearbyNodes, keywordPosition)
    : findFirstChoiceMarker(nearbyNodes);

  if (!markerPosition) return;

  const { node, index } = markerPosition;
  const text = node.textContent || "";
  element.classList.add("docx-choice-selected");
  node.textContent = `${text.slice(0, index)}☑${text.slice(index + 1)}`;
}

function findKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };

    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstChoiceMarker(nodes);
}

function findFirstChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function findMatchedChoiceKeyword(text, keywords) {
  const normalizedText = normalizeChoiceText(text);
  return keywords.find((keyword) => {
    const normalizedKeyword = normalizeChoiceText(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword);
  });
}

function getChoiceKeywords(value, context = "") {
  const normalizedValue = normalizeChoiceText(value);
  const keywords = [];

  collectChoiceKeywordsFromText(normalizedValue, keywords);

  const bracketMatches = [...String(value || "").matchAll(/[（(]([^（）()]{2,24})[）)]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  keywords.push(...bracketMatches);

  if (normalizedValue && normalizedValue.length <= 18) {
    keywords.push(value);
  }

  if (keywords.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), keywords);
  }

  return [...new Set(keywords)]
    .map((item) => String(item || "").trim())
    .filter((item) => normalizeChoiceText(item).length >= 2)
    .sort((a, b) => normalizeChoiceText(b).length - normalizeChoiceText(a).length);
}

function collectChoiceKeywordsFromText(normalizedText, keywords) {
  if (normalizedText.includes("综合评估法")) {
    keywords.push("综合评估法", "综合评分法");
  }
  if (normalizedText.includes("最低投标价法")) {
    keywords.push("经评审的最低投标价法", "最低投标价法");
  }
  if (normalizedText.includes("不含税")) {
    keywords.push("不含税");
  } else if (normalizedText.includes("含税")) {
    keywords.push("含税");
  }
}

function normalizeChoiceText(value) {
  return (value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/^第[一二三四五六七八九十\d]+章\s*/, "")
    .replace(/[（）()：:，,。；;\s]/g, "")
    .replace(/综合评分法/g, "综合评估法")
    .trim();
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const chineseMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})(?:\s*时\s*|[:：])\s*(\d{1,2})\s*分?)?/);
  if (chineseMatch) {
    return {
      year: chineseMatch[1],
      month: chineseMatch[2],
      day: chineseMatch[3],
      hour: chineseMatch[4] || "",
      minute: chineseMatch[5] || "",
    };
  }

  const numericMatch = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2})[:：时](\d{1,2})(?:分)?)?/);
  if (numericMatch) {
    return {
      year: numericMatch[1],
      month: padDatePart(numericMatch[2]),
      day: padDatePart(numericMatch[3]),
      hour: numericMatch[4] ? padDatePart(numericMatch[4]) : "",
      minute: numericMatch[5] ? padDatePart(numericMatch[5]) : "",
    };
  }

  const spacedMatch = text.match(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})(?:\s+(\d{1,2})\s+(\d{1,2}))?/);
  if (spacedMatch) {
    return {
      year: spacedMatch[1],
      month: padDatePart(spacedMatch[2]),
      day: padDatePart(spacedMatch[3]),
      hour: spacedMatch[4] ? padDatePart(spacedMatch[4]) : "",
      minute: spacedMatch[5] ? padDatePart(spacedMatch[5]) : "",
    };
  }

  return null;
}

function padDatePart(value) {
  return String(value || "").padStart(2, "0");
}

function isDateField(field) {
  return normalizeFillMode(field?.fillMode, field) === "date" || field?.type === "日期" || /日期|年\s*月\s*日|年月日|编制时间/.test(`${field?.name || ""} ${field?.answerFormat || ""} ${field?.question || ""}`);
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function findFillTarget(container, fieldName) {
  const candidates = [...container.querySelectorAll("p, td, div, span")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.includes(fieldName) && /[：:]/.test(text) && text.length <= 120;
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
  return candidates[0] || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeFlexibleContext(value) {
  return escapeRegExp(value).replace(/\s+/g, "\\s*");
}

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

async function waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer, options = {}) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const intervalMs = options.intervalMs ?? 700;
  const start = Date.now();
  await delay(options.initialDelayMs ?? 900);
  while (Date.now() - start < timeoutMs) {
    const buffer = await fetchOfficeDocumentBuffer(officeDocId);
    if (buffer && (!baselineBuffer || !arrayBuffersEqual(buffer, baselineBuffer))) return buffer;
    await delay(intervalMs);
  }
  return null;
}

async function fetchOfficeDocumentBuffer(officeDocId) {
  if (!officeDocId) return null;
  const response = await fetch(`/api/office/documents/${officeDocId}/file?t=${Date.now()}`, { cache: "no-store" });
  return response.ok ? response.arrayBuffer() : null;
}

function arrayBuffersEqual(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}



export {
  createPreviewId,
  waitForNextFrame,
  auditConfigStorageKey,
  auditConfigItems,
  auditIssueConfigMap,
  aiOutlineSourceIssueIds,
  defaultAuditConfig,
  emptyPdfHighlights,
  WORD_NS,
  XML_NS,
  aiRevisionId,
  fillBookmarkId,
  fillBookmarkNames,
  getFillFieldDisplayPage,
  DocumentFrame,
  OnlyOfficePreview,
  buildOnlyOfficeAnnotationFieldPayload,
  buildOnlyOfficeFillFieldPayload,
  postOnlyOfficeCommand,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeAddFieldBookmark,
  requestOnlyOfficeAddInputPoint,
  requestOnlyOfficeFillField,
  postAllOnlyOfficeFrames,
  requestOnlyOfficeDocumentDownloadAs,
  fetchOnlyOfficeDownloadAsBuffer,
  buildOnlyOfficeLiveFillText,
  getFieldAmountValue,
  getFieldChoiceValue,
  buildOnlyOfficeChoiceFillText,
  scoreChoiceOptionMatch,
  readOnlyOfficePageNumber,
  loadOnlyOfficeApi,
  AuditPdfPreview,
  AuditPdfHighlighter,
  FieldLine,
  PreviewState,
  FieldForm,
  FillFieldRow,
  getChoiceEditOptions,
  cleanChoiceOptionText,
  getFillSupplementReason,
  toDateInputValue,
  formatChineseDateFromInput,
  getNextFieldNumber,
  readAuditConfig,
  isKnownAuditConfigId,
  isAuditIssueEnabled,
  shouldRunAiOutlineAudit,
  enhanceAuditWithAiOutline,
  buildForcedOutlineTargets,
  mergeAiOutlineTargets,
  getUniversalOutlineAuditRules,
  normalizeOnlyOfficeOutlineForAi,
  buildAiOutlineCandidates,
  buildOnlyOfficeOutlineCandidates,
  buildOnlyOfficeOutlineTextMap,
  normalizeOutlineMatchText,
  getAiOutlineBlockLevel,
  filterResolvedAiOutlineTargets,
  isSafeOutlineDemoteTarget,
  isProtectedOutlineHeading,
  isAiOutlineCandidateBlock,
  createAiOutlineIssues,
  makeAiOutlineIssue,
  getOutlineRevisionReason,
  getOutlineRevisionAction,
  applyPreviewMarker,
  markRangeTextNodes,
  collectTextNodesInRange,
  createAnnotationMarkerData,
  getClosestPreviewSection,
  getNodePath,
  resolveNodePath,
  removePreviewMarker,
  clearPreviewMarkers,
  restoreAnnotationPreviewMarkers,
  clearRestoredAnnotationMarkers,
  restoreAnnotationMarkerByData,
  findAnnotationFieldTarget,
  scoreAnnotationTarget,
  createAnnotationTargetTokens,
  splitAnnotationContextTokens,
  normalizeAnnotationText,
  getAnnotationNodeRank,
  WORD_XML_NS,
  readDocxStructure,
  structureLocalName,
  structureElementChildren,
  structureDescendants,
  getStructureAttr,
  getStructureNodeText,
  getStructureTableText,
  getStructureParagraphStyleId,
  readStructureStyleMap,
  structureChineseNumberToInt,
  structureHeadingLevelFromStyle,
  normalizeStructureString,
  inferStructureHeadingLevel,
  structureOutlineTitle,
  structureBlockPreview,
  addStructureOutlineNode,
  readDocxOutlineItems,
  collectDocxOutlineItems,
  parseDocxOutlineStyles,
  parseDocxNumbering,
  parseNumberingLevel,
  parseNumberingProperties,
  resolveParagraphNumbering,
  formatAndAdvanceNumbering,
  formatNumberValue,
  toChineseNumber,
  toLetterNumber,
  toRomanNumber,
  joinOutlineNumbering,
  getParagraphFieldInfo,
  isTocStyle,
  parseHeadingStyleLevel,
  parseOutlineLevel,
  getWordXmlAttr,
  getWordXmlChild,
  getWordXmlChildren,
  getWordXmlElements,
  getWordXmlParagraphText,
  syncRenderedTocEntries,
  getRenderedTocLevel,
  findRenderedTocOutlineMatch,
  getChapterKey,
  extractOutlineItems,
  getRenderedDocumentParagraphNodes,
  getOutlineNodeBySourceParagraphIndex,
  normalizeOutlineTitle,
  isRenderedTocNode,
  isOutlineTitleMatch,
  highlightSearchMatches,
  getSearchHits,
  setActiveSearchHit,
  collectSearchTextNodes,
  clearSearchHighlights,
  applyFillPreviewValues,
  applyDateSegmentFillValue,
  replaceDateSegmentInTarget,
  appendDateFillPart,
  hasDateSegmentBlank,
  getDateSegmentBlankPattern,
  buildDateSegmentFillText,
  buildDateSegmentReplacement,
  dateSegmentNeedsTime,
  scoreDateSegmentCandidate,
  applyAmountUnitFillValue,
  getScopedCandidateNodes,
  scoreAmountUnitCandidate,
  applyMarkerFillValue,
  shouldContinueFillAfterChoice,
  findMarkerFillTarget,
  applyTemplateContextBlankFillValue,
  isBlankCandidateCompatible,
  scoreBlankFillCandidate,
  applyFirstBlankFillValue,
  applyMarkerRangeFillValue,
  isUsefulFillBlank,
  chooseBestBlankMatch,
  filterCompatibleBlankMatches,
  expectsAmountBlank,
  collectBlankMatches,
  replaceBlankMatchWithValue,
  getBlankPreviewValue,
  scoreBlankLocalLabel,
  getFieldNameTokens,
  applyLabelFillValue,
  applyContextualFillValue,
  applySectionLeadFillValue,
  getSectionReplacementSourceNodes,
  findSectionLeadDomTarget,
  getSectionFollowingDomTexts,
  isNextSectionLead,
  isSectionNoRequirementOption,
  isSectionTemplateOptionParagraph,
  isSectionReplacementChoiceField,
  getSectionAnswerValue,
  shouldReplaceSectionWithAnswer,
  scoreSectionLeadCandidate,
  createSectionMatchTokens,
  getContextualFillDescriptors,
  createContextualFillDescriptor,
  findContextualFillTarget,
  replaceTargetTextWithValue,
  storeOriginalText,
  storeOriginalHtml,
  buildFilledDocxBuffer,
  exportFilledDocx,
  enableDocxTrackRevisions,
  setXmlParagraphWithFill,
  appendXmlRun,
  appendXmlInsertedRun,
  getFillBookmarkName,
  getInputPointBookmarkName,
  getFillTargetBookmarkName,
  setXmlParagraphDeleted,
  appendXmlDeletedRun,
  createXmlRunProperties,
  getFillRevisionAuthor,
  shouldUnderlineFilledValue,
  applyDateSegmentFillToDocxXml,
  applyChoiceToDocxXml,
  getXmlTextNodeOffset,
  applyContextualFillToDocxXml,
  applySectionLeadFillToDocxXml,
  findSectionLeadXmlTarget,
  getSectionFollowingXmlTexts,
  removeSectionTemplateOptionParagraphs,
  resolveSectionLeadLabel,
  isSectionLeadParagraph,
  applyLabelFillToDocxXml,
  applyFirstBlankAfterFieldLabelToDocxXml,
  findBestXmlParagraphForField,
  scoreXmlParagraphForField,
  getFieldContextTexts,
  getFieldContextTokens,
  findFieldLabelIndex,
  findColonAfterIndex,
  getXmlTextNodes,
  getXmlParagraphText,
  setXmlParagraphText,
  findXmlKeywordPosition,
  findNearestXmlChoiceMarkerBefore,
  findFirstXmlChoiceMarker,
  findChoiceTarget,
  hasChoiceMarker,
  markChoiceTarget,
  findKeywordPosition,
  findNearestChoiceMarkerBefore,
  findFirstChoiceMarker,
  findMatchedChoiceKeyword,
  getChoiceKeywords,
  collectChoiceKeywordsFromText,
  normalizeChoiceText,
  parseDateParts,
  padDatePart,
  isDateField,
  collectTextNodes,
  findFillTarget,
  escapeRegExp,
  escapeFlexibleContext,
  getRenderedPageCount,
  normalizePreviewPageLayout,
  splitOverlongPreviewPage,
  splitPreviewTableIfNeeded,
  createEmptyPreviewTable,
  getPreviewTableBody,
  createPreviewPageClone,
  getPreviewPageTargetHeight,
  getPreviewPageOverflowLimit,
  parseCssPixels,
  preparePreviewPages,
  getPreviewPageElement,
  scrollPreviewToPage,
  getAuditPdfScrollContainer,
  getAuditPdfPageElement,
  scrollAuditPdfToPage,
  collectPdfPageTexts,
  getAuditPdfSearchHits,
  resolveAuditPdfOutlinePage,
  flattenAuditPdfOutline,
  flashAuditPdfPage,
  scrollPreviewToElement,
  resolveVisiblePreviewPage,
  resolveVisibleAuditPdfPage,
  isPreviewPageMostlyVisible,
  clampNumber,
  resolvePreviewPage,
  waitForChangedOfficeDocumentBuffer,
  fetchOfficeDocumentBuffer,
  arrayBuffersEqual,
  delay,
};


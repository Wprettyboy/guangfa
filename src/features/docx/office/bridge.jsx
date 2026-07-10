import React, { useEffect, useRef } from "react";
import {
  buildOnlyOfficeAnnotationFieldPayload,
  buildOnlyOfficeFillFieldPayload,
} from "./payload.js";
import {
  getFillBookmarkName,
  getInputPointBookmarkName,
} from "../fill/helpers.js";
import {
  getTemplateFieldSourceText,
  hasInputPoint,
  requiresInputPoint,
} from "../../../utils/fields.js";
import {
  clearOnlyOfficeEditor,
  getOnlyOfficeConnectorStatus,
  registerOnlyOfficeEditor,
} from "./connector.js";
import { insertSolutionWritingWithConnector } from "./solutionConnector.js";

let onlyOfficeFillRequestSeq = 0;
let onlyOfficePlaceholderRequestSeq = 0;
let onlyOfficeComplexFillRequestSeq = 0;
let onlyOfficeLayoutRequestSeq = 0;
let onlyOfficeLayoutAnalyzeRequestSeq = 0;
let onlyOfficeKnowledgeTableRequestSeq = 0;
let onlyOfficeKnowledgeImageRequestSeq = 0;
let onlyOfficeSolutionWritingRequestSeq = 0;

const complexFillWriteTransientErrorPattern = /复杂类填充书签接口不可用|书签定位接口不可用|未找到对应复杂类填充书签|未找到对应书签|未能选中对应复杂类填充书签范围|书签定位失败|OnlyOffice 当前光标位置不可用/;

function OnlyOfficePreview({ config, annotationFields = [], fillFields = [], aiKnowledgeContext = null, trackRevisionsEnabled = false, mode, serverUrl, onReady, onError }) {
  const containerRef = useRef(null);
  const holderIdRef = useRef(`onlyoffice-${Math.random().toString(36).slice(2)}`);
  const annotationFieldPayloadRef = useRef([]);
  const fillFieldPayloadRef = useRef([]);
  const aiKnowledgeContextRef = useRef(aiKnowledgeContext);
  const trackRevisionsEnabledRef = useRef(trackRevisionsEnabled);

  useEffect(() => {
    annotationFieldPayloadRef.current = buildOnlyOfficeAnnotationFieldPayload(annotationFields);
  }, [annotationFields, mode]);

  useEffect(() => {
    fillFieldPayloadRef.current = buildOnlyOfficeFillFieldPayload(fillFields);
    if (mode === "fill") {
      return postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "sync-fill-fields",
        fields: fillFieldPayloadRef.current,
      }, 2);
    }
    return undefined;
  }, [fillFields, mode]);

  useEffect(() => {
    aiKnowledgeContextRef.current = aiKnowledgeContext;
    if (mode === "fill") {
      return postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "sync-ai-knowledge-context",
        context: aiKnowledgeContext,
      }, 2);
    }
    return undefined;
  }, [aiKnowledgeContext, mode]);

  useEffect(() => {
    trackRevisionsEnabledRef.current = trackRevisionsEnabled;
    if (mode === "fill") {
      return postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "set-track-revisions",
        enabled: trackRevisionsEnabled,
      }, 2);
    }
    return undefined;
  }, [mode, trackRevisionsEnabled]);

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
                  postOnlyOfficeCommand(container, {
                    source: "guangfa-parent",
                    action: "set-track-revisions",
                    enabled: trackRevisionsEnabledRef.current,
                  });
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
              registerOnlyOfficeEditor(editor);
              if (mode === "fill") {
                window.setTimeout(() => {
                  postOnlyOfficeCommand(container, {
                    source: "guangfa-parent",
                    action: "set-track-revisions",
                    enabled: trackRevisionsEnabledRef.current,
                  });
                }, 350);
              }
            },
            onDownloadAs: (event) => {
              config.events?.onDownloadAs?.(event);
              window.dispatchEvent(new CustomEvent("guangfa-onlyoffice-download-as", { detail: event?.data || {} }));
            },
            onError: () => onError?.(),
          },
        });
        window.__guangfaActiveOnlyOfficeEditor = editor;
        registerOnlyOfficeEditor(editor);
      })
      .catch(() => onError?.());

    return () => {
      cancelled = true;
      if (window.__guangfaActiveOnlyOfficeEditor === editor) window.__guangfaActiveOnlyOfficeEditor = null;
      clearOnlyOfficeEditor(editor);
      try {
        editor?.destroyEditor?.();
      } catch {}
      if (container.contains(holder)) container.removeChild(holder);
    };
  }, [config, serverUrl]);

  return <div className="onlyoffice-preview-host" ref={containerRef} />;
}

function postOnlyOfficeCommand(container, message, attempts = 8) {
  return retryOnlyOfficePost(() => {
    const frames = [...(container?.querySelectorAll?.("iframe") || [])];
    frames.forEach((frame) => {
      try {
        frame.contentWindow?.postMessage(message, "*");
      } catch {}
    });
  }, attempts);
}

function requestOnlyOfficeDocumentSave(trigger = "manual") {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage({ source: "guangfa-parent", action: "save-document", trigger }, "*");
    } catch {}
  });
}

function requestOnlyOfficeApplyLayoutFormat(plan, options = {}) {
  const requestId = options.requestId || `layout-${Date.now()}-${++onlyOfficeLayoutRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 15000);
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "layout-format-applied") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, summary: "OnlyOffice 未响应排版命令。", items: [] }), timeoutMs);
    window.addEventListener("message", handleMessage);
    console.log("[guangfa-layout-format-command]", { requestId, actions: Array.isArray(plan?.actions) ? plan.actions.length : 0 });
    cancelPost = postAllOnlyOfficeFrames({
      source: "guangfa-parent",
      action: "apply-layout-format",
      requestId,
      plan,
    }, 24);
  });
}

function requestOnlyOfficeAnalyzeLayoutFormat(standard, options = {}) {
  const requestId = options.requestId || `layout-analyze-${Date.now()}-${++onlyOfficeLayoutAnalyzeRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 15000);
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "layout-format-analyzed") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, summary: "OnlyOffice 未响应格式体检命令。", findings: [] }), timeoutMs);
    window.addEventListener("message", handleMessage);
    console.log("[guangfa-layout-format-analyze-command]", { requestId, rules: Array.isArray(standard?.rules) ? standard.rules.length : 0 });
    cancelPost = postAllOnlyOfficeFrames({
      source: "guangfa-parent",
      action: "analyze-layout-format",
      requestId,
      standard,
    }, 24);
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

function requestOnlyOfficeFillField(field, options = {}) {
  const clear = options.clear === true;
  if (!clear && !field?.value && !field?.choiceValue) return Promise.resolve({ ok: false, skipped: true, reason: "empty-value", id: field?.id });
  if (!clear && requiresInputPoint(field) && !hasInputPoint(field)) {
    console.warn("[fill] skip write without input point", { id: field.id, sourceText: getTemplateFieldSourceText(field) });
    return Promise.resolve({ ok: false, skipped: true, reason: "missing-input-point", id: field.id });
  }
  const requestId = options.requestId || `fill-${Date.now()}-${++onlyOfficeFillRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 12000);
  const payload = buildOnlyOfficeFillFieldPayload([field])[0] || {};
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "field-fill") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, id: field.id, requestId, timeout: true, error: "OnlyOffice 未在限定时间内确认字段写入。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames({
      source: "guangfa-parent",
      action: "fill-field-value",
      requestId,
      field: {
        ...payload,
        requestId,
        clear,
        suppressPageSync: Boolean(options.suppressPageSync),
      },
    }, 0);
  });
}

function requestOnlyOfficeInsertPlaceholderVariable(variable, anchorIndex) {
  const requestId = `placeholder-${Date.now()}-${++onlyOfficePlaceholderRequestSeq}`;
  const message = {
    source: "guangfa-parent",
    action: "insert-placeholder-variable",
    requestId,
    variable: {
      id: variable.id,
      name: variable.name,
      token: variable.token,
      anchorIndex,
    },
  };
  return new Promise((resolve) => {
    let done = false;
    let firstFailure = null;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "placeholder-anchor-inserted") return;
      if (data.result?.requestId !== requestId) return;
      if (data.result?.ok) {
        finish(data.result);
        return;
      }
      firstFailure ||= data.result;
    };
    const timer = window.setTimeout(() => finish(firstFailure || { ok: false, timeout: true, requestId, error: "OnlyOffice 未响应自动字段插入命令。" }), 8000);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 8);
  });
}

function requestOnlyOfficeSelectPlaceholderAnchor(anchor) {
  return requestOnlyOfficePlaceholderAnchorAction("select-placeholder-anchor", "placeholder-anchor-selected", anchor);
}

function requestOnlyOfficeDeletePlaceholderAnchor(anchor) {
  return requestOnlyOfficePlaceholderAnchorAction("delete-placeholder-anchor", "placeholder-anchor-deleted", anchor);
}

function requestOnlyOfficeFillPlaceholderVariable(variableFill, options = {}) {
  const anchors = Array.isArray(variableFill?.anchors) ? variableFill.anchors : [];
  const requestId = `placeholder-fill-${Date.now()}-${++onlyOfficePlaceholderRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || Math.max(12000, anchors.length * 4000));
  const message = {
    source: "guangfa-parent",
    action: "fill-placeholder-variable",
    requestId,
    variable: {
      id: variableFill?.id,
      name: variableFill?.name,
      token: variableFill?.token,
    },
    value: variableFill?.value || "",
    anchors,
  };
  return new Promise((resolve) => {
    let done = false;
    let firstFailure = null;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "placeholder-variable-filled") return;
      if (data.result?.requestId !== requestId) return;
      if (data.result?.ok) {
        finish(data.result);
        return;
      }
      firstFailure ||= data.result;
    };
    const timer = window.setTimeout(() => finish(firstFailure || { ok: false, timeout: true, requestId, error: "OnlyOffice 未响应自动字段填充命令。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 8);
  });
}

function requestOnlyOfficeAddComplexFillAnchor(anchor) {
  return requestOnlyOfficeComplexFillAction(
    "add-complex-fill-anchor",
    "complex-fill-anchor-added",
    { anchor },
    "OnlyOffice 未响应复杂类填充书签建立命令。",
  );
}

function requestOnlyOfficeSelectComplexFillAnchor(anchor) {
  return requestOnlyOfficeComplexFillAction(
    "select-complex-fill-anchor",
    "complex-fill-anchor-selected",
    { bookmarkName: anchor?.bookmarkName, anchor },
    "OnlyOffice 未响应复杂类填充书签定位命令。",
  );
}

function requestOnlyOfficeDeleteComplexFillAnchor(anchor) {
  return requestOnlyOfficeComplexFillAction(
    "delete-complex-fill-anchor",
    "complex-fill-anchor-deleted",
    { bookmarkName: anchor?.bookmarkName, anchor },
    "OnlyOffice 未响应复杂类填充书签删除命令。",
    8000,
    { postAttempts: 0 },
  );
}

function requestOnlyOfficeFillComplexFillField(complexFill, options = {}) {
  const anchors = Array.isArray(complexFill?.anchors) ? complexFill.anchors : [];
  const timeoutMs = Number(options.timeoutMs || Math.max(12000, anchors.length * 5000));
  return requestOnlyOfficeComplexFillAction(
    "fill-complex-fill-field",
    "complex-fill-field-filled",
    {
      field: {
        id: complexFill?.id,
        fieldSummary: complexFill?.fieldSummary,
      },
      value: complexFill?.value || "",
      anchors,
    },
    "OnlyOffice 未响应复杂类填充写入命令。",
    timeoutMs,
    {
      failureGraceMs: 4500,
      postAttempts: 18,
      shouldDeferFailure: isTransientComplexFillWriteFailure,
    },
  );
}

function requestOnlyOfficeInsertKnowledgeTable(table, options = {}) {
  const requestId = options.requestId || `knowledge-table-${Date.now()}-${++onlyOfficeKnowledgeTableRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 30000);
  const message = {
    source: "guangfa-parent",
    action: "insert-knowledge-table",
    requestId,
    table,
  };
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "knowledge-table-inserted") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应资料表格插入命令。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 0);
  });
}

async function imageToOnlyOfficeDataUrl(image) {
  if (image?.dataUrl || image?.base64) return image;
  const candidates = [image?.previewUrl, image?.fileUrl, image?.imageUrl].filter(Boolean);
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
        reader.readAsDataURL(blob);
      });
      if (dataUrl) return { ...image, dataUrl };
    } catch {
      // Keep the original URL fallback when the browser cannot read one candidate.
    }
  }
  return image;
}

async function requestOnlyOfficeInsertKnowledgeImage(image, options = {}) {
  const requestId = options.requestId || `knowledge-image-${Date.now()}-${++onlyOfficeKnowledgeImageRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 30000);
  const officeImage = await imageToOnlyOfficeDataUrl(image);
  const message = {
    source: "guangfa-parent",
    action: "insert-knowledge-image",
    requestId,
    image: officeImage,
  };
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "knowledge-image-inserted") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应资料图片插入命令。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 0);
  });
}

function requestOnlyOfficeOutline(options = {}) {
  const requestId = options.requestId || `outline-${Date.now()}-${++onlyOfficeSolutionWritingRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const message = {
    source: "guangfa-parent",
    action: "request-outline",
    requestId,
  };
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "onlyoffice-outline-probe") return;
      if (data.outline?.requestId !== requestId) return;
      finish(data.outline);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应大纲读取命令。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 8);
  });
}

function requestOnlyOfficeInsertSolutionText(text, options = {}) {
  const requestId = options.requestId || `solution-writing-${Date.now()}-${++onlyOfficeSolutionWritingRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 12000);
  const paragraphs = Array.isArray(options.paragraphs) ? options.paragraphs : [];
  if (paragraphs.length && !options.skipConnector) {
    return insertSolutionWritingWithConnector({ text, paragraphs, requestId, timeoutMs, replaceTarget: options.replaceTarget || null })
      .then((result) => {
        if (result?.skipped === true) {
          return requestOnlyOfficeInsertSolutionTextViaProbe(text, { ...options, requestId, timeoutMs, connectorResult: result });
        }
        return result;
      });
  }
  return requestOnlyOfficeInsertSolutionTextViaProbe(text, { ...options, requestId, timeoutMs });
}

function requestOnlyOfficeInsertSolutionTextViaProbe(text, options = {}) {
  const requestId = options.requestId || `solution-writing-${Date.now()}-${++onlyOfficeSolutionWritingRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 12000);
  const message = {
    source: "guangfa-parent",
    action: "insert-solution-writing-text",
    requestId,
    text,
    paragraphs: Array.isArray(options.paragraphs) ? options.paragraphs : [],
    replaceTarget: options.replaceTarget || null,
    connectorResult: options.connectorResult || null,
  };
  return new Promise((resolve) => {
    let done = false;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "solution-writing-inserted") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应方案正文写入命令。" }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 0);
  });
}

function isTransientComplexFillWriteFailure(result) {
  const errors = [
    result?.error,
    ...(Array.isArray(result?.results) ? result.results.map((item) => item?.error) : []),
  ].filter(Boolean).join("\n");
  return complexFillWriteTransientErrorPattern.test(errors);
}

function requestOnlyOfficeComplexFillAction(action, resultAction, payload, timeoutError, timeoutMs = 8000, options = {}) {
  const requestId = `complex-fill-${Date.now()}-${++onlyOfficeComplexFillRequestSeq}`;
  const failureGraceMs = Number.isFinite(Number(options.failureGraceMs)) ? Math.max(0, Number(options.failureGraceMs)) : 700;
  const postAttempts = Number.isFinite(Number(options.postAttempts)) ? Math.max(0, Number(options.postAttempts)) : 8;
  const shouldDeferFailure = typeof options.shouldDeferFailure === "function" ? options.shouldDeferFailure : () => true;
  const message = {
    source: "guangfa-parent",
    action,
    requestId,
    ...payload,
  };
  return new Promise((resolve) => {
    let done = false;
    let firstFailure = null;
    let failureTimer = null;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (failureTimer) window.clearTimeout(failureTimer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== resultAction) return;
      if (data.result?.requestId !== requestId) return;
      if (data.result?.ok) {
        finish(data.result);
        return;
      }
      if (!shouldDeferFailure(data.result)) {
        finish(data.result);
        return;
      }
      firstFailure ||= data.result;
      if (!failureTimer) {
        failureTimer = window.setTimeout(() => finish(firstFailure), failureGraceMs);
      }
    };
    const timer = window.setTimeout(() => finish(firstFailure || { ok: false, timeout: true, requestId, error: timeoutError }), timeoutMs);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, postAttempts);
  });
}

function requestOnlyOfficePlaceholderAnchorAction(action, resultAction, anchor) {
  const requestId = `placeholder-${Date.now()}-${++onlyOfficePlaceholderRequestSeq}`;
  const message = {
    source: "guangfa-parent",
    action,
    requestId,
    bookmarkName: anchor?.bookmarkName,
    anchor,
  };
  return new Promise((resolve) => {
    let done = false;
    let firstFailure = null;
    let failureTimer = null;
    let cancelPost = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (failureTimer) window.clearTimeout(failureTimer);
      cancelPost();
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== resultAction) return;
      if (data.result?.requestId !== requestId) return;
      if (data.result?.ok) {
        finish(data.result);
        return;
      }
      firstFailure ||= data.result;
      if (!failureTimer) {
        failureTimer = window.setTimeout(() => finish(firstFailure), 700);
      }
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应自动字段书签命令。" }), 8000);
    window.addEventListener("message", handleMessage);
    cancelPost = postAllOnlyOfficeFrames(message, 8);
  });
}

function postAllOnlyOfficeFrames(message, attempts = 8) {
  return retryOnlyOfficePost(() => {
    [...document.querySelectorAll("iframe")].forEach((frame) => {
      try {
        frame.contentWindow?.postMessage(message, "*");
        postFrameChildren(frame.contentWindow, message);
      } catch {}
    });
  }, attempts);
}

function retryOnlyOfficePost(post, attempts) {
  let cancelled = false;
  let timer = null;
  const send = (remaining) => {
    if (cancelled) return;
    post();
    if (remaining > 0) timer = window.setTimeout(() => send(remaining - 1), 250);
  };
  send(Math.max(0, Number(attempts) || 0));
  return () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
  };
}

function postFrameChildren(frameWindow, message) {
  try {
    for (let index = 0; index < frameWindow.frames.length; index += 1) {
      const child = frameWindow.frames[index];
      child.postMessage(message, "*");
      postFrameChildren(child, message);
    }
  } catch {}
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

function readOnlyOfficePageNumber(payload) {
  const value =
    typeof payload === "number" || typeof payload === "string"
      ? payload
      : payload?.page ?? payload?.currentPage ?? payload?.visiblePage ?? payload?.value;
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function loadOnlyOfficeApi(serverUrl) {
  const scriptUrl = `${String(serverUrl || "").replace(/\/$/, "")}/web-apps/apps/api/documents/api.js?gf=27`;
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
    document.head.appendChild(script);
  });
}

export {
  OnlyOfficePreview,
  fetchOnlyOfficeDownloadAsBuffer,
  loadOnlyOfficeApi,
  postAllOnlyOfficeFrames,
  postOnlyOfficeCommand,
  readOnlyOfficePageNumber,
  getOnlyOfficeConnectorStatus,
  requestOnlyOfficeAddFieldBookmark,
  requestOnlyOfficeAddInputPoint,
  requestOnlyOfficeAddComplexFillAnchor,
  requestOnlyOfficeAnalyzeLayoutFormat,
  requestOnlyOfficeApplyLayoutFormat,
  requestOnlyOfficeDeleteComplexFillAnchor,
  requestOnlyOfficeDocumentDownloadAs,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeDeletePlaceholderAnchor,
  requestOnlyOfficeFillField,
  requestOnlyOfficeFillComplexFillField,
  requestOnlyOfficeInsertKnowledgeImage,
  requestOnlyOfficeInsertKnowledgeTable,
  requestOnlyOfficeInsertSolutionText,
  requestOnlyOfficeOutline,
  requestOnlyOfficeFillPlaceholderVariable,
  requestOnlyOfficeInsertPlaceholderVariable,
  requestOnlyOfficeSelectComplexFillAnchor,
  requestOnlyOfficeSelectPlaceholderAnchor,
};

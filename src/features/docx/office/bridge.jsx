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

let onlyOfficeFillRequestSeq = 0;
let onlyOfficePlaceholderRequestSeq = 0;

function OnlyOfficePreview({ config, annotationFields = [], fillFields = [], aiKnowledgeContext = null, trackRevisionsEnabled = true, mode, serverUrl, onReady, onError }) {
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
    trackRevisionsEnabledRef.current = trackRevisionsEnabled;
    if (mode === "fill") {
      postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "set-track-revisions",
        enabled: trackRevisionsEnabled,
      }, 2);
    }
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

function requestOnlyOfficeFillField(field, options = {}) {
  if (!field?.value && !field?.choiceValue) return Promise.resolve({ ok: false, skipped: true, reason: "empty-value", id: field?.id });
  if (requiresInputPoint(field) && !hasInputPoint(field)) {
    console.warn("[fill] skip write without input point", { id: field.id, sourceText: getTemplateFieldSourceText(field) });
    return Promise.resolve({ ok: false, skipped: true, reason: "missing-input-point", id: field.id });
  }
  const requestId = options.requestId || `fill-${Date.now()}-${++onlyOfficeFillRequestSeq}`;
  const timeoutMs = Number(options.timeoutMs || 12000);
  const payload = buildOnlyOfficeFillFieldPayload([field])[0] || {};
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
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
    postAllOnlyOfficeFrames({
      source: "guangfa-parent",
      action: "fill-field-value",
      requestId,
      field: {
        ...payload,
        requestId,
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
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", handleMessage);
      resolve(result);
    };
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom" || data.action !== "placeholder-anchor-inserted") return;
      if (data.result?.requestId !== requestId) return;
      finish(data.result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, requestId, error: "OnlyOffice 未响应自动字段插入命令。" }), 8000);
    window.addEventListener("message", handleMessage);
    postAllOnlyOfficeFrames(message, 8);
  });
}

function requestOnlyOfficeSelectPlaceholderAnchor(anchor) {
  return requestOnlyOfficePlaceholderAnchorAction("select-placeholder-anchor", "placeholder-anchor-selected", anchor);
}

function requestOnlyOfficeDeletePlaceholderAnchor(anchor) {
  return requestOnlyOfficePlaceholderAnchorAction("delete-placeholder-anchor", "placeholder-anchor-deleted", anchor);
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
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (failureTimer) window.clearTimeout(failureTimer);
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
    postAllOnlyOfficeFrames(message, 8);
  });
}

function postAllOnlyOfficeFrames(message, attempts = 8) {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
      postFrameChildren(frame.contentWindow, message);
    } catch {}
  });
  if (attempts > 0) window.setTimeout(() => postAllOnlyOfficeFrames(message, attempts - 1), 250);
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
  const scriptUrl = `${String(serverUrl || "").replace(/\/$/, "")}/web-apps/apps/api/documents/api.js?gf=26`;
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
  requestOnlyOfficeAddFieldBookmark,
  requestOnlyOfficeAddInputPoint,
  requestOnlyOfficeDocumentDownloadAs,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeDeletePlaceholderAnchor,
  requestOnlyOfficeFillField,
  requestOnlyOfficeInsertPlaceholderVariable,
  requestOnlyOfficeSelectPlaceholderAnchor,
};

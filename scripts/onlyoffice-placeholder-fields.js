(function () {
  const handledRequestIds = new Set();

  function safeCall(target, name, fallback, ...args) {
    try {
      return target && typeof target[name] === "function" ? target[name](...args) : fallback;
    } catch {
      return fallback;
    }
  }

  function getApplication() {
    try {
      return window.DE && typeof window.DE.getController === "function" ? window.DE : null;
    } catch {
      return null;
    }
  }

  function getEditorApi() {
    const app = getApplication();
    const navigation = app && typeof app.getController === "function" ? app.getController("Navigation") : null;
    return navigation?.api || window.Asc?.editor || window.editor || null;
  }

  function getLogicDocument() {
    const api = getEditorApi();
    return api?.WordControl?.m_oLogicDocument || window.Asc?.editor?.WordControl?.m_oLogicDocument || null;
  }

  function getBookmarkManager() {
    const logicDocument = getLogicDocument();
    return logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
  }

  function normalizeName(name) {
    return String(name || "").replace(/\s+/g, "").trim().slice(0, 40);
  }

  function normalizeSelectionText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function buildToken(name) {
    const normalizedName = normalizeName(name);
    return normalizedName ? "{{" + normalizedName + "}}" : "";
  }

  function normalizeVariable(variable) {
    const name = normalizeName(variable?.name || variable?.label || variable?.key);
    const token = String(variable?.token || buildToken(name));
    return {
      id: String(variable?.id || "PV-001"),
      name,
      token,
      anchorIndex: Math.max(1, Number(variable?.anchorIndex || variable?.index || 1) || 1),
    };
  }

  function buildBookmarkName(variableId, index) {
    const safeId = String(variableId || "PV").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
    return "GF_PH_" + safeId + "_" + String(Math.max(1, Number(index) || 1)).padStart(3, "0");
  }

  function readSelectedText(target) {
    const options = { NewLine: true, ParaSeparator: "\n", Numbering: false };
    const attempts = [
      () => target.GetSelectedText(false, options),
      () => target.GetSelectedText(true, options),
      () => target.asc_GetSelectedText(false, options),
      () => target.getSelectedText(),
    ];
    for (const attempt of attempts) {
      try {
        const text = normalizeSelectionText(attempt());
        if (text) return text;
      } catch {}
    }
    return "";
  }

  function getSelectionPage(selectionState) {
    const docState = Array.isArray(selectionState) ? selectionState[selectionState.length - 1] : null;
    const rawPage = Number(docState?.CurPage);
    if (Number.isFinite(rawPage)) return Math.max(1, rawPage + 1);
    const api = getEditorApi();
    const page = Number(api?.WordControl?.m_oDrawingDocument?.m_lCurrentPage);
    return Number.isFinite(page) ? Math.max(1, page + 1) : 1;
  }

  function removeSelectedTextForReplacement() {
    const logicDocument = getLogicDocument();
    const selectedText = readSelectedText(logicDocument) || readSelectedText(getEditorApi());
    if (!selectedText) return { ok: true, skipped: true };
    try {
      if (typeof logicDocument?.RemoveBeforePaste === "function") {
        logicDocument.RemoveBeforePaste();
        return { ok: true, source: "remove-before-paste" };
      }
      if (typeof logicDocument?.Remove === "function") {
        logicDocument.Remove(1, true, true, true);
        return { ok: true, source: "logic-remove" };
      }
      return { ok: false, error: "当前选区无法替换，请把光标放到插入位置后重试。" };
    } catch (error) {
      return { ok: false, error: error?.message || "替换当前选区失败" };
    }
  }

  function enterText(text) {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    try {
      if (api && typeof api.asc_enterText === "function") {
        api.asc_enterText(Array.from(text).map(function (char) { return char.codePointAt(0); }));
        return { ok: true, source: "asc-enter-text" };
      }
      if (logicDocument && typeof logicDocument.EnterText === "function") {
        logicDocument.EnterText(text);
        return { ok: true, source: "logic-enter-text" };
      }
      return { ok: false, error: "文本输入接口不可用" };
    } catch (error) {
      return { ok: false, error: error?.message || "占位符写入失败" };
    }
  }

  function selectInsertedText(text) {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.MoveCursorLeft !== "function") {
      return { ok: false, error: "光标选择接口不可用" };
    }
    try {
      Array.from(text).forEach(function () {
        logicDocument.MoveCursorLeft(true, false);
      });
      const selectedText = normalizeSelectionText(readSelectedText(logicDocument) || readSelectedText(getEditorApi()));
      const compactSelected = selectedText.replace(/\s+/g, "");
      const compactExpected = normalizeSelectionText(text).replace(/\s+/g, "");
      if (compactSelected !== compactExpected) {
        return { ok: false, selectedText, error: "未能重新选中刚插入的占位符，请撤销后重试。" };
      }
      return { ok: true, selectedText };
    } catch (error) {
      return { ok: false, error: error?.message || "占位符选区定位失败" };
    }
  }

  function applyInsertedPlaceholderHighlight() {
    const api = getEditorApi();
    try {
      if (api && typeof api.put_LineHighLight === "function") {
        api.put_LineHighLight(true, 229, 231, 235);
        return { ok: true, color: "E5E7EB", source: "line-highlight" };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "占位符灰色底纹设置失败" };
    }
    return { ok: true, skipped: true, reason: "line-highlight-api-unavailable" };
  }

  function saveDocument(trigger) {
    const api = getEditorApi();
    try {
      if (api && typeof api.asc_Save === "function") api.asc_Save(false);
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "office-save", ok: true, trigger }, "*");
    } catch {}
  }

  function postPlaceholderResult(action, result) {
    const message = { source: "guangfa-onlyoffice-custom", action, result };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
  }

  function postInsertedResult(result) {
    return postPlaceholderResult("placeholder-anchor-inserted", result);
  }

  function selectPlaceholderBookmark(bookmarkName) {
    const manager = getBookmarkManager();
    if (!manager || !bookmarkName || typeof manager.SelectBookmark !== "function") {
      return { ok: false, bookmarkName, error: "OnlyOffice 书签定位接口不可用" };
    }
    try {
      if (manager.SelectBookmark(bookmarkName) === false) {
        return { ok: false, bookmarkName, error: "未找到对应自动字段书签" };
      }
      const page = getSelectionPage(safeCall(getLogicDocument(), "GetSelectionState", null));
      return { ok: true, bookmarkName, page };
    } catch (error) {
      return { ok: false, bookmarkName, error: error?.message || "自动字段书签定位失败" };
    }
  }

  function jumpToPlaceholderAnchor(payload = {}) {
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || "");
    const requestId = payload.requestId || "";
    const result = selectPlaceholderBookmark(bookmarkName);
    return postPlaceholderResult("placeholder-anchor-selected", { ...result, requestId });
  }

  function deletePlaceholderAnchor(payload = {}) {
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || "");
    const requestId = payload.requestId || "";
    const selected = selectPlaceholderBookmark(bookmarkName);
    if (!selected.ok) return postPlaceholderResult("placeholder-anchor-deleted", { ...selected, requestId });
    const manager = getBookmarkManager();
    const removeText = removeSelectedTextForReplacement();
    if (!removeText.ok) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page, error: removeText.error });
    }
    try {
      if (typeof manager?.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      saveDocument("placeholder-variable-delete");
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: true, requestId, bookmarkName, page: selected.page });
    } catch (error) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page, error: error?.message || "自动字段书签删除失败" });
    }
  }

  function insertPlaceholderVariable(payload = {}) {
    const variable = normalizeVariable(payload.variable || payload);
    const requestId = payload.requestId || "";
    try { console.log("[guangfa-placeholder-insert]", requestId, variable); } catch {}
    if (requestId && handledRequestIds.has(requestId)) {
      return { ok: true, requestId, skipped: true, reason: "duplicate-request" };
    }
    if (!variable.name || !variable.token) {
      return postInsertedResult({ ok: false, requestId, error: "字段名称为空，无法插入占位符。" });
    }
    const manager = getBookmarkManager();
    if (!manager || typeof manager.AddBookmark !== "function") {
      return postInsertedResult({ ok: false, requestId, error: "OnlyOffice 书签接口不可用" });
    }

    const bookmarkName = payload.bookmarkName || buildBookmarkName(variable.id, variable.anchorIndex);
    if (requestId) handledRequestIds.add(requestId);
    const selectionState = safeCall(getLogicDocument(), "GetSelectionState", null);
    const removeResult = removeSelectedTextForReplacement();
    if (!removeResult.ok) return postInsertedResult({ ok: false, requestId, bookmarkName, error: removeResult.error });

    const enterResult = enterText(variable.token);
    if (!enterResult.ok) return postInsertedResult({ ok: false, requestId, bookmarkName, error: enterResult.error });

    const selectResult = selectInsertedText(variable.token);
    if (!selectResult.ok) return postInsertedResult({ ok: false, requestId, bookmarkName, error: selectResult.error, selectedText: selectResult.selectedText });
    const highlightResult = applyInsertedPlaceholderHighlight();

    try {
      if (typeof manager.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      manager.AddBookmark(bookmarkName);
      const page = getSelectionPage(safeCall(getLogicDocument(), "GetSelectionState", selectionState));
      saveDocument("placeholder-variable");
      return postInsertedResult({
        ok: true,
        requestId,
        anchor: {
          variableId: variable.id,
          variableName: variable.name,
          token: variable.token,
          bookmarkName,
          page,
          index: variable.anchorIndex,
          documentOrder: page * 1000000 + variable.anchorIndex,
          highlight: highlightResult,
        },
      });
    } catch (error) {
      return postInsertedResult({ ok: false, requestId, bookmarkName, error: error?.message || "占位符书签写入失败" });
    }
  }

  window.guangfaInsertPlaceholderVariable = insertPlaceholderVariable;
  window.guangfaJumpToPlaceholderAnchor = jumpToPlaceholderAnchor;
  window.guangfaDeletePlaceholderAnchor = deletePlaceholderAnchor;

  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.source === "guangfa-parent" && data.action === "insert-placeholder-variable") {
      insertPlaceholderVariable(data);
    }
    if (data.source === "guangfa-parent" && data.action === "select-placeholder-anchor") {
      jumpToPlaceholderAnchor(data);
    }
    if (data.source === "guangfa-parent" && data.action === "delete-placeholder-anchor") {
      deletePlaceholderAnchor(data);
    }
  });
})();

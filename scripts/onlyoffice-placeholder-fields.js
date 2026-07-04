(function () {
  const handledRequestIds = new Set();
  let fallbackBookmarkIdSeed = 0;

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
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const logicManager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    try {
      if (api && typeof api.asc_GetBookmarksManager === "function") {
        const manager = api.asc_GetBookmarksManager();
        if (manager && (!logicManager || typeof manager.GetNewBookmarkId === "function")) return manager;
      }
    } catch {}
    return logicManager;
  }

  function normalizeName(name) {
    return String(name || "").replace(/\s+/g, "").trim().slice(0, 40);
  }

  function normalizeSelectionText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactSelectionText(value) {
    return normalizeSelectionText(value).replace(/\s+/g, "");
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

  function currentSelectionPage() {
    return getSelectionPage(safeCall(getLogicDocument(), "GetSelectionState", null));
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

  function createPlaceholderTextPr() {
    const CTextPr = window.AscWord?.CTextPr || window.AscCommonWord?.CTextPr;
    const CDocumentColor = window.AscCommonWord?.CDocumentColor;
    if (typeof CTextPr !== "function") return null;
    const textPr = new CTextPr();
    if (typeof textPr.SetBold === "function") textPr.SetBold(true);
    if (typeof textPr.SetColor === "function") textPr.SetColor(31, 78, 121, false);
    if (typeof textPr.SetHighlight === "function" && typeof CDocumentColor === "function") {
      textPr.SetHighlight(new CDocumentColor(229, 231, 235, false));
    }
    return textPr;
  }

  function removePlaceholderBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_RemoveBookmark === "function") return manager.asc_RemoveBookmark(bookmarkName);
      if (typeof manager?.RemoveBookmark === "function") return manager.RemoveBookmark(bookmarkName);
    } catch {}
    return false;
  }

  function createPlaceholderBookmarkId(manager) {
    try {
      if (typeof manager?.GetNewBookmarkId === "function") {
        return manager.GetNewBookmarkId();
      }
    } catch {}
    fallbackBookmarkIdSeed += 1;
    return String(Date.now()) + String(fallbackBookmarkIdSeed).padStart(4, "0");
  }

  function insertFormattedBookmarkedPlaceholder(text, bookmarkName, manager) {
    return insertBookmarkedInlineText(text, bookmarkName, manager, { placeholderStyle: true });
  }

  function insertBookmarkedInlineText(text, bookmarkName, manager, options) {
    const logicDocument = getLogicDocument();
    const Paragraph = window.AscWord?.Paragraph;
    const ParaRun = window.AscWord?.ParaRun || window.AscCommonWord?.ParaRun;
    const BookmarkClass = window.AscWord?.CParagraphBookmark || window.AscCommonWord?.CParagraphBookmark;
    const SelectedContent = window.AscCommonWord?.CSelectedContent;
    const SelectedElement = window.AscCommonWord?.CSelectedElement;
    if (!logicDocument || !manager) {
      return { ok: false, error: "OnlyOffice 书签生成接口不可用" };
    }
    if (
      typeof Paragraph !== "function"
      || typeof ParaRun !== "function"
      || typeof BookmarkClass !== "function"
      || typeof SelectedContent !== "function"
      || typeof SelectedElement !== "function"
    ) {
      return { ok: false, error: "OnlyOffice 标签内容生成接口不可用" };
    }

    let actionStarted = false;
    try {
      const changeType = window.AscCommon?.changestype_Paragraph_AddText;
      const isLocked = changeType && typeof logicDocument.IsSelectionLocked === "function"
        ? logicDocument.IsSelectionLocked(changeType, null, false, safeCall(logicDocument, "IsFormFieldEditing", false))
        : false;
      if (isLocked) return { ok: false, error: "当前选区被锁定，无法插入自动字段。" };

      const historyType = window.AscDFH?.historydescription_Document_AddTextWithProperties;
      if (typeof logicDocument.StartAction === "function") {
        logicDocument.StartAction(historyType);
        actionStarted = true;
      }

      if (typeof logicDocument.RemoveBeforePaste === "function") {
        logicDocument.RemoveBeforePaste();
      }

      const currentParagraph = typeof logicDocument.GetCurrentParagraph === "function" ? logicDocument.GetCurrentParagraph() : null;
      if (!currentParagraph || typeof currentParagraph.GetCurrentAnchorPosition !== "function") {
        return { ok: false, error: "OnlyOffice 当前光标位置不可用" };
      }

      const bookmarkId = createPlaceholderBookmarkId(manager);
      const tempParagraph = new Paragraph();
      const run = new ParaRun(tempParagraph, false);
      run.AddText(text);

      const currentTextPr = safeCall(logicDocument, "GetDirectTextPr", null);
      if (currentTextPr && typeof currentTextPr.Copy === "function" && typeof run.SetPr === "function") {
        run.SetPr(currentTextPr.Copy());
      }
      const placeholderTextPr = options?.placeholderStyle === false ? null : createPlaceholderTextPr();
      if (placeholderTextPr && typeof run.ApplyPr === "function") {
        run.ApplyPr(placeholderTextPr);
      }

      tempParagraph.AddToContent(0, new BookmarkClass(true, bookmarkId, bookmarkName));
      tempParagraph.AddToContent(1, run);
      tempParagraph.AddToContent(2, new BookmarkClass(false, bookmarkId, bookmarkName));
      safeCall(tempParagraph, "Correct_Content", null);

      const selectedContent = new SelectedContent();
      selectedContent.Add(new SelectedElement(tempParagraph, false));
      selectedContent.EndCollect(logicDocument);
      selectedContent.ForceInlineInsert();
      selectedContent.PlaceCursorInLastInsertedRun(false);
      const inserted = selectedContent.Insert(currentParagraph.GetCurrentAnchorPosition());
      if (inserted === false) return { ok: false, error: "OnlyOffice 标签内容插入失败" };

      safeCall(logicDocument, "Recalculate", null);
      safeCall(logicDocument, "UpdateInterface", null);
      safeCall(logicDocument, "UpdateSelection", null);
      safeCall(manager, "Update", null);
      return { ok: true, source: "selected-content-bookmark-run", style: placeholderTextPr ? "highlight+bold+color" : "document-current-style" };
    } catch (error) {
      return { ok: false, error: error?.message || "自动字段标签生成失败" };
    } finally {
      if (actionStarted) safeCall(logicDocument, "FinalizeAction", null);
    }
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

  function hasPlaceholderBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_HaveBookmark === "function") return manager.asc_HaveBookmark(bookmarkName);
      return typeof manager?.HaveBookmark === "function" ? manager.HaveBookmark(bookmarkName) : true;
    } catch {
      return true;
    }
  }

  function goToPlaceholderBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_GoToBookmark === "function") {
        manager.asc_GoToBookmark(bookmarkName);
        return true;
      }
      if (typeof manager?.GoToBookmark === "function") {
        manager.GoToBookmark(bookmarkName);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function selectPlaceholderBookmark(bookmarkName) {
    const manager = getBookmarkManager();
    if (!manager || !bookmarkName) {
      return { ok: false, bookmarkName, error: "OnlyOffice 书签定位接口不可用" };
    }
    try {
      if (!hasPlaceholderBookmark(manager, bookmarkName)) {
        return { ok: false, bookmarkName, error: "未找到对应自动字段书签" };
      }
      const moved = goToPlaceholderBookmark(manager, bookmarkName);
      const selected = typeof manager.asc_SelectBookmark === "function"
        ? manager.asc_SelectBookmark(bookmarkName) !== false
        : typeof manager.SelectBookmark === "function"
          ? manager.SelectBookmark(bookmarkName) !== false
          : false;
      const page = getSelectionPage(safeCall(getLogicDocument(), "GetSelectionState", null));
      return { ok: moved || selected, bookmarkName, page, selected, moved };
    } catch (error) {
      return { ok: false, bookmarkName, error: error?.message || "自动字段书签定位失败" };
    }
  }

  function selectTextForward(text) {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.MoveCursorRight !== "function") {
      return { ok: false, error: "光标选择接口不可用" };
    }
    try {
      Array.from(text).forEach(function () {
        logicDocument.MoveCursorRight(true, false);
      });
      const selectedText = normalizeSelectionText(readSelectedText(logicDocument) || readSelectedText(getEditorApi()));
      const compactSelected = compactSelectionText(selectedText);
      const compactExpected = compactSelectionText(text);
      if (compactSelected !== compactExpected) {
        return { ok: false, selectedText, error: "未能选中自动字段文本，无法安全删除。" };
      }
      return { ok: true, selectedText };
    } catch (error) {
      return { ok: false, error: error?.message || "自动字段文本选中失败" };
    }
  }

  function jumpToPlaceholderAnchor(payload = {}) {
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || "");
    const requestId = payload.requestId || "";
    const result = selectPlaceholderBookmark(bookmarkName);
    return postPlaceholderResult("placeholder-anchor-selected", { ...result, requestId });
  }

  function ensurePlaceholderTokenSelected(token, bookmarkName) {
    const normalizedToken = normalizeSelectionText(token);
    if (!normalizedToken) return { ok: true, skipped: true };
    const selectedText = normalizeSelectionText(readSelectedText(getLogicDocument()) || readSelectedText(getEditorApi()));
    if (compactSelectionText(selectedText) === compactSelectionText(normalizedToken)) {
      return { ok: true, selectedText, source: "current-selection" };
    }
    const manager = getBookmarkManager();
    if (bookmarkName) goToPlaceholderBookmark(manager, bookmarkName);
    const forwardSelection = selectTextForward(normalizedToken);
    if (forwardSelection.ok) return { ...forwardSelection, source: "forward-from-bookmark" };
    return {
      ok: false,
      error: forwardSelection.error || "未能选中自动字段文本，无法安全删除。",
    };
  }

  function deletePlaceholderAnchor(payload = {}) {
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || "");
    const requestId = payload.requestId || "";
    const selected = selectPlaceholderBookmark(bookmarkName);
    if (!selected.ok) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ...selected, requestId });
    }
    const token = payload.anchor?.token || payload.token || "";
    const tokenSelection = ensurePlaceholderTokenSelected(token, bookmarkName);
    if (!tokenSelection.ok) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page, error: tokenSelection.error });
    }
    const manager = getBookmarkManager();
    const removeText = removeSelectedTextForReplacement();
    if (!removeText.ok || removeText.skipped) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page, error: removeText.error || "未能选中自动字段文本，未删除文档内容。" });
    }
    try {
      if (typeof manager?.asc_RemoveBookmark === "function") manager.asc_RemoveBookmark(bookmarkName);
      else if (typeof manager?.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: true, requestId, bookmarkName, page: selected.page });
    } catch (error) {
      return postPlaceholderResult("placeholder-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page, error: error?.message || "自动字段书签删除失败" });
    }
  }

  function fillPlaceholderAnchor(anchor, value) {
    const bookmarkName = String(anchor?.bookmarkName || "");
    const manager = getBookmarkManager();
    if (!manager || !bookmarkName) {
      return { ok: false, bookmarkName, error: "OnlyOffice 书签填充接口不可用" };
    }
    const selected = selectPlaceholderBookmark(bookmarkName);
    if (!selected.ok) return selected;
    try {
      removePlaceholderBookmark(manager, bookmarkName);
      const insertResult = insertBookmarkedInlineText(value, bookmarkName, manager, { placeholderStyle: false });
      if (!insertResult.ok) {
        return { ok: false, bookmarkName, page: selected.page, error: insertResult.error || "自动字段填充值写入失败" };
      }
      const bookmarkResult = selectPlaceholderBookmark(bookmarkName);
      return {
        ok: true,
        bookmarkName,
        page: bookmarkResult.page || selected.page || currentSelectionPage(),
        source: insertResult.source,
      };
    } catch (error) {
      return { ok: false, bookmarkName, page: selected.page, error: error?.message || "自动字段填充值写入失败" };
    }
  }

  function fillPlaceholderVariable(payload = {}) {
    const requestId = payload.requestId || "";
    const value = normalizeSelectionText(payload.value);
    const anchors = Array.isArray(payload.anchors) ? payload.anchors : payload.anchor ? [payload.anchor] : [];
    if (!value) {
      return postPlaceholderResult("placeholder-variable-filled", { ok: false, requestId, error: "自动字段填充值为空。" });
    }
    if (anchors.length === 0) {
      return postPlaceholderResult("placeholder-variable-filled", { ok: false, requestId, error: "当前字段没有可填充的书签。" });
    }
    const results = anchors.map(function (anchor) {
      return fillPlaceholderAnchor(anchor, value);
    });
    const failed = results.filter(function (result) { return !result.ok; });
    return postPlaceholderResult("placeholder-variable-filled", {
      ok: failed.length === 0,
      requestId,
      value,
      count: results.length - failed.length,
      failed: failed.length,
      results,
      error: failed[0]?.error || "",
    });
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
    if (!manager) {
      return postInsertedResult({ ok: false, requestId, error: "OnlyOffice 书签接口不可用" });
    }

    const bookmarkName = payload.bookmarkName || buildBookmarkName(variable.id, variable.anchorIndex);
    if (requestId) handledRequestIds.add(requestId);

    try {
      removePlaceholderBookmark(manager, bookmarkName);
      const insertResult = insertFormattedBookmarkedPlaceholder(variable.token, bookmarkName, manager);
      if (!insertResult.ok) {
        return postInsertedResult({ ok: false, requestId, bookmarkName, error: insertResult.error || "自动字段标签生成失败" });
      }
      const confirmBookmark = function (attemptsLeft) {
        if (!hasPlaceholderBookmark(manager, bookmarkName)) {
          if (attemptsLeft > 0) {
            window.setTimeout(function () { confirmBookmark(attemptsLeft - 1); }, 120);
            return;
          }
          postInsertedResult({ ok: false, requestId, bookmarkName, error: "自动字段书签创建失败" });
          return;
        }
        const bookmarkResult = selectPlaceholderBookmark(bookmarkName);
        if (!bookmarkResult.ok) {
          postInsertedResult({ ok: false, requestId, bookmarkName, error: bookmarkResult.error || "自动字段书签创建后无法定位" });
          return;
        }
        const page = bookmarkResult.page || currentSelectionPage();
        postInsertedResult({
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
            style: { ok: true, source: insertResult.source, value: insertResult.style },
          },
        });
      };
      confirmBookmark(5);
      return { ok: true, requestId, bookmarkName, pending: true };
    } catch (error) {
      return postInsertedResult({ ok: false, requestId, bookmarkName, error: error?.message || "占位符书签写入失败" });
    }
  }

  window.guangfaInsertPlaceholderVariable = insertPlaceholderVariable;
  window.guangfaJumpToPlaceholderAnchor = jumpToPlaceholderAnchor;
  window.guangfaDeletePlaceholderAnchor = deletePlaceholderAnchor;
  window.guangfaFillPlaceholderVariable = fillPlaceholderVariable;

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
    if (data.source === "guangfa-parent" && data.action === "fill-placeholder-variable") {
      fillPlaceholderVariable(data);
    }
  });
})();

(function () {
  const complexFillHighlightColor = { r: 211, g: 211, b: 211, color: "D3D3D3" };
  let fallbackBookmarkIdSeed = 0;

  function getApplication() {
    try {
      return window.DE && typeof window.DE.getController === "function" ? window.DE : null;
    } catch {
      return null;
    }
  }

  function safeCall(target, name, fallback, ...args) {
    try {
      return target && typeof target[name] === "function" ? target[name](...args) : fallback;
    } catch {
      return fallback;
    }
  }

  function getOutlineManager() {
    const app = getApplication();
    const navigation = app && typeof app.getController === "function" ? app.getController("Navigation") : null;
    const api = navigation && navigation.api;
    if (api && typeof api.asc_ShowDocumentOutline === "function") api.asc_ShowDocumentOutline();
    if (navigation && navigation._navigationObject) return navigation._navigationObject;
    return api && typeof api.asc_GetDocumentOutlineManager === "function" ? api.asc_GetDocumentOutlineManager() : null;
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

  function readManagerOutline(manager) {
    const count = safeCall(manager, "get_ElementsCount", 0);
    const firstItemNotHeader = Boolean(safeCall(manager, "isFirstItemNotHeader", false));
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const title = String(safeCall(manager, "get_Text", "", index) || "");
      const isEmptyItem = Boolean(safeCall(manager, "isEmptyItem", false, index));
      items.push({
        index,
        level: Number(safeCall(manager, "get_Level", 0, index)) || 0,
        title,
        displayTitle: isEmptyItem || !title.trim() ? "空标题" : title,
        isEmptyItem,
        isNotHeader: index === 0 && firstItemNotHeader,
      });
    }
    return items;
  }

  function extractOnlyOfficeOutline() {
    const manager = getOutlineManager();
    if (!manager) return { ok: false, source: "outline-manager", count: 0, items: [], error: "未获取到 zl办公 大纲管理器" };
    const items = readManagerOutline(manager);
    return { ok: true, source: "outline-manager", count: items.length, items };
  }

  function normalizeSelectionText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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

  function extractOnlyOfficeSelection() {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const selectionState = safeCall(logicDocument, "GetSelectionState", null);
    const pageInfo = extractOnlyOfficePage(selectionState);
    const candidates = [
      { source: "logic-document", target: logicDocument },
      { source: "editor-api", target: api },
      { source: "asc-editor", target: window.Asc?.editor },
    ];
    for (const candidate of candidates) {
      if (!candidate.target) continue;
      const text = readSelectedText(candidate.target);
      if (text) {
        return { ok: true, source: candidate.source, text: text.slice(0, 2000), page: pageInfo.page, pageSource: pageInfo.source, selectionState };
      }
    }
    return { ok: false, source: "onlyoffice-selection", text: "", page: pageInfo.page, pageSource: pageInfo.source, selectionState, error: "未获取到 zl办公 当前选区文本" };
  }

  function getSelectionStatePage(selectionState) {
    const docState = Array.isArray(selectionState) ? selectionState[selectionState.length - 1] : null;
    const rawPage = Number(docState?.CurPage);
    return Number.isFinite(rawPage) ? Math.max(1, rawPage + 1) : 0;
  }

  function extractOnlyOfficePage(selectionState) {
    const selectionPage = getSelectionStatePage(selectionState);
    if (selectionPage) return { ok: true, page: selectionPage, source: "selection-state" };

    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const candidates = [
      { source: "editor-api", value: safeCall(api, "getCurrentPage", NaN) },
      { source: "logic-curpage", value: logicDocument?.CurPage },
      { source: "logic-current-page", value: safeCall(logicDocument, "GetCurrentPage", NaN) },
      { source: "editor-asc-current-page", value: safeCall(api, "asc_GetCurrentPage", NaN) },
    ];
    for (const candidate of candidates) {
      const rawPage = Number(candidate.value);
      if (Number.isFinite(rawPage)) return { ok: true, page: Math.max(1, rawPage + 1), source: candidate.source };
    }
    return { ok: true, page: 1, source: "fallback" };
  }

  function extractOnlyOfficeVisiblePage() {
    const api = getEditorApi();
    const candidates = [
      { source: "dom-visible-page", value: getDomVisiblePage() },
      { source: "editor-visible-pages", value: safeCall(api, "GetCurrentVisiblePages", null) },
      { source: "editor-asc-visible-pages", value: safeCall(api, "asc_GetCurrentVisiblePages", null) },
      { source: "editor-visible-page", value: safeCall(api, "GetCurrentVisiblePage", NaN) },
      { source: "editor-asc-visible-page", value: safeCall(api, "asc_GetCurrentVisiblePage", NaN) },
    ];
    for (const candidate of candidates) {
      const rawValue = Array.isArray(candidate.value) ? candidate.value[0] : candidate.value;
      const rawPage = Number(rawValue);
      if (Number.isFinite(rawPage)) {
        const page = candidate.source === "dom-visible-page" ? rawPage : rawPage + 1;
        return { ok: true, page: Math.max(1, page), source: candidate.source };
      }
    }

    const statusPage = extractOnlyOfficeStatusBarPage();
    if (statusPage.ok) return statusPage;
    return extractOnlyOfficePage();
  }

  function getDomVisiblePage() {
    const pageNodes = [...document.querySelectorAll("[data-page], [data-page-number], [page], .page, .canvasPage, .doc-page")];
    if (pageNodes.length === 0) return NaN;
    const viewportTop = 0;
    const viewportMid = window.innerHeight / 2;
    const best = pageNodes
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        if (!rect || rect.height <= 0 || rect.bottom < viewportTop || rect.top > window.innerHeight) return null;
        const pageAttr = node.getAttribute("data-page") || node.getAttribute("data-page-number") || node.getAttribute("page") || "";
        const rawPage = Number(pageAttr || index + 1);
        return { page: rawPage, distance: Math.abs(rect.top + rect.height / 2 - viewportMid) };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)[0];
    return best ? best.page : NaN;
  }

  function extractOnlyOfficeStatusBarPage() {
    const text = String(document.body?.innerText || "");
    const zh = text.match(/第\s*(\d+)\s*页\s*共\s*(\d+)\s*页/);
    if (zh) return { ok: true, page: Number(zh[1]), pageCount: Number(zh[2]), source: "status-bar" };
    const en = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (en) return { ok: true, page: Number(en[1]), pageCount: Number(en[2]), source: "status-bar" };
    return { ok: false };
  }

  function highlightOnlyOfficeSelection(selectionState) {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    try {
      if (selectionState && typeof logicDocument.SetSelectionState === "function") {
        logicDocument.SetSelectionState(selectionState);
      }
      return applyTextHighlightToCurrentSelection();
    } catch (error) {
      return { ok: false, error: error?.message || "zl办公 高亮失败" };
    }
  }

  function applyTextHighlightToCurrentSelection(options = {}) {
    const api = getEditorApi();
    const r = Number.isFinite(Number(options.r)) ? Number(options.r) : 255;
    const g = Number.isFinite(Number(options.g)) ? Number(options.g) : 255;
    const b = Number.isFinite(Number(options.b)) ? Number(options.b) : 0;
    if (api && typeof api.SetMarkerFormat === "function") {
      try {
        api.SetMarkerFormat(true, true, r, g, b);
        window.setTimeout(function () {
          try { api.SetMarkerFormat(false); } catch {}
        }, 0);
        if (typeof api.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
        return { ok: true, color: options.color || "FFFF00", source: "set-marker-format" };
      } catch {}
    }
    if (api && typeof api.put_LineHighLight === "function") {
      api.put_LineHighLight(true, r, g, b);
      if (typeof api.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
      return { ok: true, color: options.color || "FFFF00", source: "put-line-highlight" };
    }
    return { ok: true, skipped: true, reason: "line-highlight-api-unavailable" };
  }

  function clearTextHighlightFromCurrentSelection() {
    const api = getEditorApi();
    if (api && typeof api.SetMarkerFormat === "function") {
      try {
        api.SetMarkerFormat(true, false);
        window.setTimeout(function () {
          try { api.SetMarkerFormat(false); } catch {}
        }, 0);
        if (typeof api.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
        return { ok: true, source: "set-marker-format-clear" };
      } catch {}
    }
    if (api && typeof api.put_LineHighLight === "function") {
      api.put_LineHighLight(false, 255, 255, 255);
      if (typeof api.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
      return { ok: true, source: "put-line-highlight" };
    }
    return { ok: true, skipped: true, reason: "line-highlight-api-unavailable" };
  }

  function saveOnlyOfficeDocument(trigger) {
    const api = getEditorApi();
    if (api && typeof api.asc_Save === "function") {
      api.asc_Save(false);
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "office-save", ok: true, trigger: trigger || "manual" }, "*");
      return { ok: true };
    }
    window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "office-save", ok: false, error: "zl办公 保存接口不可用" }, "*");
    return { ok: false, error: "zl办公 保存接口不可用" };
  }

  function getFieldBookmarkName(field) {
    if (field?.bookmarkName) return String(field.bookmarkName);
    const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
    return id ? "GF_FIELD_" + id : "";
  }

  function getBookmarkManager() {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const logicManager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    try {
      if (api && typeof api.asc_GetBookmarksManager === "function") {
        const manager = api.asc_GetBookmarksManager();
        if (
          manager &&
          (typeof manager.asc_SelectBookmark === "function" ||
            typeof manager.asc_GoToBookmark === "function" ||
            typeof manager.asc_RemoveBookmark === "function")
        ) {
          return manager;
        }
      }
    } catch {}
    return logicManager;
  }

  function getComplexFillBookmarkName(item) {
    if (item?.bookmarkName) return String(item.bookmarkName);
    const id = String(item?.id || "").trim();
    const numberPart = id.match(/^CF-(\d+)$/)?.[1];
    const safeId = numberPart ? numberPart.padStart(3, "0") : id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
    return safeId ? "GF_CF_" + safeId : "";
  }

  function hasBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_HaveBookmark === "function") return manager.asc_HaveBookmark(bookmarkName);
      return typeof manager?.HaveBookmark === "function" ? manager.HaveBookmark(bookmarkName) : true;
    } catch {
      return true;
    }
  }

  function goToBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_GoToBookmark === "function") {
        manager.asc_GoToBookmark(bookmarkName);
        return true;
      }
      if (typeof manager?.GoToBookmark === "function") {
        manager.GoToBookmark(bookmarkName);
        return true;
      }
    } catch {}
    return false;
  }

  function selectBookmarkRange(manager, bookmarkName) {
    if (!manager || !bookmarkName) return { ok: false, bookmarkName, error: "书签定位接口不可用" };
    if (!hasBookmark(manager, bookmarkName)) return { ok: false, bookmarkName, error: "未找到对应书签" };
    try {
      const moved = goToBookmark(manager, bookmarkName);
      const selected = typeof manager.asc_SelectBookmark === "function"
        ? manager.asc_SelectBookmark(bookmarkName) !== false
        : typeof manager.SelectBookmark === "function"
          ? manager.SelectBookmark(bookmarkName) !== false
          : false;
      const pageInfo = extractOnlyOfficePage(safeCall(getLogicDocument(), "GetSelectionState", null));
      return { ok: moved || selected, bookmarkName, page: pageInfo.page, pageSource: pageInfo.source, selected, moved };
    } catch (error) {
      return { ok: false, bookmarkName, error: error?.message || "书签定位失败" };
    }
  }

  function removeBookmark(manager, bookmarkName) {
    try {
      if (typeof manager?.asc_RemoveBookmark === "function") return manager.asc_RemoveBookmark(bookmarkName);
      if (typeof manager?.RemoveBookmark === "function") return manager.RemoveBookmark(bookmarkName);
    } catch {}
    return false;
  }

  function createBookmarkId(manager) {
    try {
      if (typeof manager?.GetNewBookmarkId === "function") return manager.GetNewBookmarkId();
    } catch {}
    fallbackBookmarkIdSeed += 1;
    return String(Date.now()) + String(fallbackBookmarkIdSeed).padStart(4, "0");
  }

  function insertBookmarkedPlainText(text, bookmarkName, manager, options) {
    const logicDocument = getLogicDocument();
    const Paragraph = window.AscWord?.Paragraph;
    const ParaRun = window.AscWord?.ParaRun || window.AscCommonWord?.ParaRun;
    const BookmarkClass = window.AscWord?.CParagraphBookmark || window.AscCommonWord?.CParagraphBookmark;
    const SelectedContent = window.AscCommonWord?.CSelectedContent;
    const SelectedElement = window.AscCommonWord?.CSelectedElement;
    if (!logicDocument || !manager) return { ok: false, error: "OnlyOffice 书签写入接口不可用" };
    if (
      typeof Paragraph !== "function"
      || typeof ParaRun !== "function"
      || typeof BookmarkClass !== "function"
      || typeof SelectedContent !== "function"
      || typeof SelectedElement !== "function"
    ) {
      return { ok: false, error: "OnlyOffice 纯文本书签内容生成接口不可用" };
    }

    let actionStarted = false;
    try {
      const changeType = window.AscCommon?.changestype_Paragraph_AddText;
      const isLocked = changeType && typeof logicDocument.IsSelectionLocked === "function"
        ? logicDocument.IsSelectionLocked(changeType, null, false, safeCall(logicDocument, "IsFormFieldEditing", false))
        : false;
      if (isLocked) return { ok: false, error: "当前选区被锁定，无法写入复杂类填充内容。" };

      const historyType = window.AscDFH?.historydescription_Document_AddTextWithProperties;
      if (typeof logicDocument.StartAction === "function") {
        logicDocument.StartAction(historyType);
        actionStarted = true;
      }

      if (options?.removeBeforeInsert !== false && typeof logicDocument.RemoveBeforePaste === "function") logicDocument.RemoveBeforePaste();

      const currentParagraph = typeof logicDocument.GetCurrentParagraph === "function" ? logicDocument.GetCurrentParagraph() : null;
      if (!currentParagraph || typeof currentParagraph.GetCurrentAnchorPosition !== "function") {
        return { ok: false, error: "OnlyOffice 当前光标位置不可用" };
      }

      const bookmarkId = createBookmarkId(manager);
      const tempParagraph = new Paragraph();
      const run = new ParaRun(tempParagraph, false);
      run.AddText(String(text || ""));
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
      if (inserted === false) return { ok: false, error: "OnlyOffice 复杂类填充内容插入失败" };

      safeCall(logicDocument, "Recalculate", null);
      safeCall(logicDocument, "UpdateInterface", null);
      safeCall(logicDocument, "UpdateSelection", null);
      safeCall(manager, "Update", null);
      return { ok: true, source: "selected-content-bookmark-run", style: "plain-text" };
    } catch (error) {
      return { ok: false, error: error?.message || "复杂类填充内容写入失败" };
    } finally {
      if (actionStarted) safeCall(logicDocument, "FinalizeAction", null);
    }
  }

  function selectComplexFillBookmarkForMutation(manager, bookmarkName) {
    if (!manager || !bookmarkName) {
      return { ok: false, bookmarkName, error: "复杂类填充书签接口不可用" };
    }
    if (!hasBookmark(manager, bookmarkName)) {
      return { ok: false, bookmarkName, error: "未找到对应复杂类填充书签" };
    }
    const selected = selectBookmarkRange(manager, bookmarkName);
    if (!selected.ok || !selected.selected) {
      return {
        ...selected,
        ok: false,
        error: selected.error || "未能选中对应复杂类填充书签范围，请重新标注并保存模板。",
      };
    }
    return selected;
  }

  function restoreSelectionState(selectionState) {
    const logicDocument = getLogicDocument();
    if (!selectionState || !logicDocument || typeof logicDocument.SetSelectionState !== "function") return false;
    try {
      logicDocument.SetSelectionState(selectionState);
      return true;
    } catch {
      return false;
    }
  }

  function addBookmarkToCurrentSelection(field) {
    const logicDocument = getLogicDocument();
    const manager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    const bookmarkName = getFieldBookmarkName(field);
    if (!manager || !bookmarkName) return { ok: false, id: field?.id, error: "字段书签接口不可用" };
    restoreSelectionState(field?.selectionState);
    try {
      if (typeof manager.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      manager.AddBookmark(bookmarkName);
      const selectedText = readBookmarkedText(manager, bookmarkName);
      saveOnlyOfficeDocument("field-bookmark");
      return { ok: true, id: field?.id, bookmarkName, selectedText };
    } catch (error) {
      return { ok: false, id: field?.id, bookmarkName, error: error?.message || "字段书签写入失败" };
    }
  }

  function readBookmarkedText(manager, bookmarkName) {
    try {
      if (typeof manager?.SelectBookmark === "function") manager.SelectBookmark(bookmarkName);
    } catch {}
    const logicDocument = getLogicDocument();
    const api = getEditorApi();
    return readSelectedText(logicDocument) || readSelectedText(api) || readSelectedText(window.Asc?.editor);
  }

  function addInputPointBookmark(field) {
    const logicDocument = getLogicDocument();
    const manager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    const bookmarkName = getFieldBookmarkName(field);
    if (!manager || !bookmarkName) return { ok: false, id: field?.id, bookmarkName, error: "输入点书签接口不可用" };
    const selectionState = safeCall(logicDocument, "GetSelectionState", null);
    const pageInfo = extractOnlyOfficePage(selectionState);
    try {
      if (typeof manager.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      manager.AddBookmark(bookmarkName);
      saveOnlyOfficeDocument("input-point");
      return { ok: true, id: field?.id, bookmarkName, page: pageInfo.page, pageSource: pageInfo.source };
    } catch (error) {
      return { ok: false, id: field?.id, bookmarkName, error: error?.message || "输入点写入失败" };
    }
  }

  function postComplexFillResult(action, result) {
    const message = { source: "guangfa-onlyoffice-custom", action, result };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
  }

  function addComplexFillAnchor(payload = {}) {
    const requestId = payload.requestId || "";
    const anchor = payload.anchor || payload.item || {};
    const selection = extractOnlyOfficeSelection();
    if (!selection.ok || !selection.text) {
      return postComplexFillResult("complex-fill-anchor-added", {
        ok: false,
        requestId,
        error: selection.error || "请先在文档中选中要整体替换的模板文字。",
      });
    }

    const logicDocument = getLogicDocument();
    const manager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    const bookmarkName = getComplexFillBookmarkName(anchor);
    if (!manager || !bookmarkName) {
      return postComplexFillResult("complex-fill-anchor-added", { ok: false, requestId, bookmarkName, error: "复杂类填充书签接口不可用" });
    }

    try {
      restoreSelectionState(selection.selectionState);
      if (typeof manager.RemoveBookmark === "function") manager.RemoveBookmark(bookmarkName);
      manager.AddBookmark(bookmarkName);
      const selected = selectComplexFillBookmarkForMutation(manager, bookmarkName);
      if (!selected.ok) {
        removeBookmark(manager, bookmarkName);
        return postComplexFillResult("complex-fill-anchor-added", { ...selected, requestId });
      }
      const highlight = applyTextHighlightToCurrentSelection(complexFillHighlightColor);
      selectBookmarkRange(manager, bookmarkName);
      const pageInfo = extractOnlyOfficePage(safeCall(getLogicDocument(), "GetSelectionState", null));
      const page = pageInfo.page || selection.page || 1;
      saveOnlyOfficeDocument("complex-fill-anchor");
      return postComplexFillResult("complex-fill-anchor-added", {
        ok: true,
        requestId,
        highlight,
        anchor: {
          id: anchor.id,
          fieldId: anchor.fieldId || anchor.id,
          bookmarkName,
          page,
          sourceText: selection.text,
          selectionState: selection.selectionState,
          fieldSummary: anchor.fieldSummary || "",
          index: Math.max(1, Number(anchor.index || 1) || 1),
          documentOrder: page * 1000000 + Math.max(1, Number(anchor.index || 1) || 1),
        },
      });
    } catch (error) {
      return postComplexFillResult("complex-fill-anchor-added", { ok: false, requestId, bookmarkName, error: error?.message || "复杂类填充书签写入失败" });
    }
  }

  function selectComplexFillAnchor(payload = {}) {
    const requestId = payload.requestId || "";
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || payload.item?.bookmarkName || "");
    const result = selectBookmarkRange(getBookmarkManager(), bookmarkName);
    const highlight = result.ok ? applyTextHighlightToCurrentSelection(complexFillHighlightColor) : null;
    return postComplexFillResult("complex-fill-anchor-selected", { ...result, requestId, highlight });
  }

  function deleteComplexFillAnchor(payload = {}) {
    const requestId = payload.requestId || "";
    const bookmarkName = String(payload.bookmarkName || payload.anchor?.bookmarkName || payload.item?.bookmarkName || "");
    const selectionState = payload.anchor?.selectionState || payload.item?.selectionState || null;
    const manager = getBookmarkManager();
    const selected = selectComplexFillBookmarkForMutation(manager, bookmarkName);
    if (!selected.ok) return postComplexFillResult("complex-fill-anchor-deleted", { ...selected, requestId });
    try {
      if (selectionState) restoreSelectionState(selectionState);
      const highlight = clearTextHighlightFromCurrentSelection();
      const removed = removeBookmark(manager, bookmarkName);
      const bookmarkDeleted = removed !== false;
      saveOnlyOfficeDocument("complex-fill-anchor-delete");
      return postComplexFillResult("complex-fill-anchor-deleted", {
        ok: bookmarkDeleted && highlight?.ok !== false,
        requestId,
        bookmarkName,
        page: selected.page || 1,
        bookmarkDeleted,
        highlight,
        error: bookmarkDeleted ? highlight?.error : "复杂类填充书签删除失败。",
      });
    } catch (error) {
      return postComplexFillResult("complex-fill-anchor-deleted", { ok: false, requestId, bookmarkName, page: selected.page || 1, error: error?.message || "复杂类填充书签删除失败" });
    }
  }

  function fillComplexFillAnchor(anchor, value) {
    const bookmarkName = String(anchor?.bookmarkName || "");
    const manager = getBookmarkManager();
    if (!manager || !bookmarkName) {
      return { ok: false, bookmarkName, error: "复杂类填充书签接口不可用" };
    }
    const selected = selectComplexFillBookmarkForMutation(manager, bookmarkName);
    if (!selected.ok) return selected;
    try {
      clearTextHighlightFromCurrentSelection();
      const removeResult = removeSelectedTextForReplacement();
      if (!removeResult.ok) {
        return { ok: false, bookmarkName, page: selected.page, error: removeResult.error || "复杂类填充原选区删除失败" };
      }
      removeBookmark(manager, bookmarkName);
      const insertResult = insertBookmarkedPlainText(value, bookmarkName, manager, { removeBeforeInsert: false });
      if (!insertResult.ok) {
        return { ok: false, bookmarkName, page: selected.page, error: insertResult.error || "复杂类填充内容写入失败" };
      }
      const bookmarkResult = selectBookmarkRange(manager, bookmarkName);
      return {
        ok: true,
        bookmarkName,
        page: bookmarkResult.page || selected.page || currentSelectionPage(),
        source: insertResult.source,
        removeSource: removeResult.source,
      };
    } catch (error) {
      return { ok: false, bookmarkName, page: selected.page, error: error?.message || "复杂类填充内容写入失败" };
    }
  }

  function fillComplexFillField(payload = {}) {
    const requestId = payload.requestId || "";
    const value = String(payload.value || "").trim();
    const anchors = Array.isArray(payload.anchors) ? payload.anchors : payload.anchor ? [payload.anchor] : [];
    if (!value) {
      return postComplexFillResult("complex-fill-field-filled", { ok: false, requestId, error: "复杂类填充值为空。" });
    }
    if (anchors.length === 0) {
      return postComplexFillResult("complex-fill-field-filled", { ok: false, requestId, error: "当前复杂字段没有可填充的书签。" });
    }
    const results = anchors.map(function (anchor) {
      return fillComplexFillAnchor(anchor, value);
    });
    const failed = results.filter(function (result) { return !result.ok; });
    if (failed.length === 0) saveOnlyOfficeDocument("complex-fill-field");
    return postComplexFillResult("complex-fill-field-filled", {
      ok: failed.length === 0,
      requestId,
      value,
      count: results.length - failed.length,
      failed: failed.length,
      results,
      error: failed[0]?.error || "",
    });
  }

  function selectFieldBookmark(field) {
    const logicDocument = getLogicDocument();
    const manager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    const bookmarkName = getFieldBookmarkName(field);
    if (!manager || !bookmarkName || typeof manager.SelectBookmark !== "function") return false;
    try {
      return manager.SelectBookmark(bookmarkName) !== false;
    } catch {
      return false;
    }
  }

  function enterTextAtSelection(text) {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const value = String(text || "");
    try {
      if (api && typeof api.asc_enterText === "function") {
        api.asc_enterText(Array.from(value).map(function (char) { return char.codePointAt(0); }));
        saveOnlyOfficeDocument("fill-field");
        return { ok: true, source: "asc-enter-text" };
      }
      if (logicDocument && typeof logicDocument.EnterText === "function") {
        logicDocument.EnterText(value);
        saveOnlyOfficeDocument("fill-field");
        return { ok: true, source: "logic-enter-text" };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "字段写入失败" };
    }
    return { ok: false, error: "文本输入接口不可用" };
  }

  function removeSelectedTextForReplacement() {
    const logicDocument = getLogicDocument();
    if (!logicDocument) return { ok: false, error: "文档对象不可用，无法删除原选区" };
    try {
      if (typeof logicDocument.IsSelectionEmpty === "function" && logicDocument.IsSelectionEmpty(true)) {
        return { ok: false, error: "书签选区为空，请重新标注并保存模板" };
      }
      if (typeof logicDocument.RemoveBeforePaste === "function") {
        logicDocument.RemoveBeforePaste();
        return { ok: true, source: "remove-before-paste" };
      }
      if (typeof logicDocument.Remove === "function") {
        logicDocument.Remove(1, true, true, true);
        return { ok: true, source: "logic-remove" };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "删除原选区失败" };
    }
    return { ok: false, error: "删除选区接口不可用" };
  }

  function replaceSelectedText(text) {
    const removed = removeSelectedTextForReplacement();
    if (!removed.ok) return removed;
    const entered = enterTextAtSelection(text);
    return { ...entered, removeResult: removed };
  }

  function fillBookmarkedField(field) {
    const fillText = String(field?.fillText || field?.value || "");
    if (!fillText) return { ok: false, id: field?.id, error: "字段填充值为空" };
    if (isChoiceMarkerField(field)) {
      if (shouldReplaceChoiceSelectionWithAnswer(field)) {
        if (!selectFieldBookmark(field)) {
          return { ok: false, id: field?.id, bookmarkName: getFieldBookmarkName(field), error: "字段书签不存在，请重新标注并保存模板" };
        }
        const result = replaceSelectedText(buildChoiceSelectionReplacementText(field));
        const cleanupResult = result.ok ? removeNoRequirementChoiceOption(field) : null;
        postFieldPages("fill-choice-replacement");
        return { ...result, cleanupResult, id: field?.id, bookmarkName: getFieldBookmarkName(field), source: "choice-selection-replacement" };
      }
      const scopedResult = replaceChoiceMarkerSelection(field);
      if (scopedResult.ok) {
        postFieldPages("fill-choice-field-bookmark");
        return { ...scopedResult, id: field?.id, bookmarkName: getFieldBookmarkName(field), source: "choice-marker-bookmark" };
      }
      const result = checkChoiceMarker(field);
      const amountResult = result.ok && (field?.amountValue || field?.fillMode === "amount-choice") ? fillAmountBlank(field) : null;
      postFieldPages("fill-choice-field");
      return { ...result, scopedResult, amountResult, id: field?.id, bookmarkName: getFieldBookmarkName(field) };
    }
    if (!selectFieldBookmark(field)) {
      return { ok: false, id: field?.id, bookmarkName: getFieldBookmarkName(field), error: "字段书签不存在，请重新标注并保存模板" };
    }
    const bookmarkName = getFieldBookmarkName(field);
    const result = /^GF_FIELD_/.test(bookmarkName) ? replaceSelectedText(fillText) : enterTextAtSelection(fillText);
    postFieldPages("fill-field");
    return { ...result, id: field?.id, bookmarkName };
  }

  function isChoiceMarkerField(field) {
    const category = String(field?.category || field?.type || "");
    const source = String(field?.sourceText || field?.marker?.text || "");
    return category.includes("单选") && /[□☐○〇▢☑✓✔]/.test(source);
  }

  function shouldReplaceChoiceSelectionWithAnswer(field) {
    const value = normalizeChoiceText(field?.value || field?.fillText);
    return field?.fillMode === "choice-replace" && value && !/^无.{0,12}要求/.test(value);
  }

  function buildChoiceSelectionReplacementText(field) {
    return String(field?.value || field?.fillText || "").trim();
  }

  function checkChoiceMarker(field) {
    const api = getEditorApi();
    if (!api || typeof api.asc_findText !== "function") {
      return { ok: false, error: "选择项搜索接口不可用" };
    }

    const source = String(field?.sourceText || field?.marker?.text || "");
    const options = parseChoiceOptions(source);
    const target = findChoiceOption(options, field);
    if (!target) return { ok: false, error: "未匹配到需要勾选的选项" };

    let changed = 0;
    for (const option of options) {
      if (option === target) continue;
      if (setChoiceMarkerBeforeOption(option, uncheckedChoiceMarker(option.marker), field, /[☑✓✔]/)) changed += 1;
    }

    if (setChoiceMarkerBeforeOption(target, "☑", field, /[☑]/)) {
      if (changed > 0) saveOnlyOfficeDocument("fill-choice-field");
      return { ok: true, source: "choice-marker", changed, alreadyChecked: true };
    }

    if (setChoiceMarkerBeforeOption(target, "☑", field, /[□☐○〇▢]/)) {
      return { ok: true, source: "choice-marker", changed: changed + 1 };
    }

    return { ok: false, source: "choice-marker", changed, error: "未在文档中定位到选项前的方框" };
  }

  function replaceChoiceMarkerSelection(field) {
    if (!selectFieldBookmark(field)) return { ok: false, source: "choice-marker-bookmark", error: "字段书签不存在" };
    const replacement = buildChoiceMarkerSelectionText(field);
    if (!replacement) return { ok: false, source: "choice-marker-bookmark", error: "未能基于标注选区生成选择结果" };
    return replaceSelectedText(replacement);
  }

  function buildChoiceMarkerSelectionText(field) {
    const source = String(field?.sourceText || field?.marker?.text || "");
    const options = parseChoiceOptions(source);
    const target = findChoiceOption(options, field);
    if (!source || !target) return "";
    let text = source;
    options
      .slice()
      .sort(function (a, b) { return b.index - a.index; })
      .forEach(function (option) {
        const marker = option === target ? "☑" : uncheckedChoiceMarker(option.marker);
        text = text.slice(0, option.index) + marker + text.slice(option.index + 1);
      });
    if (field?.fillMode === "amount-choice" && field?.amountValue) {
      text = replaceAmountBlankInText(text, String(field.amountValue).trim());
    }
    return text;
  }

  function removeNoRequirementChoiceOption(field) {
    const option = findNoRequirementChoiceOption(field);
    if (!option) return { ok: true, skipped: true, reason: "no-requirement-option-missing" };
    for (const text of noRequirementSearchTexts(option)) {
      if (selectSearchText(text, field)) {
        const removed = removeSelectedTextForReplacement();
        if (removed.ok) saveOnlyOfficeDocument("fill-choice-replacement-cleanup");
        return { ...removed, source: "choice-no-requirement-cleanup", text };
      }
    }
    return { ok: false, source: "choice-no-requirement-cleanup", error: "未定位到待清理的无要求选项" };
  }

  function findNoRequirementChoiceOption(field) {
    const source = String(field?.sourceText || field?.marker?.text || "");
    return parseChoiceOptions(source).find(function (option) {
      return /^无.{0,12}要求/.test(normalizeChoiceText(option.text));
    }) || null;
  }

  function noRequirementSearchTexts(option) {
    const text = String(option?.text || "").trim();
    const body = String(option?.body || "").replace(/\s+$/, "");
    if (!text) return [];
    const values = [];
    ["□", "☐", "▢", "☑", "✓", "✔"].forEach(function (marker) {
      values.push(marker + text, marker + " " + text);
      if (body.trim()) values.push(marker + body);
    });
    return Array.from(new Set(values));
  }

  function replaceAmountBlankInText(text, amount) {
    const descriptor = getAmountBlankDescriptor(text);
    if (!descriptor || !amount) return text;
    if (descriptor.suffix) {
      const suffixIndex = text.indexOf(descriptor.suffix);
      if (suffixIndex > 0) {
        const before = text.slice(0, suffixIndex);
        const blank = before.match(/(?:_{2,}|＿+|—+|-{2,}|\s{2,})\s*$/);
        if (blank) return `${before.slice(0, blank.index)}${amount}${text.slice(suffixIndex)}`;
      }
    }
    if (descriptor.prefix) {
      const prefixIndex = text.indexOf(descriptor.prefix);
      const start = prefixIndex >= 0 ? prefixIndex + descriptor.prefix.length : -1;
      if (start >= 0) return text.slice(0, start) + text.slice(start).replace(/_{2,}|＿+|—+|-{2,}|\s{2,}/, amount);
    }
    return text;
  }

  function fillAmountBlank(field) {
    const amount = String(field?.amountValue || field?.value || "").trim();
    const descriptor = getAmountBlankDescriptor(String(field?.marker?.text || field?.sourceText || ""));
    if (!amount || !descriptor) return { ok: false, skipped: true, reason: "amount-blank-descriptor-missing" };
    if (descriptor.suffix && selectSearchText(descriptor.suffix, field)) {
      return replaceBlankBeforeSelection(descriptor.blankLength, amount);
    }
    if (!selectSearchText(descriptor.prefix, field)) return { ok: false, error: "未定位到金额空白前的标签" };
    return replaceBlankAfterSelection(descriptor.blankLength, amount);
  }

  function replaceBlankBeforeSelection(blankLength, amount) {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.MoveCursorLeft !== "function") return { ok: false, error: "光标移动接口不可用" };
    try {
      logicDocument.MoveCursorLeft(false, false);
      for (let index = 0; index < blankLength; index += 1) {
        logicDocument.MoveCursorLeft(true, false);
      }
      const selected = readSelectedText(logicDocument);
      if (selected && !/^[\s_＿—-]+$/.test(selected)) return { ok: false, selected, error: "金额空白选区不匹配" };
      return enterTextAtSelection(amount);
    } catch (error) {
      return { ok: false, error: error?.message || "金额空白写入失败" };
    }
  }

  function replaceBlankAfterSelection(blankLength, amount) {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.MoveCursorRight !== "function") return { ok: false, error: "光标移动接口不可用" };
    try {
      logicDocument.MoveCursorRight(false, false);
      for (let index = 0; index < blankLength; index += 1) {
        logicDocument.MoveCursorRight(true, false);
      }
      const selected = readSelectedText(logicDocument);
      if (selected && !/^[\s_＿—-]+$/.test(selected)) return { ok: false, selected, error: "金额空白选区不匹配" };
      return enterTextAtSelection(amount);
    } catch (error) {
      return { ok: false, error: error?.message || "金额空白写入失败" };
    }
  }

  function getAmountBlankDescriptor(source) {
    const unitPattern = amountUnitPattern();
    const match = String(source || "").match(new RegExp("(?:_{2,}|＿+|—+|-{2,}|(?<=[：:])\\s+|\\s{2,})(?=\\s*(?:" + unitPattern + "))"));
    if (!match) return null;
    const prefix = source.slice(0, match.index).replace(/\s+/g, " ").trim().slice(-24);
    const suffix = (source.slice(match.index + match[0].length).match(new RegExp("^\\s*((?:" + unitPattern + ")[（(]?)"))?.[1] || "").trim();
    return prefix.length >= 2 ? { prefix, suffix, blankLength: match[0].length } : null;
  }

  function amountUnitPattern() {
    return "[十百千]?亿(?:元)?|[十百千]?万(?:元)?|[十百千]?元|元";
  }

  function parseChoiceOptions(source) {
    return [...String(source || "").matchAll(/([□☐○〇▢☑✓✔])(\s*[^□☐○〇▢☑✓✔]{1,80})/g)]
      .map(function (match) {
        return {
          marker: match[1],
          body: match[2].replace(/\s+/g, " ").replace(/\s+$/, ""),
          text: match[2].replace(/\s+/g, " ").trim(),
          index: match.index,
        };
      })
      .filter(function (option) { return normalizeChoiceText(option.text).length >= 2; });
  }

  function findChoiceOption(options, field) {
    const checked = parseChoiceOptions(field?.value).find(function (option) { return /[☑✓✔]/.test(option.marker); });
    const value = normalizeChoiceText(field?.choiceValue || checked?.text || field?.value || field?.fillText);
    return options
      .map(function (option) { return { option, score: scoreChoiceOptionMatch(option.text, value) }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) {
        return b.score - a.score || normalizeChoiceText(b.option.text).length - normalizeChoiceText(a.option.text).length;
      })[0]?.option || null;
  }

  function scoreChoiceOptionMatch(optionText, normalizedValue) {
    const option = normalizeChoiceText(optionText);
    if (!option || !normalizedValue) return 0;
    if (option === normalizedValue) return 100;
    if (option.includes(normalizedValue)) return 90;
    if (normalizedValue.includes(option)) return 70;
    return 0;
  }

  function normalizeChoiceText(value) {
    return String(value || "")
      .replace(/[□☐○〇▢☑✓✔]/g, "")
      .replace(/^第[一二三四五六七八九十\d]+章\s*/, "")
      .replace(/[（）()：:，,。；;\s]/g, "")
      .replace(/综合评分法/g, "综合评估法")
      .trim();
  }

  function uncheckedChoiceMarker(marker) {
    return marker === "○" || marker === "〇" ? marker : "□";
  }

  function setChoiceMarkerBeforeOption(option, marker, field, allowedMarkerPattern) {
    if (!selectChoiceOptionText(option, field)) return false;
    const selectedMarker = selectMarkerBeforeSelection(allowedMarkerPattern);
    if (!selectedMarker) return false;
    if (selectedMarker.replace(/[^□☐○〇▢☑✓✔]/g, "") === marker) return true;
    enterTextAtSelection(selectedMarker.replace(/[□☐○〇▢☑✓✔]/, marker));
    return true;
  }

  function selectChoiceOptionText(option, field) {
    const api = getEditorApi();
    const settings = createSearchSettings(option.text);
    if (!api || !settings) return false;
    const expectedPage = Number(field?.page || 0);
    try {
      if (typeof api.asc_endFindText === "function") api.asc_endFindText();
      moveSearchCursorToStart();
      const count = Number(api.asc_findText(settings, true)) || 0;
      const max = Math.min(Math.max(count, 1), 80);
      for (let index = 0; index < max; index += 1) {
        const selectedText = readSelectedText(getLogicDocument()) || readSelectedText(api);
        const page = currentSelectionPage();
        const pageOk = !expectedPage || !page || page === expectedPage;
        if (pageOk && normalizeChoiceText(selectedText) === normalizeChoiceText(option.text)) {
          return true;
        }
        if (index < max - 1) api.asc_findText(settings, true);
      }
    } catch {
      return false;
    } finally {
      try { if (typeof api.asc_endFindText === "function") api.asc_endFindText(); } catch {}
    }
    return false;
  }

  function selectSearchText(text, field) {
    const api = getEditorApi();
    const settings = createSearchSettings(text);
    if (!api || !settings) return false;
    const expectedPage = Number(field?.page || 0);
    try {
      if (typeof api.asc_endFindText === "function") api.asc_endFindText();
      moveSearchCursorToStart();
      const count = Number(api.asc_findText(settings, true)) || 0;
      const max = Math.min(Math.max(count, 1), 80);
      for (let index = 0; index < max; index += 1) {
        const selectedText = readSelectedText(getLogicDocument()) || readSelectedText(api);
        const page = currentSelectionPage();
        const pageOk = !expectedPage || !page || page === expectedPage;
        if (pageOk && normalizeSelectionText(selectedText).includes(normalizeSelectionText(text))) {
          return true;
        }
        if (index < max - 1) api.asc_findText(settings, true);
      }
    } catch {
      return false;
    } finally {
      try { if (typeof api.asc_endFindText === "function") api.asc_endFindText(); } catch {}
    }
    return false;
  }

  function selectMarkerBeforeSelection(allowedMarkerPattern) {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.MoveCursorLeft !== "function") return "";
    try {
      logicDocument.MoveCursorLeft(false, false);
      let selected = "";
      for (let index = 0; index < 4; index += 1) {
        logicDocument.MoveCursorLeft(true, false);
        selected = readSelectedText(logicDocument);
        if (/[□☐○〇▢☑✓✔]/.test(selected)) {
          return allowedMarkerPattern.test(selected) ? selected : "";
        }
      }
    } catch {}
    return "";
  }

  function moveSearchCursorToStart() {
    const logicDocument = getLogicDocument();
    const attempts = [
      function () { return logicDocument && typeof logicDocument.MoveCursorToStartOfDocument === "function" && logicDocument.MoveCursorToStartOfDocument(); },
      function () { return logicDocument && typeof logicDocument.MoveCursorToStartPos === "function" && logicDocument.MoveCursorToStartPos(false); },
    ];
    for (const attempt of attempts) {
      try {
        if (attempt() !== false) return true;
      } catch {}
    }
    return false;
  }

  function createSearchSettings(text) {
    const CSearchSettings = window.AscCommon?.CSearchSettings;
    if (typeof CSearchSettings !== "function") return null;
    const settings = new CSearchSettings();
    safeCall(settings, "put_Text", null, text);
    safeCall(settings, "put_MatchCase", null, false);
    safeCall(settings, "put_WholeWords", null, false);
    return settings;
  }

  function currentSelectionPage() {
    const api = getEditorApi();
    const searchPage = Number(api?.WordControl?.m_oDrawingDocument?.m_oDocumentRenderer?.SearchResults?.CurrentPage);
    if (Number.isFinite(searchPage) && searchPage >= 0) return searchPage + 1;
    const logicDocument = getLogicDocument();
    return extractOnlyOfficePage(safeCall(logicDocument, "GetSelectionState", null)).page;
  }

  function highlightAnnotationFieldBySearch(field) {
    const api = getEditorApi();
    if (!api || typeof api.asc_findText !== "function") {
      return { id: field?.id, skipped: true, reason: "find-api-unavailable" };
    }
    const expectedPage = Number(field?.page || 0);
    const tokens = buildAnnotationSearchTokens(field);
    for (const token of tokens) {
      const settings = createSearchSettings(token);
      if (!settings) return { id: field?.id, skipped: true, reason: "search-settings-unavailable" };
      try {
        if (typeof api.asc_endFindText === "function") api.asc_endFindText();
        moveSearchCursorToStart();
        const count = Number(api.asc_findText(settings, true)) || 0;
        const max = Math.min(Math.max(count, 1), 80);
        for (let index = 0; index < max; index += 1) {
          const selectedText = readSelectedText(getLogicDocument()) || readSelectedText(api);
          const page = currentSelectionPage();
          const pageOk = !expectedPage || !page || page === expectedPage;
          if (pageOk && isSearchSelectionMatch(selectedText, token)) {
            const result = applyTextHighlightToCurrentSelection();
            if (typeof api.asc_endFindText === "function") window.setTimeout(function () { api.asc_endFindText(); }, 50);
            return { id: field.id, source: "asc-find-text", token, page, count, result, ok: result.ok && !result.skipped };
          }
          if (index < max - 1) api.asc_findText(settings, true);
        }
      } catch (error) {
        return { id: field?.id, skipped: true, reason: "find-error", error: error?.message || String(error), token };
      } finally {
        try { if (typeof api.asc_endFindText === "function") api.asc_endFindText(); } catch {}
      }
    }
    return { id: field?.id, skipped: true, reason: "not-found", tokens };
  }

  function isSearchSelectionMatch(actual, token) {
    const selected = normalizeSelectionText(actual).replace(/\s+/g, "");
    const expected = normalizeSelectionText(token).replace(/\s+/g, "");
    return Boolean(selected && expected && (selected === expected || selected.includes(expected) || expected.includes(selected)));
  }

  function getAnnotationRestoreSignature(fields) {
    const items = Array.isArray(fields) ? fields : [];
    return JSON.stringify(items.map(function (field) {
      return {
        id: field?.id || "",
        name: field?.name || "",
        page: Number(field?.page || 0),
        text: normalizeSelectionText(field?.marker?.text || ""),
        hasSelectionState: Boolean(field?.marker?.selectionState),
      };
    }));
  }

  function restoreOnlyOfficeAnnotationFields(fields) {
    const api = getEditorApi();
    const items = Array.isArray(fields) ? fields : [];
    const signature = getAnnotationRestoreSignature(items);
    if (annotationRestoreRunning || signature === lastAnnotationRestoreSignature) {
      return { ok: true, skipped: items.length, deduped: true };
    }
    annotationRestoreRunning = true;
    let applied = 0;
    let skipped = 0;
    try {
      const results = items.map(function (field) {
        const marker = field?.marker || {};
        if (marker.selectionState) {
          const stateResult = highlightOnlyOfficeSelection(marker.selectionState);
          if (stateResult?.ok && !stateResult.skipped) {
            applied += 1;
            return { id: field.id, source: "selection-state", result: stateResult };
          }
          const searchResult = highlightAnnotationFieldBySearch(field);
          if (searchResult?.ok) applied += 1;
          else skipped += 1;
          return { id: field.id, source: "selection-state-fallback-search", stateResult, searchResult };
        }
        const result = highlightAnnotationFieldBySearch(field);
        if (result?.ok) applied += 1;
        else skipped += 1;
        return result;
      });
      if (applied > 0 && typeof api?.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
      const payload = { ok: true, applied, skipped, results };
      if (!results.some(function (result) { return result?.reason === "find-error"; })) {
        lastAnnotationRestoreSignature = signature;
      }
      try { console.log("[guangfa-onlyoffice-annotation-restore] " + JSON.stringify(payload)); } catch {}
      try {
        window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "annotation-restore", restore: payload }, "*");
      } catch {}
      return payload;
    } finally {
      annotationRestoreRunning = false;
    }
  }

  function buildAnnotationSearchTokens(field) {
    const markerText = normalizeSelectionText(field?.marker?.text);
    const name = normalizeSelectionText(field?.name);
    const dateVariants = buildDateSearchVariants(markerText, name);
    const pieces = markerText
      .replace(/[�]+/g, " ")
      .split(/[□☐○〇▢_＿—\\-]+/)
      .map(normalizeSelectionText)
      .filter(function (item) { return item.length >= 3; });
    return Array.from(new Set([markerText, ...dateVariants, ...pieces, name].filter(function (item) { return item && item.length >= 2; })))
      .sort(function (a, b) { return b.length - a.length; })
      .slice(0, 8);
  }

  function buildDateSearchVariants(markerText, name) {
    const compact = String(markerText || name || "").replace(/\s+/g, "");
    if (!compact.includes("年月日")) return [];
    return [1, 2, 3, 4, 5, 6].map(function (spaceCount) {
      const spaces = " ".repeat(spaceCount);
      return "年" + spaces + "月" + spaces + "日";
    });
  }

  function rangeMatchesPage(range, page) {
    const expected = Number(page);
    if (!Number.isFinite(expected) || expected <= 0) return true;
    const start = Number(safeCall(range, "GetStartPage", NaN));
    const end = Number(safeCall(range, "GetEndPage", start));
    if (!Number.isFinite(start)) return true;
    const startPage = start + 1;
    const endPage = Number.isFinite(end) ? end + 1 : startPage;
    return expected >= startPage && expected <= endPage;
  }

  function setTrackRevisions(enabled) {
    const nextEnabled = enabled !== false;
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const attempts = [
      function () { return callTrackRevisionSetter(api, "asc_SetTrackRevisions", nextEnabled); },
      function () { return callTrackRevisionSetter(api, "asc_setTrackRevisions", nextEnabled); },
      function () { return callTrackRevisionSetter(api, "SetTrackRevisions", nextEnabled); },
      function () { return callTrackRevisionSetter(logicDocument, "SetTrackRevisions", nextEnabled); },
    ];
    for (const attempt of attempts) {
      try {
        const result = attempt();
        if (result === "missing") continue;
        if (result !== false) {
          window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "track-revisions", ok: true, enabled: nextEnabled }, "*");
          return { ok: true, enabled: nextEnabled };
        }
      } catch {}
    }
    window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "track-revisions", ok: false, enabled: nextEnabled, error: "zl办公 修订模式接口不可用" }, "*");
    return { ok: false, enabled: nextEnabled, error: "zl办公 修订模式接口不可用" };
  }

  function callTrackRevisionSetter(target, method, enabled) {
    if (!target || typeof target[method] !== "function") return "missing";
    return target[method](enabled);
  }

  function enableTrackRevisions() {
    return setTrackRevisions(true);
  }

  function postOutline(trigger) {
    const payload = { ...extractOnlyOfficeOutline(), trigger };
    try {
      console.log("[guangfa-onlyoffice-outline]", payload);
      if (payload.items && console.table) console.table(payload.items);
    } catch {}
    try {
      window.parent.postMessage({ source: "guangfa-onlyoffice-custom", action: "onlyoffice-outline-probe", outline: payload }, "*");
    } catch {}
    return payload;
  }

  function postSelection(selection) {
    try {
      console.log("[guangfa-onlyoffice-selection]", selection);
    } catch {}
    const message = { source: "guangfa-onlyoffice-custom", action: "annotate-selection", selection: cloneSelectionPayload(selection) };
    try {
      window.parent?.postMessage(message, "*");
    } catch {}
    try {
      if (window.top && window.top !== window.parent) window.top.postMessage(message, "*");
    } catch {}
  }

  function cloneSelectionPayload(selection) {
    try {
      return JSON.parse(JSON.stringify(selection || {}));
    } catch {
      const { selectionState, ...plainSelection } = selection || {};
      return plainSelection;
    }
  }

  function postPageChange(pageNumber, source) {
    if (Date.now() < suppressPageSyncUntil) return;
    const fallback = extractOnlyOfficeVisiblePage();
    const nextPage = Number(pageNumber);
    const page = {
      ...fallback,
      ok: true,
      page: Number.isFinite(nextPage) && nextPage > 0 ? nextPage : fallback.page,
      source: source || fallback.source,
    };
    const message = { source: "guangfa-onlyoffice-custom", action: "onlyoffice-page-change", page };
    try {
      console.log("[guangfa-onlyoffice-page] " + JSON.stringify(page));
    } catch {}
    try {
      window.parent?.postMessage(message, "*");
    } catch {}
    try {
      if (window.top && window.top !== window.parent) window.top.postMessage(message, "*");
    } catch {}
  }

  let fillFields = [];
  let aiKnowledgeContext = null;
  let lastFieldPageSignature = "";
  let annotationRestoreRunning = false;
  let lastAnnotationRestoreSignature = "";
  let suppressPageSyncUntil = 0;

  function suppressPageSync(durationMs) {
    const until = Date.now() + Math.max(0, Number(durationMs) || 0);
    suppressPageSyncUntil = Math.max(suppressPageSyncUntil, until);
  }

  function restoreVisiblePage(pageNumber) {
    const page = Math.max(1, Number(pageNumber) || 0);
    if (!page) return false;
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const attempts = [
      function () { return api?.WordControl && typeof api.WordControl.GoToPage === "function" && api.WordControl.GoToPage(page - 1); },
      function () { return window.Asc?.editor?.WordControl && typeof window.Asc.editor.WordControl.GoToPage === "function" && window.Asc.editor.WordControl.GoToPage(page - 1); },
      function () { return logicDocument && typeof logicDocument.GoToPage === "function" && logicDocument.GoToPage(page - 1); },
    ];
    for (const attempt of attempts) {
      try {
        if (attempt() !== false) return true;
      } catch {}
    }
    return false;
  }

  function setFillFields(fields) {
    fillFields = Array.isArray(fields) ? fields.slice(0, 300) : [];
    postFieldPages("set-fields");
  }

  function setAiKnowledgeContext(context) {
    aiKnowledgeContext = context && typeof context === "object" ? context : null;
    window.__guangfaAiKnowledgeContext = aiKnowledgeContext;
    try {
      if (aiKnowledgeContext) window.localStorage.setItem("guangfa_ai_knowledge_context", JSON.stringify(aiKnowledgeContext));
      else window.localStorage.removeItem("guangfa_ai_knowledge_context");
    } catch {}
    updateGuangfaAiChatKnowledgeLabel(document.getElementById("guangfa-ai-chat-panel"));
  }

  function extractFieldPages() {
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.GetBookmarksManager !== "function" || fillFields.length === 0) {
      return { ok: false, pages: {}, count: 0, source: "bookmark-pages" };
    }

    const manager = logicDocument.GetBookmarksManager();
    const wantedBookmarkNames = new Set(fillFields.map(function (field) { return String(field?.bookmarkName || ""); }).filter(Boolean));
    const bookmarks = {};
    const count = Number(safeCall(manager, "GetCount", 0)) || 0;
    for (let index = 0; index < count; index += 1) {
      const name = String(safeCall(manager, "GetName", "", index) || "");
      if (!wantedBookmarkNames.has(name)) continue;
      const start = safeCall(manager, "GetBookmarkStart", null, index);
      const pos = safeCall(start, "GetDestinationXY", null);
      const page = Number(pos?.PageNum);
      if (Number.isFinite(page)) bookmarks[name] = page + 1;
    }
    const pages = {};
    fillFields.forEach((field) => {
      const page = bookmarks[field?.bookmarkName];
      if (page) pages[field.id] = page;
    });
    return { ok: true, pages, count: Object.keys(pages).length, source: "bookmark-pages" };
  }

  function postFieldPages(trigger) {
    const payload = { ...extractFieldPages(), trigger };
    const signature = JSON.stringify(payload.pages || {});
    if (signature === lastFieldPageSignature && trigger !== "manual") return payload;
    lastFieldPageSignature = signature;
    const message = { source: "guangfa-onlyoffice-custom", action: "onlyoffice-field-pages", fieldPages: payload };
    try {
      console.log("[guangfa-onlyoffice-field-pages] " + JSON.stringify(payload));
    } catch {}
    try {
      window.parent?.postMessage(message, "*");
    } catch {}
    try {
      if (window.top && window.top !== window.parent) window.top.postMessage(message, "*");
    } catch {}
    return payload;
  }

  let aiChatHistory = [];

  function getAiChatApiBase(context) {
    const explicit = String(context?.apiBase || "").trim();
    if (explicit) return explicit.replace(/\/$/, "");
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.hostname || "127.0.0.1";
    return window.location.port === "8080" ? `${protocol}//${host}:5173` : window.location.origin;
  }

  function getAiChatKnowledgeContext() {
    let context = aiKnowledgeContext;
    if (!context) {
      try {
        context = JSON.parse(window.localStorage.getItem("guangfa_ai_knowledge_context") || "null");
      } catch {}
    }
    const next = context && typeof context === "object" ? { ...context } : {};
    next.kbIds = Array.isArray(next.kbIds) ? next.kbIds.filter(Boolean) : [];
    next.topK = Number(next.topK) || 8;
    next.apiBase = getAiChatApiBase(next);
    next.enabled = next.enabled !== false && next.kbIds.length > 0;
    return next;
  }

  function getAiChatKnowledgeLabel(context) {
    const names = Array.isArray(context?.bases) ? context.bases.map((item) => item?.name).filter(Boolean) : [];
    if (names.length > 0) return names.join("、");
    if (Array.isArray(context?.kbIds) && context.kbIds.length > 0) return context.kbIds.join("、");
    return "未挂载知识库";
  }

  function ensureGuangfaAiChatStyle() {
    let style = document.getElementById("guangfa-ai-chat-panel-style");
    if (!style) style = document.createElement("style");
    style.id = "guangfa-ai-chat-panel-style";
    style.textContent = [
      "#guangfa-ai-chat-panel{position:fixed;right:42px;top:64px;width:var(--gf-ai-chat-width,360px);min-width:320px;max-width:760px;height:calc(100vh - 82px);max-height:680px;min-height:360px;z-index:1000000;background:#fff;border:1px solid #d9dee8;box-shadow:0 12px 32px rgba(15,23,42,.18);display:flex;flex-direction:column;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937}",
      "#guangfa-ai-chat-panel.gf-hidden{display:none}",
      ".gf-ai-chat-header{height:42px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;cursor:move}",
      ".gf-ai-chat-title{font-size:14px;font-weight:600;white-space:nowrap}",
      ".gf-ai-chat-kb{flex:1;min-width:0;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".gf-ai-chat-close{width:26px;height:26px;border:0;background:transparent;font-size:18px;line-height:24px;cursor:pointer;color:#64748b}",
      "#guangfa-ai-chat-panel,#guangfa-ai-chat-panel *{user-select:text!important;-webkit-user-select:text!important}",
      ".gf-ai-chat-header,.gf-ai-chat-header *{user-select:none!important;-webkit-user-select:none!important}",
      ".gf-ai-chat-resize{position:absolute;left:-8px;top:0;bottom:0;width:16px;cursor:ew-resize;z-index:4;touch-action:none;user-select:none!important;-webkit-user-select:none!important}",
      ".gf-ai-chat-resize::after{content:'';position:absolute;left:7px;top:50%;width:3px;height:42px;transform:translateY(-50%);border-left:1px solid #cbd5e1;border-right:1px solid #cbd5e1}",
      ".gf-ai-chat-messages{flex:1;overflow:auto;padding:12px;background:#fff}",
      ".gf-ai-chat-message{position:relative;max-width:92%;margin:0 0 10px;padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}",
      ".gf-ai-chat-message.user{margin-left:auto;background:#e8f1ff;color:#0f172a}",
      ".gf-ai-chat-message.assistant{margin-right:auto;background:#f3f4f6;color:#111827;padding-right:48px}",
      ".gf-ai-chat-message.pending{color:#64748b}",
      ".gf-ai-chat-write{position:absolute;right:6px;top:6px;border:0;background:#e2e8f0;color:#334155;border-radius:4px;padding:2px 6px;font-size:12px;cursor:pointer;user-select:none!important;-webkit-user-select:none!important}",
      ".gf-ai-chat-sources{margin-top:8px;padding-top:7px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:4px}",
      ".gf-ai-chat-source-title{font-size:12px;color:#64748b}",
      ".gf-ai-chat-source{border:0;background:#fff;color:#1d4ed8;border-radius:4px;padding:4px 6px;font-size:12px;line-height:1.35;text-align:left;cursor:pointer}",
      ".gf-ai-chat-source:hover{background:#e8f1ff}",
      ".gf-ai-chat-source-viewer{position:absolute;left:8px;right:8px;top:50px;bottom:74px;z-index:3;display:flex;flex-direction:column;background:#fff;border:1px solid #cbd5e1;box-shadow:0 12px 28px rgba(15,23,42,.18)}",
      ".gf-ai-chat-source-viewer-header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc}",
      ".gf-ai-chat-source-viewer-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".gf-ai-chat-source-viewer-close{border:0;background:transparent;font-size:18px;line-height:20px;cursor:pointer;color:#64748b}",
      ".gf-ai-chat-source-viewer-text{flex:1;overflow:auto;padding:10px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}",
      ".gf-ai-chat-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#f8fafc}",
      ".gf-ai-chat-input{flex:1;min-height:38px;max-height:96px;resize:vertical;border:1px solid #cbd5e1;border-radius:6px;padding:8px;font-size:13px;line-height:1.4}",
      ".gf-ai-chat-send{width:56px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;font-size:13px;cursor:pointer}",
      ".gf-ai-chat-send:disabled{opacity:.55;cursor:not-allowed}",
    ].join("");
    if (!style.parentNode) document.head.appendChild(style);
  }

  function writeGuangfaAiChatText(text, button) {
    const result = enterTextAtSelection(text);
    if (!button) return result;
    button.textContent = result.ok ? "已写入" : "写入失败";
    window.setTimeout(function () { button.textContent = "写入"; }, 1200);
    return result;
  }

  function bindGuangfaAiChatResize(panel) {
    const handle = panel?.querySelector?.(".gf-ai-chat-resize");
    if (!panel || !handle || handle.__gfAiChatResizeBound) return;
    handle.__gfAiChatResizeBound = true;
    handle.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.round(rect.left)}px`;
      panel.style.top = `${Math.round(rect.top)}px`;
      panel.style.right = "auto";
      panel.style.height = `${Math.round(rect.height)}px`;
      const startRight = rect.right;
      const maxWidth = Math.max(320, Math.min(760, startRight));
      const minWidth = Math.min(320, maxWidth);
      function onMove(moveEvent) {
        const width = Math.max(minWidth, Math.min(maxWidth, startRight - moveEvent.clientX));
        panel.style.left = `${Math.round(startRight - width)}px`;
        panel.style.setProperty("--gf-ai-chat-width", `${Math.round(width)}px`);
      }
      function onUp() {
        handle.releasePointerCapture?.(event.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  function bindGuangfaAiChatMove(panel) {
    const header = panel?.querySelector?.(".gf-ai-chat-header");
    if (!panel || !header || header.__gfAiChatMoveBound) return;
    header.__gfAiChatMoveBound = true;
    header.addEventListener("pointerdown", function (event) {
      if (event.target?.closest?.("button")) return;
      event.preventDefault();
      header.setPointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.round(rect.left)}px`;
      panel.style.top = `${Math.round(rect.top)}px`;
      panel.style.right = "auto";
      panel.style.height = `${Math.round(rect.height)}px`;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      function onMove(moveEvent) {
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);
        panel.style.left = `${Math.round(Math.max(0, Math.min(maxLeft, startLeft + moveEvent.clientX - startX)))}px`;
        panel.style.top = `${Math.round(Math.max(0, Math.min(maxTop, startTop + moveEvent.clientY - startY)))}px`;
      }
      function onUp() {
        header.releasePointerCapture?.(event.pointerId);
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", onUp);
        header.removeEventListener("pointercancel", onUp);
      }
      header.addEventListener("pointermove", onMove);
      header.addEventListener("pointerup", onUp);
      header.addEventListener("pointercancel", onUp);
    });
  }

  function ensureGuangfaAiChatResizeHandle(panel) {
    if (panel && !panel.querySelector(".gf-ai-chat-resize")) {
      panel.insertAdjacentHTML("afterbegin", '<div class="gf-ai-chat-resize" title="拖动调整宽度"></div>');
    }
  }

  function getGuangfaAiChatSourceLabel(snippet, index) {
    const kbName = snippet?.kbName || (snippet?.scope === "global" ? "全局知识库" : "项目知识库");
    const fileName = snippet?.source || snippet?.documentName || "未命名资料";
    const chunk = snippet?.chunkIndex ? `片段${snippet.chunkIndex}` : `片段${index + 1}`;
    return `${kbName} / ${fileName} / ${chunk}`;
  }

  function showGuangfaAiChatSource(snippet, index) {
    const panel = document.getElementById("guangfa-ai-chat-panel");
    if (!panel) return;
    panel.querySelector(".gf-ai-chat-source-viewer")?.remove();
    const viewer = document.createElement("div");
    viewer.className = "gf-ai-chat-source-viewer";
    const title = getGuangfaAiChatSourceLabel(snippet, index);
    viewer.innerHTML = [
      '<div class="gf-ai-chat-source-viewer-header">',
      '<div class="gf-ai-chat-source-viewer-title"></div>',
      '<button class="gf-ai-chat-source-viewer-close" type="button" aria-label="关闭原文">×</button>',
      "</div>",
      '<div class="gf-ai-chat-source-viewer-text"></div>',
    ].join("");
    viewer.querySelector(".gf-ai-chat-source-viewer-title").textContent = title;
    viewer.querySelector(".gf-ai-chat-source-viewer-text").textContent = snippet?.text || "未返回原文片段。";
    viewer.querySelector(".gf-ai-chat-source-viewer-close")?.addEventListener("click", function () {
      viewer.remove();
    });
    panel.appendChild(viewer);
  }

  function appendGuangfaAiChatSources(item, snippets) {
    const sources = (Array.isArray(snippets) ? snippets : []).filter((snippet) => snippet?.text).slice(0, 1);
    if (!item || sources.length === 0) return;
    const block = document.createElement("div");
    block.className = "gf-ai-chat-sources";
    const title = document.createElement("div");
    title.className = "gf-ai-chat-source-title";
    title.textContent = "引用来源";
    block.appendChild(title);
    sources.forEach(function (snippet, index) {
      const button = document.createElement("button");
      button.className = "gf-ai-chat-source";
      button.type = "button";
      button.textContent = getGuangfaAiChatSourceLabel(snippet, index);
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        showGuangfaAiChatSource(snippet, index);
      });
      block.appendChild(button);
    });
    item.appendChild(block);
  }

  function setGuangfaAiChatMessageText(item, text, writable, snippets) {
    if (!item) return;
    item.textContent = text;
    if (writable) {
      const button = document.createElement("button");
      button.className = "gf-ai-chat-write";
      button.type = "button";
      button.textContent = "写入";
      button.title = "写入到当前光标位置";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        writeGuangfaAiChatText(text, button);
      });
      item.appendChild(button);
    }
    appendGuangfaAiChatSources(item, snippets);
  }

  function updateGuangfaAiChatKnowledgeLabel(panel) {
    const label = panel?.querySelector?.(".gf-ai-chat-kb");
    if (label) label.textContent = getAiChatKnowledgeLabel(getAiChatKnowledgeContext());
  }

  function appendGuangfaAiChatMessage(role, text, className) {
    const list = document.querySelector("#guangfa-ai-chat-panel .gf-ai-chat-messages");
    if (!list) return null;
    const item = document.createElement("div");
    item.className = ["gf-ai-chat-message", role, className || ""].filter(Boolean).join(" ");
    setGuangfaAiChatMessageText(item, text, role === "assistant" && className !== "pending");
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    return item;
  }

  async function sendGuangfaAiChatMessage() {
    const panel = document.getElementById("guangfa-ai-chat-panel");
    const input = panel?.querySelector?.(".gf-ai-chat-input");
    const sendButton = panel?.querySelector?.(".gf-ai-chat-send");
    const message = String(input?.value || "").trim();
    if (!message || sendButton?.disabled) return;

    const context = getAiChatKnowledgeContext();
    updateGuangfaAiChatKnowledgeLabel(panel);
    input.value = "";
    sendButton.disabled = true;
    appendGuangfaAiChatMessage("user", message);
    const pending = appendGuangfaAiChatMessage("assistant", "正在思考中...", "pending");
    try {
      const response = await fetch(`${context.apiBase}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: aiChatHistory.slice(-8),
          knowledgeOptions: context,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      const reply = String(result.reply || "未生成有效回复。").trim();
      if (pending) {
        pending.classList.remove("pending");
        setGuangfaAiChatMessageText(pending, reply, true, result.snippets);
      }
      aiChatHistory.push({ role: "user", content: message }, { role: "assistant", content: reply });
      aiChatHistory = aiChatHistory.slice(-16);
    } catch (error) {
      if (pending) {
        pending.classList.remove("pending");
        setGuangfaAiChatMessageText(pending, `AI 回复失败：${error?.message || "未知错误"}`, false);
      }
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  }

  function ensureGuangfaAiChatPanel() {
    ensureGuangfaAiChatStyle();
    let panel = document.getElementById("guangfa-ai-chat-panel");
    if (panel) {
      ensureGuangfaAiChatResizeHandle(panel);
      bindGuangfaAiChatResize(panel);
      bindGuangfaAiChatMove(panel);
      return panel;
    }
    panel = document.createElement("aside");
    panel.id = "guangfa-ai-chat-panel";
    panel.className = "gf-hidden";
    panel.innerHTML = [
      '<div class="gf-ai-chat-resize" title="拖动调整宽度"></div>',
      '<div class="gf-ai-chat-header">',
      '<span class="gf-ai-chat-title">聊天机器人</span>',
      '<span class="gf-ai-chat-kb"></span>',
      '<button class="gf-ai-chat-close" type="button" aria-label="关闭聊天机器人">×</button>',
      "</div>",
      '<div class="gf-ai-chat-messages"></div>',
      '<form class="gf-ai-chat-form">',
      '<textarea class="gf-ai-chat-input" rows="2" placeholder="输入问题"></textarea>',
      '<button class="gf-ai-chat-send" type="submit">发送</button>',
      "</form>",
    ].join("");
    document.body.appendChild(panel);
    ensureGuangfaAiChatResizeHandle(panel);
    bindGuangfaAiChatResize(panel);
    bindGuangfaAiChatMove(panel);
    panel.querySelector(".gf-ai-chat-close")?.addEventListener("click", function () {
      panel.classList.add("gf-hidden");
    });
    panel.querySelector(".gf-ai-chat-form")?.addEventListener("submit", function (event) {
      event.preventDefault();
      sendGuangfaAiChatMessage();
    });
    panel.querySelector(".gf-ai-chat-input")?.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendGuangfaAiChatMessage();
      }
    });
    return panel;
  }

  function hideNativeAiChatEntrypoints() {
    document.querySelectorAll("button, [role='button'], .btn, [role='tab'], .toolbar-tab").forEach(function (node) {
      if (node.id === "id-right-menu-guangfa-ai-chat" || node.closest?.("#id-right-menu-guangfa-ai-chat")) return;
      const text = String(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(聊天机器人|Chatbot)$/i.test(text)) node.style.display = "none";
    });
  }

  function openOnlyOfficeAiChat() {
    try {
      hideNativeAiChatEntrypoints();
      const panel = ensureGuangfaAiChatPanel();
      updateGuangfaAiChatKnowledgeLabel(panel);
      panel.classList.remove("gf-hidden");
      panel.querySelector(".gf-ai-chat-input")?.focus();
      return true;
    } catch (error) {
      console.warn("[guangfa-onlyoffice-ai-chat-error]", error?.message || error);
    }
    return false;
  }

  function ensureAiChatQuickButton() {
    const holder = document.querySelector("#view-right-menu .tool-menu-btns");
    if (!holder) return false;
    if (!document.getElementById("guangfa-ai-chat-quick-style")) {
      const style = document.createElement("style");
      style.id = "guangfa-ai-chat-quick-style";
      style.textContent = "#id-right-menu-guangfa-ai-chat{display:flex!important;align-items:center!important;justify-content:center!important;width:28px!important;height:28px!important;min-width:28px!important;padding:0!important}#id-right-menu-guangfa-ai-chat .guangfa-ai-chat-icon{display:block!important;width:16px!important;height:16px!important;object-fit:contain!important;opacity:.85!important;pointer-events:none!important}";
      document.head.appendChild(style);
    }
    const slot = document.querySelector("#slot-right-menu-more");
    const anchor = slot || document.querySelector("#id-right-menu-filling-status");
    const button = document.getElementById("id-right-menu-guangfa-ai-chat") || document.createElement("button");
    if (anchor && button.parentNode !== holder) holder.insertBefore(button, anchor);
    else if (button.parentNode !== holder) holder.appendChild(button);
    button.id = "id-right-menu-guangfa-ai-chat";
    button.type = "button";
    button.className = "btn btn-category arrow-left";
    button.title = "聊天机器人";
    button.setAttribute("aria-label", "聊天机器人");
    button.setAttribute("data-hint", "0");
    button.setAttribute("data-hint-direction", "left");
    button.setAttribute("data-hint-offset", "big");
    button.innerHTML = '<img class="guangfa-ai-chat-icon" src="/sdkjs-plugins/{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}/resources/icons/light/ask-ai.png" alt="">';
    if (!button.__guangfaAiChatClickBound) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openOnlyOfficeAiChat();
      }, true);
      button.__guangfaAiChatClickBound = true;
    }
    hideNativeAiChatEntrypoints();
    return true;
  }

  window.guangfaExtractOnlyOfficeOutline = extractOnlyOfficeOutline;
  window.guangfaPostOnlyOfficeOutline = function () {
    return postOutline("manual");
  };
  window.guangfaExtractOnlyOfficeSelection = extractOnlyOfficeSelection;
  window.guangfaPostOnlyOfficeSelection = function () {
    const selection = extractOnlyOfficeSelection();
    if (selection.ok) selection.highlight = applyTextHighlightToCurrentSelection();
    postSelection(selection);
    return selection;
  };
  window.guangfaEnableTrackRevisions = enableTrackRevisions;
  window.guangfaSetTrackRevisions = setTrackRevisions;
  window.guangfaSaveOnlyOfficeDocument = saveOnlyOfficeDocument;
  window.guangfaSetFillFields = setFillFields;
  window.guangfaAddComplexFillAnchor = addComplexFillAnchor;
  window.guangfaSelectComplexFillAnchor = selectComplexFillAnchor;
  window.guangfaDeleteComplexFillAnchor = deleteComplexFillAnchor;
  window.guangfaFillComplexFillField = fillComplexFillField;
  window.guangfaChoiceMarkerSelfTest = function () {
    const options = parseChoiceOptions("□第五章 评审办法（经评审的最低投标价法） □第五章 评审办法（综合评估法）");
    const target = findChoiceOption(options, { value: "综合评估法" });
    const taxOptions = parseChoiceOptions("□含税 □不含税");
    const taxTarget = findChoiceOption(taxOptions, { value: "9832553", choiceValue: "不含税" });
    const amountDescriptor = getAmountBlankDescriptor("三、最高限价： 元（□含税 □不含税）");
    const wanDescriptor = getAmountBlankDescriptor("三、最高限价： 万元（□含税 □不含税）");
    const shiwanDescriptor = getAmountBlankDescriptor("三、最高限价： 十万（□含税 □不含税）");
    const noRequirementOption = findNoRequirementChoiceOption({ sourceText: "2.业绩要求： □近年不少于 个类似项目。 □无业绩要求。" });
    return {
      ok: options.length === 2
        && /综合评估法/.test(target?.text || "")
        && /不含税/.test(taxTarget?.text || "")
        && amountDescriptor?.suffix === "元（"
        && wanDescriptor?.suffix === "万元（"
        && shiwanDescriptor?.suffix === "十万（"
        && noRequirementSearchTexts(noRequirementOption)[0] === "□无业绩要求。",
      count: options.length,
      target: target?.text || "",
      taxTarget: taxTarget?.text || "",
      amountDescriptor,
      wanDescriptor,
      shiwanDescriptor,
      noRequirementOption,
    };
  };
  window.guangfaPostFieldPages = function () {
    return postFieldPages("manual");
  };
  window.guangfaSetAiKnowledgeContext = setAiKnowledgeContext;
  window.guangfaOpenOnlyOfficeAiChat = openOnlyOfficeAiChat;
  window.guangfaEnsureAiChatQuickButton = ensureAiChatQuickButton;

  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.source === "guangfa-parent" && data.action === "enable-track-revisions") {
      enableTrackRevisions();
    }
    if (data.source === "guangfa-parent" && data.action === "set-track-revisions") {
      setTrackRevisions(data.enabled);
    }
    if (data.source === "guangfa-parent" && data.action === "save-document") {
      saveOnlyOfficeDocument(data.trigger);
    }
    if (data.source === "guangfa-parent" && data.action === "add-field-bookmark") {
      const result = addBookmarkToCurrentSelection(data.field || {});
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "field-bookmark", result }, "*");
    }
    if (data.source === "guangfa-parent" && data.action === "add-input-point") {
      const result = addInputPointBookmark(data.field || {});
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "input-point", result }, "*");
    }
    if (data.source === "guangfa-parent" && data.action === "add-complex-fill-anchor") {
      addComplexFillAnchor(data);
    }
    if (data.source === "guangfa-parent" && data.action === "select-complex-fill-anchor") {
      selectComplexFillAnchor(data);
    }
    if (data.source === "guangfa-parent" && data.action === "delete-complex-fill-anchor") {
      deleteComplexFillAnchor(data);
    }
    if (data.source === "guangfa-parent" && data.action === "fill-complex-fill-field") {
      fillComplexFillField(data);
    }
    if (data.source === "guangfa-parent" && data.action === "fill-field-value") {
      const field = data.field || {};
      const requestId = data.requestId || field.requestId || "";
      const restorePage = field.suppressPageSync ? extractOnlyOfficeVisiblePage().page : 0;
      if (field.suppressPageSync) suppressPageSync(3000);
      const result = fillBookmarkedField(field);
      if (field.suppressPageSync) {
        suppressPageSync(3000);
        window.setTimeout(function () {
          suppressPageSync(1200);
          restoreVisiblePage(restorePage);
        }, 80);
      }
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "field-fill", result: { ...result, requestId } }, "*");
    }
    if (data.source === "guangfa-parent" && data.action === "sync-annotation-fields") {
      try { restoreOnlyOfficeAnnotationFields(data.fields); } catch {}
    }
    if (data.source === "guangfa-parent" && data.action === "sync-fill-fields") {
      setFillFields(data.fields);
    }
    if (data.source === "guangfa-parent" && data.action === "sync-ai-knowledge-context") {
      setAiKnowledgeContext(data.context);
    }
  });

  function wirePageCallback() {
    const api = getEditorApi();
    if (!api || typeof api.asc_registerCallback !== "function" || api.__guangfaPageCallbackWired) return false;
    try {
      api.asc_registerCallback("asc_onCurrentPage", function (pageIndex) {
        postPageChange(Number(pageIndex) + 1, "current-page-callback");
      });
    } catch {}
    try {
      api.asc_registerCallback("asc_onCurrentVisiblePage", function (pageIndex) {
        postPageChange(Number(pageIndex) + 1, "visible-page-callback");
      });
    } catch {}
    api.__guangfaPageCallbackWired = true;
    return true;
  }

  let lastPostedPage = 0;
  window.setInterval(function () {
    try {
      ensureAiChatQuickButton();
      wirePageCallback();
      const page = extractOnlyOfficeVisiblePage().page;
      if (page && page !== lastPostedPage) {
        lastPostedPage = page;
        postPageChange(page, "visible-page-poll");
      }
      if (fillFields.length > 0) postFieldPages("poll");
    } catch (error) {
      console.warn("[guangfa-onlyoffice-page-error]", error?.message || error);
    }
  }, 800);

  let tries = 0;
  const timer = window.setInterval(function () {
    tries += 1;
    const payload = extractOnlyOfficeOutline();
    if (payload.ok || tries >= 30) {
      window.clearInterval(timer);
      postOutline("auto");
    }
  }, 1000);

})();

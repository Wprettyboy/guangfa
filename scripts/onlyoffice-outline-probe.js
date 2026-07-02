(function () {
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

  function applyTextHighlightToCurrentSelection() {
    const api = getEditorApi();
    if (api && typeof api.put_LineHighLight === "function") {
      api.put_LineHighLight(true, 255, 255, 0);
      if (typeof api.asc_Save === "function") window.setTimeout(function () { api.asc_Save(false); }, 80);
      return { ok: true, color: "FFFF00", source: "put-line-highlight" };
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
        return { ok: false, error: "字段书签选区为空，请重新标注并保存模板" };
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
      const result = checkChoiceMarker(field);
      const amountResult = result.ok && (field?.amountValue || field?.fillMode === "amount-choice") ? fillAmountBlank(field) : null;
      postFieldPages("fill-choice-field");
      return { ...result, amountResult, id: field?.id, bookmarkName: getFieldBookmarkName(field) };
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

  function enableTrackRevisions() {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const attempts = [
      function () { return api && typeof api.asc_SetTrackRevisions === "function" && api.asc_SetTrackRevisions(true); },
      function () { return api && typeof api.asc_setTrackRevisions === "function" && api.asc_setTrackRevisions(true); },
      function () { return api && typeof api.SetTrackRevisions === "function" && api.SetTrackRevisions(true); },
      function () { return logicDocument && typeof logicDocument.SetTrackRevisions === "function" && logicDocument.SetTrackRevisions(true); },
    ];
    for (const attempt of attempts) {
      try {
        const result = attempt();
        if (result !== false) {
          window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "track-revisions", ok: true }, "*");
          return { ok: true };
        }
      } catch {}
    }
    window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "track-revisions", ok: false, error: "zl办公 修订模式接口不可用" }, "*");
    return { ok: false, error: "zl办公 修订模式接口不可用" };
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
  let lastFieldPageSignature = "";
  let annotationRestoreRunning = false;
  let lastAnnotationRestoreSignature = "";

  function setFillFields(fields) {
    fillFields = Array.isArray(fields) ? fields.slice(0, 300) : [];
    postFieldPages("set-fields");
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
  window.guangfaSaveOnlyOfficeDocument = saveOnlyOfficeDocument;
  window.guangfaSetFillFields = setFillFields;
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

  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.source === "guangfa-parent" && data.action === "enable-track-revisions") {
      enableTrackRevisions();
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
    if (data.source === "guangfa-parent" && data.action === "fill-field-value") {
      const result = fillBookmarkedField(data.field || {});
      window.parent?.postMessage({ source: "guangfa-onlyoffice-custom", action: "field-fill", result }, "*");
    }
    if (data.source === "guangfa-parent" && data.action === "sync-annotation-fields") {
      try { restoreOnlyOfficeAnnotationFields(data.fields); } catch {}
    }
    if (data.source === "guangfa-parent" && data.action === "sync-fill-fields") {
      setFillFields(data.fields);
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

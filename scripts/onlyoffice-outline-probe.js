(function () {
  const complexFillHighlightColor = { r: 211, g: 211, b: 211, color: "D3D3D3" };
  const handledKnowledgeTableRequestIds = new Set();
  const handledKnowledgeImageRequestIds = new Set();
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

  function readDocumentStyles() {
    try {
      const doc = window.Api && typeof window.Api.GetDocument === "function" ? window.Api.GetDocument() : null;
      if (doc && typeof doc.GetAllStyles === "function") {
        return normalizeOnlyOfficeStyles(doc.GetAllStyles());
      }
    } catch {
      return readLogicDocumentStyles();
    }
    return readLogicDocumentStyles();
  }

  function normalizeOnlyOfficeStyles(rawStyles) {
    const styles = Array.isArray(rawStyles)
      ? rawStyles
      : rawStyles && Number.isFinite(Number(rawStyles.length))
        ? Array.prototype.slice.call(rawStyles)
        : [];
    return styles
      .map(function (style, index) {
        const name = getOnlyOfficeStyleName(style);
        const id = String(
          style?.id
          || style?.Id
          || safeCall(style, "GetId", "")
          || safeCall(style, "get_Id", "")
          || safeCall(style, "GetStyleId", "")
          || name,
        ).trim();
        return name ? { id, name, index } : null;
      })
      .filter(Boolean);
  }

  function getOnlyOfficeStyleName(style) {
    return String(
      style?.name
      || style?.Name
      || safeCall(style, "GetName", "")
      || safeCall(style, "get_Name", "")
      || safeCall(style, "Get_Name", "")
      || style
      || "",
    ).trim();
  }

  function readLogicDocumentStyles() {
    try {
      const styles = safeCall(getLogicDocument(), "GetStyles", null) || safeCall(getLogicDocument(), "Get_Styles", null);
      const styleMap = styles?.Style || {};
      return Object.keys(styleMap)
        .map((id, index) => {
          const name = getOnlyOfficeStyleName(styleMap[id]);
          return name ? { id, name, index } : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function readDocumentStylesForPost() {
    if (!window.Asc?.Editor || typeof window.Asc.Editor.callCommand !== "function") {
      return readDocumentStyles();
    }
    try {
      window.Asc.scope = window.Asc.scope || {};
      window.Asc.scope.gfDocumentStylesResult = [];
      await window.Asc.Editor.callCommand(function () {
        function callStyle(style, names) {
          for (var index = 0; index < names.length; index += 1) {
            try {
              if (style && typeof style[names[index]] === "function") return style[names[index]]();
            } catch (error) {}
          }
          return "";
        }
        try {
          var doc = Api.GetDocument();
          if (!doc || typeof doc.GetAllStyles !== "function") {
            Asc.scope.gfDocumentStylesResult = [];
            return;
          }
          var rawStyles = doc.GetAllStyles();
          var styles = Array.isArray(rawStyles)
            ? rawStyles
            : rawStyles && Number.isFinite(Number(rawStyles.length))
              ? Array.prototype.slice.call(rawStyles)
              : [];
          Asc.scope.gfDocumentStylesResult = styles.map(function (style, index) {
            var name = String(
              style?.name
              || style?.Name
              || callStyle(style, ["GetName", "get_Name"])
              || style
              || "",
            ).trim();
            var id = String(
              style?.id
              || style?.Id
              || callStyle(style, ["GetId", "get_Id"])
              || name,
            ).trim();
            return name ? { id: id, name: name, index: index } : null;
          }).filter(Boolean);
        } catch (error) {
          Asc.scope.gfDocumentStylesResult = [];
        }
      });
      return Array.isArray(window.Asc.scope.gfDocumentStylesResult) ? window.Asc.scope.gfDocumentStylesResult : [];
    } catch {
      return readDocumentStyles();
    }
  }

  async function readOutlineStyleMetadataForPost(items) {
    const sourceItems = (Array.isArray(items) ? items : [])
      .map(function (item) {
        return {
          index: Number(item?.index),
          level: Number(item?.level),
          title: String(item?.title || item?.displayTitle || ""),
        };
      })
      .filter(function (item) { return Number.isFinite(item.index); });
    if (!sourceItems.length) {
      window.Asc = window.Asc || {};
      window.Asc.scope = window.Asc.scope || {};
      window.Asc.scope.gfOutlineStyleDebug = { error: "没有可读取的大纲项" };
      window.Asc.scope.gfOutlineDocumentText = "";
      return [];
    }
    return readOutlineStyleMetadataFromLogic(sourceItems, "outline-manager-elements");
  }

  function readOutlineStyleMetadataFromLogic(sourceItems, source) {
    window.Asc = window.Asc || {};
    window.Asc.scope = window.Asc.scope || {};
    try {
      const logicDocument = getLogicDocument();
      const outlineElements = getOutlineManager()?.Elements;
      const paragraphs = getLogicDocumentParagraphs(logicDocument);
      const paragraphRows = paragraphs.map((paragraph, paragraphIndex) => ({
        paragraph,
        paragraphIndex,
        text: normalizeOutlineText(safeCall(paragraph, "GetText", "", { NewLine: true, ParaSeparator: "\n", Numbering: true })),
        styleName: getLogicParagraphStyleName(paragraph, logicDocument),
      }));
      const matched = matchOutlineStyleRows(sourceItems, outlineElements, paragraphRows, source);
      window.Asc.scope.gfOutlineStyleDebug = {
        source,
        paragraphCount: paragraphs.length,
        nonEmptyParagraphCount: paragraphRows.filter((row) => row.text).length,
        matchedParagraphCount: matched.filter((item) => item.styleRef).length,
        requestedTitles: sourceItems.slice(0, 12).map((item) => ({ index: item.index, title: item.title })),
        samples: paragraphRows.filter((row) => row.text).slice(0, 18).map((row) => ({
          paragraphIndex: row.paragraphIndex,
          text: row.text,
          styleName: row.styleName,
        })),
      };
      window.Asc.scope.gfOutlineDocumentText = paragraphRows.map((row) => row.text).filter(Boolean).join("\n").slice(0, 80000);
      return matched;
    } catch (error) {
      window.Asc.scope.gfOutlineStyleDebug = { source, error: String(error?.message || error || "逻辑文档样式读取失败") };
      window.Asc.scope.gfOutlineDocumentText = "";
      return [];
    }
  }

  function normalizeOutlineText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isSolutionHeadingStyleName(styleName) {
    return /heading\s*\d|标题\s*\d|标题\d/i.test(String(styleName || ""));
  }

  function getLogicDocumentParagraphs(logicDocument) {
    if (!logicDocument) return [];
    const attempts = [
      () => safeCall(logicDocument, "GetAllParagraphs", null, { OnlyMainDocument: true, All: true }),
      () => safeCall(logicDocument, "GetAllParagraphs", null, { All: true }),
      () => safeCall(logicDocument, "GetAllParagraphs", null),
    ];
    for (const attempt of attempts) {
      try {
        const paragraphs = attempt();
        if (Array.isArray(paragraphs)) return paragraphs;
      } catch {}
    }
    return [];
  }

  function getLogicParagraphStyleName(paragraph, logicDocument) {
    const paraPr = safeCall(paragraph, "GetCalculatedParaPr", null)
      || safeCall(paragraph, "Get_CompiledPr2", null, false)?.ParaPr
      || paragraph?.Pr
      || null;
    const styleId = paraPr?.PStyle || paragraph?.Pr?.PStyle || "";
    const styles = safeCall(logicDocument, "GetStyles", null) || safeCall(logicDocument, "Get_Styles", null);
    const style = styleId ? safeCall(styles, "Get", null, styleId) || styles?.Style?.[styleId] : null;
    return getOnlyOfficeStyleName(style);
  }

  function matchOutlineStyleRows(items, outlineElements, paragraphRows, source) {
    const paragraphIndexes = new Map(paragraphRows.map((row) => [row.paragraph, row.paragraphIndex]));
    const matched = items.map((item) => {
      const paragraphIndex = paragraphIndexes.get(outlineElements?.[item.index]);
      const found = Number.isInteger(paragraphIndex) ? paragraphRows[paragraphIndex] : null;
      return {
        index: item.index,
        paragraphIndex: found ? found.paragraphIndex : null,
        styleName: found?.styleName || "",
        styleSource: found ? `${source}-paragraph-identity` : "not-found",
        styleRef: found ? {
          paragraphIndex: found.paragraphIndex,
          outlineIndex: item.index,
          title: item.title,
          level: Number.isFinite(Number(item.level)) ? Number(item.level) : null,
          styleName: found.styleName || "",
        } : null,
        bodyStyleName: "",
        bodyParagraphIndex: null,
        bodyStyleSource: "not-found",
        bodyText: "",
        bodyParagraphCount: null,
        bodyStyleRef: null,
      };
    });
    for (let matchIndex = 0; matchIndex < matched.length; matchIndex += 1) {
      const current = matched[matchIndex];
      if (!Number.isFinite(Number(current.paragraphIndex))) continue;
      const next = matched[matchIndex + 1];
      const boundaryIndex = next
        ? Number.isFinite(Number(next.paragraphIndex)) ? Number(next.paragraphIndex) : null
        : paragraphRows.length;
      if (!Number.isFinite(boundaryIndex) || boundaryIndex <= current.paragraphIndex) continue;
      const body = paragraphRows.find((row) => (
        row.paragraphIndex > current.paragraphIndex
        && row.paragraphIndex < boundaryIndex
        && row.text
        && !isSolutionHeadingStyleName(row.styleName)
      ));
      const bodyRows = paragraphRows.filter((row) => (
        row.paragraphIndex > current.paragraphIndex
        && row.paragraphIndex < boundaryIndex
        && row.text
        && !isSolutionHeadingStyleName(row.styleName)
      ));
      current.bodyStyleName = body?.styleName || "";
      current.bodyParagraphIndex = body ? body.paragraphIndex : null;
      current.bodyStyleSource = body ? `${source}-next-paragraph-before-next-outline` : "not-found";
      current.bodyText = bodyRows.map((row) => row.text).filter(Boolean).join("\n").slice(0, 6000);
      current.bodyParagraphCount = Math.max(0, boundaryIndex - current.paragraphIndex - 1);
      current.bodyStyleRef = body ? {
        paragraphIndex: body.paragraphIndex,
        outlineIndex: current.index,
        title: current.styleRef?.title || "",
        text: body.text || "",
        level: current.styleRef?.level ?? null,
        styleName: body.styleName || "",
      } : null;
    }
    return matched;
  }

  function extractOnlyOfficeOutline() {
    const manager = getOutlineManager();
    if (!manager) return { ok: false, source: "outline-manager", count: 0, items: [], error: "未获取到 zl办公 大纲管理器" };
    const items = readManagerOutline(manager);
    return { ok: true, source: "outline-manager", count: items.length, items, documentStyles: readDocumentStyles() };
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

  function readCurrentSelectedText() {
    return readSelectedText(getLogicDocument()) || readSelectedText(getEditorApi()) || readSelectedText(window.Asc?.editor);
  }

  function isCurrentSelectionEmpty() {
    const logicDocument = getLogicDocument();
    try {
      return Boolean(logicDocument && typeof logicDocument.IsSelectionEmpty === "function" && logicDocument.IsSelectionEmpty(true));
    } catch {
      return false;
    }
  }

  function matchesExpectedSelectionText(selectedText, expectedText) {
    const expected = normalizeSelectionText(expectedText);
    return !expected || normalizeSelectionText(selectedText) === expected;
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

  function getApiDocument() {
    const attempts = [
      () => window.Api?.GetDocument?.(),
      () => window.AscBuilder?.Word?.Api?.GetDocument?.(),
      () => window.AscBuilder?.Api?.GetDocument?.(),
    ];
    for (const attempt of attempts) {
      try {
        const documentApi = attempt();
        if (documentApi && typeof documentApi.GetRangeBySelect === "function") return documentApi;
      } catch {}
    }
    return null;
  }

  function getApiDocumentAny() {
    const attempts = [
      () => window.Api?.GetDocument?.(),
      () => window.AscBuilder?.Word?.Api?.GetDocument?.(),
      () => window.AscBuilder?.Api?.GetDocument?.(),
    ];
    for (const attempt of attempts) {
      try {
        const documentApi = attempt();
        if (documentApi) return documentApi;
      } catch {}
    }
    return null;
  }

  function getTableApiRoot() {
    const attempts = [
      () => window.Api,
      () => window.AscBuilder?.Word?.Api,
      () => window.AscBuilder?.Api,
    ];
    for (const attempt of attempts) {
      try {
        const apiRoot = attempt();
        if (apiRoot && typeof apiRoot.CreateTable === "function") return apiRoot;
      } catch {}
    }
    return null;
  }

  function getComplexFillBookmarkName(item) {
    if (item?.bookmarkName) return String(item.bookmarkName);
    const id = String(item?.id || "").trim();
    const numberPart = id.match(/^CF-(\d+)$/)?.[1];
    const safeId = numberPart ? numberPart.padStart(3, "0") : id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
    return safeId ? "GF_CF_" + safeId : "";
  }

  function getComplexFillSelectionBookmarkName(item) {
    if (item?.selectionBookmarkName) return String(item.selectionBookmarkName);
    if (item?.rangeBookmarkName) return String(item.rangeBookmarkName);
    const bookmarkName = typeof item === "string" ? item : getComplexFillBookmarkName(item);
    if (!bookmarkName) return "";
    if (bookmarkName.indexOf("GF_CF_SEL_") === 0) return bookmarkName;
    if (bookmarkName.indexOf("GF_CF_") === 0) return "GF_CF_SEL_" + bookmarkName.slice("GF_CF_".length);
    return "GF_CF_SEL_" + String(bookmarkName).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
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

  function addComplexFillSelectionBookmark(manager, bookmarkName, selectionState, expectedText) {
    if (!manager || !bookmarkName) return { ok: false, bookmarkName, error: "复杂类填充选区书签接口不可用" };
    removeBookmark(manager, bookmarkName);
    restoreSelectionState(selectionState);

    const liveSelectedText = readCurrentSelectedText();
    if (!liveSelectedText || isCurrentSelectionEmpty()) {
      return { ok: false, bookmarkName, error: "当前选区为空，请重新选择要整体替换的模板文字。" };
    }

    const documentApi = getApiDocument();
    if (documentApi) {
      try {
        const range = documentApi.GetRangeBySelect();
        if (range && typeof range.AddBookmark === "function") {
          const added = range.AddBookmark(bookmarkName);
          const selected = selectComplexFillBookmarkForMutation(manager, bookmarkName);
          const selectedText = selected.ok ? readCurrentSelectedText() : "";
          if (added !== false && selected.ok && selectedText && !isCurrentSelectionEmpty()) {
            if (!matchesExpectedSelectionText(selectedText, expectedText)) {
              removeBookmark(manager, bookmarkName);
              return { ok: false, bookmarkName, error: "复杂类填充选区书签范围与当前选区不一致，请重新标注。", selectedText };
            }
            return { ...selected, selectedText, source: "api-range-add-bookmark" };
          }
          removeBookmark(manager, bookmarkName);
        }
      } catch {}
    }

    restoreSelectionState(selectionState);
    try {
      const added = manager.AddBookmark(bookmarkName);
      const selected = selectComplexFillBookmarkForMutation(manager, bookmarkName);
      const selectedText = selected.ok ? readCurrentSelectedText() : "";
      if (added !== false && selected.ok && selectedText && !isCurrentSelectionEmpty()) {
        if (!matchesExpectedSelectionText(selectedText, expectedText)) {
          removeBookmark(manager, bookmarkName);
          return { ok: false, bookmarkName, error: "复杂类填充选区书签范围与当前选区不一致，请重新标注。", selectedText };
        }
        return { ...selected, selectedText, source: "document-add-bookmark" };
      }
      removeBookmark(manager, bookmarkName);
      return { ok: false, bookmarkName, error: "复杂类填充选区书签为空，请重新选择模板文字后再建立标签。" };
    } catch (error) {
      removeBookmark(manager, bookmarkName);
      return { ok: false, bookmarkName, error: error?.message || "复杂类填充选区书签写入失败" };
    }
  }

  function selectComplexFillAnchorRangeForMutation(manager, anchor, options = {}) {
    const bookmarkName = getComplexFillBookmarkName(anchor);
    const selectionBookmarkName = getComplexFillSelectionBookmarkName(anchor);
    const expectedText = anchor?.sourceText || anchor?.selectedText || "";
    const requireExpectedText = options.requireExpectedText !== false;
    const names = [selectionBookmarkName, bookmarkName].filter(function (name, index, items) {
      return name && items.indexOf(name) === index;
    });
    let firstFailure = null;
    for (let index = 0; index < names.length; index += 1) {
      const selected = selectComplexFillBookmarkForMutation(manager, names[index]);
      if (selected.ok) {
        const selectedText = readCurrentSelectedText();
        if (selectedText && !isCurrentSelectionEmpty() && (!requireExpectedText || matchesExpectedSelectionText(selectedText, expectedText))) {
          return {
            ...selected,
            bookmarkName,
            selectionBookmarkName,
            activeBookmarkName: names[index],
            usedSelectionBookmark: names[index] === selectionBookmarkName,
            selectedText,
          };
        }
        const textFailure = {
          ...selected,
          ok: false,
          error: selectedText ? "复杂类填充书签范围与原选区不一致，请重新标注并保存模板。" : "复杂类填充书签选区为空，请重新标注并保存模板。",
          selectedText,
        };
        if (!firstFailure) firstFailure = textFailure;
        continue;
      }
      if (!firstFailure) firstFailure = selected;
    }
    if (anchor?.selectionState && restoreSelectionState(anchor.selectionState)) {
      const selectedText = readCurrentSelectedText();
      if (selectedText && !isCurrentSelectionEmpty() && matchesExpectedSelectionText(selectedText, expectedText)) {
        const pageInfo = extractOnlyOfficePage(safeCall(getLogicDocument(), "GetSelectionState", null));
        return {
          ok: true,
          bookmarkName,
          selectionBookmarkName,
          activeBookmarkName: "selection-state",
          usedSelectionBookmark: false,
          selected: true,
          moved: false,
          page: pageInfo.page,
          pageSource: pageInfo.source,
          selectedText,
          source: "selection-state",
        };
      }
      if (!firstFailure) {
        firstFailure = {
          ok: false,
          bookmarkName,
          selectionBookmarkName,
          error: selectedText ? "复杂类填充选区状态与原选区不一致，请重新标注并保存模板。" : "复杂类填充选区状态为空，请重新标注并保存模板。",
          selectedText,
        };
      }
    }
    return {
      ...(firstFailure || { ok: false, bookmarkName, error: "未找到对应复杂类填充书签" }),
      ok: false,
      bookmarkName,
      selectionBookmarkName,
    };
  }

  function addComplexFillBusinessBookmark(manager, bookmarkName, selectionBookmarkName) {
    if (!manager || !bookmarkName || !selectionBookmarkName) return { ok: false, error: "复杂类填充业务书签接口不可用" };
    removeBookmark(manager, bookmarkName);
    const moved = goToBookmark(manager, selectionBookmarkName);
    try {
      const added = manager.AddBookmark(bookmarkName);
      if (added === false || !hasBookmark(manager, bookmarkName)) {
        selectBookmarkRange(manager, selectionBookmarkName);
        const rangeAdded = manager.AddBookmark(bookmarkName);
        const rangeSelected = selectBookmarkRange(manager, selectionBookmarkName);
        return { ok: rangeAdded !== false && hasBookmark(manager, bookmarkName), moved, selected: rangeSelected, fallback: "range-bookmark" };
      }
      const selected = selectBookmarkRange(manager, selectionBookmarkName);
      return { ok: added !== false, moved, selected };
    } catch (error) {
      return { ok: false, moved, error: error?.message || "复杂类填充业务书签写入失败" };
    }
  }

  function verifyComplexFillAnchorCreated(manager, bookmarkName, selectionBookmarkName, expectedText) {
    if (!manager || !bookmarkName || !selectionBookmarkName) {
      return { ok: false, bookmarkName, selectionBookmarkName, error: "复杂类填充书签接口不可用" };
    }
    if (!hasBookmark(manager, selectionBookmarkName)) {
      return { ok: false, bookmarkName, selectionBookmarkName, error: "复杂类填充选区书签未写入文档" };
    }
    if (!hasBookmark(manager, bookmarkName)) {
      return { ok: false, bookmarkName, selectionBookmarkName, error: "复杂类填充业务书签未写入文档" };
    }
    const selected = selectComplexFillBookmarkForMutation(manager, selectionBookmarkName);
    if (!selected.ok) {
      return {
        ...selected,
        ok: false,
        bookmarkName,
        selectionBookmarkName,
        error: selected.error || "复杂类填充选区书签无法定位",
      };
    }
    const selectedText = readCurrentSelectedText();
    if (!selectedText || isCurrentSelectionEmpty()) {
      return { ok: false, bookmarkName, selectionBookmarkName, error: "复杂类填充选区书签范围为空，请重新选中文本建立书签。" };
    }
    if (!matchesExpectedSelectionText(selectedText, expectedText)) {
      return { ok: false, bookmarkName, selectionBookmarkName, selectedText, error: "复杂类填充选区书签范围与当前选区不一致，请重新标注。" };
    }
    const selectionState = safeCall(getLogicDocument(), "GetSelectionState", null);
    const pageInfo = extractOnlyOfficePage(selectionState);
    return {
      ...selected,
      ok: true,
      bookmarkName,
      selectionBookmarkName,
      selectedText,
      selectionState,
      page: pageInfo.page || selected.page,
      pageSource: pageInfo.source || selected.pageSource,
    };
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
    const selectionBookmarkName = getComplexFillSelectionBookmarkName({ ...anchor, bookmarkName });
    if (!manager || !bookmarkName || !selectionBookmarkName) {
      return postComplexFillResult("complex-fill-anchor-added", { ok: false, requestId, bookmarkName, error: "复杂类填充书签接口不可用" });
    }

    try {
      removeBookmark(manager, bookmarkName);
      const selected = addComplexFillSelectionBookmark(manager, selectionBookmarkName, selection.selectionState, selection.text);
      if (!selected.ok) {
        removeBookmark(manager, selectionBookmarkName);
        removeBookmark(manager, bookmarkName);
        return postComplexFillResult("complex-fill-anchor-added", { ...selected, requestId });
      }
      const businessBookmark = addComplexFillBusinessBookmark(manager, bookmarkName, selectionBookmarkName);
      if (!businessBookmark.ok) {
        removeBookmark(manager, selectionBookmarkName);
        return postComplexFillResult("complex-fill-anchor-added", { ok: false, requestId, bookmarkName, selectionBookmarkName, error: businessBookmark.error || "复杂类填充业务书签写入失败" });
      }
      const verified = verifyComplexFillAnchorCreated(manager, bookmarkName, selectionBookmarkName, selection.text);
      if (!verified.ok) {
        removeBookmark(manager, bookmarkName);
        removeBookmark(manager, selectionBookmarkName);
        return postComplexFillResult("complex-fill-anchor-added", { ...verified, requestId });
      }
      const highlight = applyTextHighlightToCurrentSelection(complexFillHighlightColor);
      const anchoredSelectionState = verified.selectionState || selection.selectionState;
      const page = verified.page || selection.page || 1;
      saveOnlyOfficeDocument("complex-fill-anchor");
      return postComplexFillResult("complex-fill-anchor-added", {
        ok: true,
        requestId,
        highlight,
        anchor: {
          id: anchor.id,
          fieldId: anchor.fieldId || anchor.id,
          bookmarkName,
          selectionBookmarkName,
          page,
          sourceText: selection.text,
          selectionState: anchoredSelectionState,
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
    const anchor = payload.anchor || payload.item || {};
    const bookmarkName = String(payload.bookmarkName || anchor.bookmarkName || "");
    const result = selectComplexFillAnchorRangeForMutation(getBookmarkManager(), { ...anchor, bookmarkName }, { requireExpectedText: false });
    const highlight = result.ok ? applyTextHighlightToCurrentSelection(complexFillHighlightColor) : null;
    return postComplexFillResult("complex-fill-anchor-selected", { ...result, requestId, highlight });
  }

  function deleteComplexFillAnchor(payload = {}) {
    const requestId = payload.requestId || "";
    const anchor = payload.anchor || payload.item || {};
    const bookmarkName = String(payload.bookmarkName || anchor.bookmarkName || "");
    const selectionBookmarkName = getComplexFillSelectionBookmarkName({ ...anchor, bookmarkName });
    const manager = getBookmarkManager();
    try {
      const removed = removeBookmark(manager, bookmarkName);
      const bookmarkDeleted = removed !== false || !hasBookmark(manager, bookmarkName);
      const selected = selectComplexFillBookmarkForMutation(manager, selectionBookmarkName);
      const highlight = selected.ok ? clearTextHighlightFromCurrentSelection() : { ok: false, error: selected.error || "未能选中复杂类填充选区书签" };
      saveOnlyOfficeDocument("complex-fill-anchor-delete");
      return postComplexFillResult("complex-fill-anchor-deleted", {
        ok: bookmarkDeleted && highlight?.ok !== false,
        requestId,
        bookmarkName,
        selectionBookmarkName,
        page: selected.page || 1,
        bookmarkDeleted,
        highlight,
        error: bookmarkDeleted ? highlight?.error : "复杂类填充书签删除失败。",
      });
    } catch (error) {
      return postComplexFillResult("complex-fill-anchor-deleted", { ok: false, requestId, bookmarkName, selectionBookmarkName, page: 1, error: error?.message || "复杂类填充书签删除失败" });
    }
  }

  function fillComplexFillAnchor(anchor, value) {
    const bookmarkName = String(anchor?.bookmarkName || "");
    const selectionBookmarkName = getComplexFillSelectionBookmarkName(anchor);
    const manager = getBookmarkManager();
    if (!manager || !bookmarkName || !selectionBookmarkName) {
      return { ok: false, bookmarkName, error: "复杂类填充书签接口不可用" };
    }
    const selected = selectComplexFillAnchorRangeForMutation(manager, anchor, { requireExpectedText: false });
    if (!selected.ok) return selected;
    try {
      const selectedText = readSelectedText(getLogicDocument()) || readSelectedText(getEditorApi());
      if (normalizeSelectionText(selectedText) === normalizeSelectionText(value)) {
        return {
          ok: true,
          bookmarkName,
          selectionBookmarkName,
          page: selected.page || currentSelectionPage(),
          source: "complex-fill-already-applied",
          removeSource: "skipped-same-text",
        };
      }
      clearTextHighlightFromCurrentSelection();
      const removeResult = removeSelectedTextForReplacement();
      if (!removeResult.ok) {
        return { ok: false, bookmarkName, page: selected.page, error: removeResult.error || "复杂类填充原选区删除失败" };
      }
      removeBookmark(manager, bookmarkName);
      removeBookmark(manager, selectionBookmarkName);
      const insertResult = insertBookmarkedPlainText(value, selectionBookmarkName, manager, { removeBeforeInsert: false });
      if (!insertResult.ok) {
        return { ok: false, bookmarkName, page: selected.page, error: insertResult.error || "复杂类填充内容写入失败" };
      }
      const bookmarkResult = selectBookmarkRange(manager, selectionBookmarkName);
      if (bookmarkResult.ok) {
        addComplexFillBusinessBookmark(manager, bookmarkName, selectionBookmarkName);
        selectBookmarkRange(manager, selectionBookmarkName);
      }
      return {
        ok: true,
        bookmarkName,
        selectionBookmarkName,
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

  function enterTextAtSelection(text, saveTrigger) {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const value = String(text || "");
    const trigger = saveTrigger || "fill-field";
    try {
      if (api && typeof api.asc_enterText === "function") {
        api.asc_enterText(Array.from(value).map(function (char) { return char.codePointAt(0); }));
        saveOnlyOfficeDocument(trigger);
        return { ok: true, source: "asc-enter-text" };
      }
      if (logicDocument && typeof logicDocument.EnterText === "function") {
        logicDocument.EnterText(value);
        saveOnlyOfficeDocument(trigger);
        return { ok: true, source: "logic-enter-text" };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "字段写入失败" };
    }
    return { ok: false, error: "文本输入接口不可用" };
  }

  function clearBookmarkedField(field) {
    const bookmarkName = getFieldBookmarkName(field);
    let contentRemoved = false;
    if (!/^GF_FIELD_/.test(bookmarkName)) {
      return {
        ok: false,
        cleared: false,
        id: field?.id,
        bookmarkName,
        error: /^GF_INPUT_/.test(bookmarkName)
          ? "输入点书签没有可确认的已写范围，不能安全清空。"
          : "只有精确字段范围书签支持清空。",
      };
    }
    const logicDocument = getLogicDocument();
    const manager = logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
    if (!manager || typeof manager.SelectBookmark !== "function" || typeof manager.AddBookmark !== "function") {
      return { ok: false, cleared: false, id: field?.id, bookmarkName, error: "字段书签清空接口不可用。" };
    }
    try {
      if (!hasBookmark(manager, bookmarkName) || manager.SelectBookmark(bookmarkName) === false) {
        return { ok: false, cleared: false, id: field?.id, bookmarkName, error: "字段书签不存在，无法安全清空。" };
      }
      const selectedText = readSelectedText(logicDocument) || readSelectedText(getEditorApi());
      const selectionEmpty = safeCall(logicDocument, "IsSelectionEmpty", null, true);
      const pageInfo = extractOnlyOfficePage(safeCall(logicDocument, "GetSelectionState", null));
      if (selectionEmpty === true) {
        return { ok: true, cleared: true, alreadyCleared: true, id: field?.id, bookmarkName, page: pageInfo.page };
      }
      if (selectionEmpty !== false && !normalizeSelectionText(selectedText)) {
        return { ok: false, cleared: false, id: field?.id, bookmarkName, page: pageInfo.page, error: "无法确认字段书签范围，未执行清空。" };
      }
      const removed = removeSelectedTextForReplacement();
      if (!removed.ok) {
        return { ok: false, cleared: false, id: field?.id, bookmarkName, page: pageInfo.page, error: removed.error || "字段内容清空失败。" };
      }
      contentRemoved = true;
      removeBookmark(manager, bookmarkName);
      const added = manager.AddBookmark(bookmarkName);
      if (added === false || !hasBookmark(manager, bookmarkName)) {
        return { ok: false, partial: true, cleared: true, id: field?.id, bookmarkName, page: pageInfo.page, error: "字段内容已清空，但空书签重建失败。" };
      }
      saveOnlyOfficeDocument("clear-field");
      postFieldPages("clear-field");
      return {
        ok: true,
        cleared: true,
        id: field?.id,
        bookmarkName,
        page: pageInfo.page,
        source: "field-bookmark-clear",
        previousText: selectedText,
      };
    } catch (error) {
      return { ok: false, partial: contentRemoved, cleared: contentRemoved, id: field?.id, bookmarkName, error: error?.message || "字段书签清空失败。" };
    }
  }

  function normalizeSolutionWritingParagraphs(payload) {
    const rows = Array.isArray(payload?.paragraphs) ? payload.paragraphs : [];
    return rows
      .map(function (row) {
        return {
          type: String(row?.type || "body"),
          level: Number.isFinite(Number(row?.level)) ? Number(row.level) : null,
          style: String(row?.style || ""),
          styleName: String(row?.styleName || ""),
          styleFallback: String(row?.styleFallback || ""),
          styleRef: normalizeSolutionStyleRef(row?.styleRef),
          text: String(row?.text || ""),
        };
      })
      .filter(function (row) { return row.text || row.type === "blank"; });
  }

  function normalizeSolutionStyleRef(ref) {
    if (!ref || typeof ref !== "object") return null;
    const paragraphIndex = Number(ref.paragraphIndex);
    if (!Number.isFinite(paragraphIndex)) return null;
    return {
      paragraphIndex,
      outlineIndex: Number.isFinite(Number(ref.outlineIndex)) ? Number(ref.outlineIndex) : null,
      title: String(ref.title || "").trim(),
      text: String(ref.text || "").trim(),
      level: Number.isFinite(Number(ref.level)) ? Number(ref.level) : null,
      styleName: String(ref.styleName || "").trim(),
    };
  }

  function normalizeSolutionReplaceTarget(target) {
    if (!target || typeof target !== "object") return null;
    const title = String(target.title || "").trim();
    const styleRef = normalizeSolutionStyleRef(target.styleRef);
    const bodyStyleRef = normalizeSolutionStyleRef(target.bodyStyleRef);
    const rawBodyParagraphCount = target.bodyParagraphCount;
    const bodyParagraphCount = rawBodyParagraphCount == null || String(rawBodyParagraphCount).trim() === "" ? null : Number(rawBodyParagraphCount);
    if (!title && !styleRef) return null;
    return {
      title,
      headingPath: Array.isArray(target.headingPath) ? target.headingPath.map(function (item) { return String(item || "").trim(); }).filter(Boolean) : [],
      styleRef,
      bodyStyleRef,
      bodyParagraphCount: Number.isInteger(bodyParagraphCount) && bodyParagraphCount >= 0 ? bodyParagraphCount : null,
    };
  }

  function getSolutionStyleCandidates(item) {
    const raw = String(item?.styleName || item?.style || item?.styleFallback || "");
    const value = raw.toLowerCase();
    if (value.indexOf("word-style:") === 0) return [raw.slice("word-style:".length)];
    if (raw && !/^heading-\d$/.test(value) && value !== "body") return [raw];
    const headingMatch = value.match(/^heading-(\d)$/);
    if (headingMatch) {
      const level = headingMatch[1];
      return [`Heading ${level}`, `标题 ${level}`, `标题${level}`, `heading ${level}`];
    }
    return ["正文", "Normal", "normal"];
  }

  function getLogicReferenceParagraph(styleRef) {
    const logicDocument = getLogicDocument();
    const paragraphs = getLogicDocumentParagraphs(logicDocument);
    const paragraphIndex = Number(styleRef?.paragraphIndex);
    const expected = normalizeOutlineText(styleRef?.title || styleRef?.text || "");
    const candidate = Number.isFinite(paragraphIndex) ? paragraphs[paragraphIndex] : null;
    const readText = (paragraph) => normalizeOutlineText(safeCall(paragraph, "GetText", "", { NewLine: true, ParaSeparator: "\n", Numbering: true }));
    return candidate && expected && readText(candidate) === expected ? candidate : null;
  }

  function getLogicReferenceStyleName(item) {
    const paragraph = getLogicReferenceParagraph(item?.styleRef);
    const styleName = paragraph ? getLogicParagraphStyleName(paragraph, getLogicDocument()) : "";
    return item?.type === "body" && isSolutionHeadingStyleName(styleName) ? "" : styleName;
  }

  function findExistingLogicStyleName(logicDocument, candidates) {
    const styles = safeCall(logicDocument, "GetStyles", null) || safeCall(logicDocument, "Get_Styles", null);
    if (!styles) return "";
    for (const candidate of candidates) {
      try {
        if (safeCall(styles, "GetStyleIdByName", null, candidate, false)) return candidate;
      } catch {}
    }
    return candidates[0] || "";
  }

  function applyLogicParagraphStyle(logicDocument, item) {
    const styleName = getLogicReferenceStyleName(item)
      || findExistingLogicStyleName(logicDocument, getSolutionStyleCandidates(item));
    if (!styleName) return false;
    try {
      if (typeof logicDocument.SetParagraphStyle === "function") {
        logicDocument.SetParagraphStyle(styleName, true);
        return true;
      }
    } catch (error) {}
    return false;
  }

  function insertStructuredSolutionWritingTextFromLogic(paragraphs, fallbackText, replaceTarget) {
    if (replaceTarget) {
      return { ok: false, error: "定向替换只允许使用保存的精确标题位置，逻辑文档 fallback 已关闭。" };
    }
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return enterTextAtSelection(fallbackText, "solution-writing");
    }
    const logicDocument = getLogicDocument();
    if (!logicDocument || typeof logicDocument.EnterText !== "function") {
      return enterTextAtSelection(fallbackText, "solution-writing");
    }
    try {
      let textCount = 0;
      const styleResults = [];
      paragraphs.forEach((item, index) => {
        if (item.text) {
          logicDocument.EnterText(String(item.text));
          textCount += 1;
        }
        const styled = applyLogicParagraphStyle(logicDocument, item);
        styleResults.push({
          requested: item.styleName || item.style || "",
          reference: item.styleRef?.styleName || "",
          styleApplied: Boolean(styled),
        });
        if (index < paragraphs.length - 1 && typeof logicDocument.AddNewParagraph === "function") {
          logicDocument.AddNewParagraph(false, true);
        }
      });
      if (textCount === 0) return { ok: false, error: "方案规划没有可插入文本段落。" };
      safeCall(logicDocument, "Recalculate", null);
      safeCall(logicDocument, "UpdateInterface", null);
      safeCall(logicDocument, "UpdateSelection", null);
      saveOnlyOfficeDocument("solution-writing");
      return {
        ok: true,
        source: "logic-document-reference-style-enter-text",
        count: paragraphs.length,
        textCount,
        styles: styleResults,
      };
    } catch (error) {
      return { ok: false, error: error?.message || "方案规划段落插入失败" };
    }
  }

  async function insertStructuredSolutionWritingText(paragraphs, fallbackText, replaceTarget) {
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) return enterTextAtSelection(fallbackText, "solution-writing");
    if (!window.Asc?.Editor || typeof window.Asc.Editor.callCommand !== "function") {
      return insertStructuredSolutionWritingTextFromLogic(paragraphs, fallbackText, replaceTarget);
    }
    try {
      window.Asc.scope = window.Asc.scope || {};
      window.Asc.scope.gfSolutionWritingParagraphs = paragraphs;
      window.Asc.scope.gfSolutionWritingReplaceTarget = replaceTarget || null;
      window.Asc.scope.gfSolutionWritingResult = null;
      await window.Asc.Editor.callCommand(function () {
        function callAny(targets, names, args) {
          for (var targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
            var target = targets[targetIndex];
            if (!target) continue;
            for (var nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
              var name = names[nameIndex];
              try {
                if (typeof target[name] === "function") {
                  target[name].apply(target, args);
                  return true;
                }
              } catch (error) {}
            }
          }
          return false;
        }

        function getStyleCandidates(style) {
          var raw = String(style || "");
          var value = raw.toLowerCase();
          if (value.indexOf("word-style:") === 0) return [raw.slice("word-style:".length)];
          if (raw && !/^heading-\d$/.test(value) && value !== "body") return [raw];
          var headingMatch = value.match(/^heading-(\d)$/);
          if (headingMatch) {
            var level = headingMatch[1];
            return ["Heading " + level, "标题 " + level, "标题" + level, "heading " + level];
          }
          return ["正文", "Normal", "normal"];
        }

        function isSolutionHeadingStyleName(styleName) {
          return /heading\s*\d|标题\s*\d|标题\d/i.test(String(styleName || ""));
        }

        function getParagraphText(paragraph) {
          try {
            if (paragraph && typeof paragraph.GetText === "function") {
              return String(paragraph.GetText({ NewLine: true, ParaSeparator: "\n", Numbering: true }) || "").replace(/\s+/g, " ").trim();
            }
          } catch (error) {}
          return "";
        }

        function getFirstInsertText(rows) {
          for (var index = 0; index < rows.length; index += 1) {
            var text = normalizeText(rows[index] && rows[index].text);
            if (text) return text;
          }
          return "";
        }

        function getAllParagraphs(doc) {
          try {
            var direct = doc && typeof doc.GetAllParagraphs === "function" ? doc.GetAllParagraphs() : null;
            return Array.isArray(direct) ? direct : [];
          } catch (error) {
            return [];
          }
        }

        function normalizeText(value) {
          return String(value || "").replace(/\s+/g, " ").trim();
        }

        function getTargetTitle(target) {
          if (!target) return "";
          return normalizeText(target.title || (target.styleRef && (target.styleRef.title || target.styleRef.text)) || "");
        }

        function findTargetHeadingIndex(paragraphs, target) {
          if (!target || !paragraphs.length) return -1;
          var title = getTargetTitle(target);
          var ref = target.styleRef || null;
          var refIndex = Number(ref && ref.paragraphIndex);
          var expected = normalizeText(ref && (ref.title || ref.text) || title);
          var candidate = Number.isFinite(refIndex) ? paragraphs[refIndex] : null;
          return candidate && expected && getParagraphText(candidate) === expected ? refIndex : -1;
        }

        function getTargetBodyParagraphs(paragraphs, headingIndex, target) {
          if (!target || target.bodyParagraphCount === null || target.bodyParagraphCount === undefined) return null;
          var count = Number(target.bodyParagraphCount);
          if (!Number.isInteger(count) || count < 0) return null;
          var endIndex = headingIndex + 1 + count;
          return endIndex <= paragraphs.length ? paragraphs.slice(headingIndex + 1, endIndex) : null;
        }

        function clearTargetBodyParagraphs(paragraphs) {
          var cleared = 0;
          for (var index = paragraphs.length - 1; index >= 0; index -= 1) {
            var paragraph = paragraphs[index];
            if (!paragraph) return { ok: false, cleared: cleared, error: "目标正文段落引用无效" };
            var removed = false;
            try {
              if (typeof paragraph.Delete === "function" && paragraph.Delete() !== false) {
                removed = true;
              }
            } catch (error) {}
            if (!removed) {
              try {
                if (typeof paragraph.RemoveAllElements === "function" && paragraph.RemoveAllElements() !== false) removed = true;
              } catch (error) {}
            }
            if (!removed) return { ok: false, cleared: cleared, error: "目标正文清理失败" };
            cleared += 1;
          }
          return { ok: true, cleared: cleared };
        }

        function getDocumentContentIndex(paragraph, fallbackIndex) {
          try {
            var impl = paragraph && typeof paragraph.private_GetImpl === "function" ? paragraph.private_GetImpl() : null;
            var index = impl && typeof impl.GetIndex === "function" ? impl.GetIndex() : null;
            if (Number.isFinite(Number(index)) && Number(index) >= 0) return Number(index);
          } catch (error) {}
          return fallbackIndex;
        }

        function insertContentAfterHeading(doc, headingParagraph, fallbackIndex, content) {
          if (!content.length || typeof doc.AddElement !== "function") return { ok: false, inserted: 0, error: "OnlyOffice 标题后插入接口不可用" };
          var insertIndex = getDocumentContentIndex(headingParagraph, fallbackIndex);
          for (var index = 0; index < content.length; index += 1) {
            try {
              if (doc.AddElement(insertIndex + 1 + index, content[index]) === false) {
                return { ok: false, inserted: index, partial: index > 0, error: "OnlyOffice 标题后插入返回失败" };
              }
            } catch (error) {
              return { ok: false, inserted: index, partial: index > 0, error: error && error.message ? error.message : "OnlyOffice 标题后插入失败" };
            }
          }
          return { ok: true, inserted: content.length };
        }

        function verifyInsertedAfterHeading(doc, target, rows) {
          var expected = getFirstInsertText(rows);
          if (!expected) return false;
          var paragraphs = getAllParagraphs(doc);
          var headingIndex = findTargetHeadingIndex(paragraphs, target);
          if (headingIndex < 0) return false;
          var insertedParagraph = paragraphs[headingIndex + 1];
          return Boolean(insertedParagraph && getParagraphText(insertedParagraph) === expected);
        }

        function getReferenceParagraph(doc, item) {
          var ref = item && item.styleRef;
          if (!ref) return null;
          var paragraphs = getAllParagraphs(doc);
          var paragraphIndex = Number(ref.paragraphIndex);
          var expected = String(ref.title || ref.text || "").replace(/\s+/g, " ").trim();
          var candidate = Number.isFinite(paragraphIndex) ? paragraphs[paragraphIndex] : null;
          return candidate && expected && getParagraphText(candidate) === expected ? candidate : null;
        }

        function applyStyleObject(paragraph, style) {
          if (!style || !paragraph) return false;
          try {
            var paraPr = typeof paragraph.GetParaPr === "function" ? paragraph.GetParaPr() : null;
            if (paraPr && typeof paraPr.SetStyle === "function") {
              paraPr.SetStyle(style);
              return true;
            }
          } catch (error) {}
          try {
            if (typeof paragraph.SetStyle === "function") {
              paragraph.SetStyle(style);
              return true;
            }
          } catch (error) {}
          return false;
        }

        function applyReferenceStyle(doc, paragraph, item) {
          if (item && item.type === "body" && item.styleRef && isSolutionHeadingStyleName(item.styleRef.styleName)) return false;
          var reference = getReferenceParagraph(doc, item);
          if (!reference || typeof reference.GetParaPr !== "function") return false;
          try {
            var referencePr = reference.GetParaPr();
            var style = referencePr && typeof referencePr.GetStyle === "function" ? referencePr.GetStyle() : null;
            return applyStyleObject(paragraph, style);
          } catch (error) {
            return false;
          }
        }

        function getFormat(item) {
          var style = String(item.styleFallback || item.style || "");
          var headingMatch = style.match(/^heading-(\d)$/);
          if (headingMatch) {
            var headingLevel = Math.max(1, Math.min(6, Number(headingMatch[1]) || 1));
            if (headingLevel === 1) return { font: "小标宋", size: 22, bold: false, firstLine: 0, line: 32, before: 8, after: 6, outline: 0 };
            if (headingLevel === 2) return { font: "黑体", size: 16, bold: true, firstLine: 0, line: 28, before: 6, after: 4, outline: 1 };
            return { font: "楷体", size: 16, bold: true, firstLine: 0, line: 28, before: 4, after: 2, outline: headingLevel - 1 };
          }
          if (item.type === "blank") {
            return { font: "仿宋", size: 16, bold: false, firstLine: 0, line: 12, before: 0, after: 0 };
          }
          return { font: "仿宋", size: 16, bold: false, firstLine: 2, line: 28, before: 0, after: 0 };
        }

        function applyWordStyle(doc, paragraph, item) {
          if (applyReferenceStyle(doc, paragraph, item)) return true;
          if (!doc || typeof doc.GetStyle !== "function" || !paragraph) return false;
          var candidates = getStyleCandidates(item.style || "body");
          for (var index = 0; index < candidates.length; index += 1) {
            try {
              var style = doc.GetStyle(candidates[index]);
              if (style) {
                return applyStyleObject(paragraph, style);
              }
            } catch (error) {}
          }
          return false;
        }

        function applyParagraphFormat(paragraph, item) {
          var format = getFormat(item);
          var paragraphPr = typeof paragraph.GetParaPr === "function" ? paragraph.GetParaPr() : null;
          var textPr = typeof paragraph.GetTextPr === "function" ? paragraph.GetTextPr() : null;
          callAny([paragraphPr, paragraph], ["SetJc", "SetAlign"], ["left"]);
          callAny([paragraphPr, paragraph], ["SetIndFirstLine", "SetFirstLineIndent"], [Math.round((format.firstLine || 0) * (format.size || 16) * 20)]);
          callAny([paragraphPr, paragraph], ["SetSpacingLine"], [Math.round((format.line || 28) * 20), "exact"]);
          callAny([paragraphPr, paragraph], ["SetSpacingBefore"], [Math.round((format.before || 0) * 20)]);
          callAny([paragraphPr, paragraph], ["SetSpacingAfter"], [Math.round((format.after || 0) * 20)]);
          if (Number.isFinite(Number(format.outline))) {
            callAny([paragraphPr, paragraph], ["SetOutlineLvl", "SetOutlineLevel"], [Math.max(0, Math.min(8, Number(format.outline)))]);
          }
          callAny([paragraph, textPr], ["SetFontFamily", "SetFont"], [format.font]);
          callAny([paragraph, textPr], ["SetFontSize"], [Math.round((format.size || 16) * 2)]);
          callAny([paragraph, textPr], ["SetBold"], [Boolean(format.bold)]);
        }

        function applyRunFormat(run, item) {
          if (!run) return false;
          var format = getFormat(item);
          var applied = false;
          applied = callAny([run], ["SetFontFamily", "SetFont"], [format.font]) || applied;
          applied = callAny([run], ["SetFontSize"], [Math.round((format.size || 16) * 2)]) || applied;
          applied = callAny([run], ["SetBold"], [Boolean(format.bold)]) || applied;
          return applied;
        }

        function prepareCurrentInsertPosition(doc) {
          try {
            var anchorParagraph = Api.CreateParagraph();
            var result = doc.InsertContent([anchorParagraph]);
            return result === false
              ? { ok: false, inserted: false, error: "OnlyOffice 插入锚点返回失败" }
              : { ok: true, inserted: true };
          } catch (error) {
            return { ok: false, inserted: false, error: error && error.message ? error.message : "OnlyOffice 插入锚点失败" };
          }
        }

        var mutation = { anchorInserted: false, inserted: 0, cleared: 0 };
        try {
          var source = Asc.scope.gfSolutionWritingParagraphs || [];
          var doc = Api.GetDocument();
          if (!doc || typeof Api.CreateParagraph !== "function") {
            Asc.scope.gfSolutionWritingResult = { ok: false, error: "OnlyOffice 段落插入接口不可用" };
            return;
          }
          var content = [];
          var textCount = 0;
          var styleResults = [];
          for (var index = 0; index < source.length; index += 1) {
            var item = source[index] || {};
            if (!item.text && item.type !== "blank") continue;
            var paragraph = Api.CreateParagraph();
            var styleRequest = item.styleName || item.style || "";
            var styleItem = {};
            for (var key in item) {
              if (Object.prototype.hasOwnProperty.call(item, key)) styleItem[key] = item[key];
            }
            styleItem.style = styleRequest;
            var runFormatApplied = false;
            var run = null;
            if (item.text && typeof paragraph.AddText === "function") {
              run = paragraph.AddText(String(item.text));
              textCount += 1;
            }
            var styled = applyWordStyle(doc, paragraph, styleItem);
            if (!styled) {
              applyParagraphFormat(paragraph, item);
              runFormatApplied = applyRunFormat(run, item);
            }
            if (!styled) applyParagraphFormat(paragraph, item);
            styleResults.push({
              requested: styleRequest,
              fallback: item.styleFallback || "",
              styleApplied: Boolean(styled),
              runFormatApplied: Boolean(runFormatApplied),
            });
            content.push(paragraph);
          }
          if (textCount === 0) {
            Asc.scope.gfSolutionWritingResult = { ok: false, error: "方案规划没有可插入文本段落。" };
            return;
          }
          var replaceTarget = Asc.scope.gfSolutionWritingReplaceTarget || null;
          if (replaceTarget) {
            var allParagraphs = getAllParagraphs(doc);
            var headingIndex = findTargetHeadingIndex(allParagraphs, replaceTarget);
            if (headingIndex < 0) {
              Asc.scope.gfSolutionWritingResult = { ok: false, error: "保存的标题定位已失效：" + getTargetTitle(replaceTarget) };
              return;
            }
            var oldBodyParagraphs = getTargetBodyParagraphs(allParagraphs, headingIndex, replaceTarget);
            if (!oldBodyParagraphs) {
              Asc.scope.gfSolutionWritingResult = { ok: false, error: "保存的标题正文范围已失效：" + getTargetTitle(replaceTarget) };
              return;
            }
            var inserted = insertContentAfterHeading(doc, allParagraphs[headingIndex], headingIndex, content);
            mutation.inserted = inserted.inserted || 0;
            if (!inserted.ok) {
              Asc.scope.gfSolutionWritingResult = { ok: false, partial: Boolean(inserted.partial), inserted: mutation.inserted, error: inserted.error || "未能写入目标标题正文：" + getTargetTitle(replaceTarget) };
              return;
            }
            if (!verifyInsertedAfterHeading(doc, replaceTarget, source)) {
              Asc.scope.gfSolutionWritingResult = { ok: false, partial: true, inserted: mutation.inserted, error: "OnlyOffice 未确认正文写入目标标题：" + getTargetTitle(replaceTarget) };
              return;
            }
            var cleared = clearTargetBodyParagraphs(oldBodyParagraphs);
            mutation.cleared = cleared.cleared || 0;
            if (!cleared.ok) {
              Asc.scope.gfSolutionWritingResult = { ok: false, partial: true, inserted: mutation.inserted, cleared: mutation.cleared, error: cleared.error || "新正文已写入，但原正文未能完整清理" };
              return;
            }
            Asc.scope.gfSolutionWritingResult = {
              ok: true,
              source: "api-replace-heading-body",
              count: content.length,
              textCount: textCount,
              cleared: mutation.cleared,
              targetTitle: getTargetTitle(replaceTarget),
              styles: styleResults,
            };
            return;
          }
          var anchor = prepareCurrentInsertPosition(doc);
          mutation.anchorInserted = Boolean(anchor.inserted);
          if (!anchor.ok) {
            Asc.scope.gfSolutionWritingResult = { ok: false, error: anchor.error || "OnlyOffice 未能建立当前插入位置。" };
            return;
          }
          if (typeof doc.InsertContent !== "function") {
            Asc.scope.gfSolutionWritingResult = { ok: false, partial: true, error: "OnlyOffice 段落插入接口不可用" };
            return;
          }
          var insertResult = doc.InsertContent(content);
          if (insertResult === false) {
            Asc.scope.gfSolutionWritingResult = { ok: false, partial: true, error: "OnlyOffice 未确认方案规划段落插入。" };
            return;
          }
          mutation.inserted = content.length;
          Asc.scope.gfSolutionWritingResult = { ok: true, source: "api-insert-content-paragraphs", count: content.length, textCount: textCount, styles: styleResults };
        } catch (error) {
          Asc.scope.gfSolutionWritingResult = {
            ok: false,
            partial: mutation.anchorInserted || mutation.inserted > 0 || mutation.cleared > 0,
            inserted: mutation.inserted,
            cleared: mutation.cleared,
            error: error?.message || "方案规划段落插入失败",
          };
        }
      });
      const result = window.Asc.scope.gfSolutionWritingResult || { ok: false, error: "OnlyOffice 段落插入命令未返回结果。" };
      if (result.ok) {
        safeCall(getLogicDocument(), "Recalculate", null);
        safeCall(getLogicDocument(), "UpdateInterface", null);
        safeCall(getLogicDocument(), "UpdateSelection", null);
        saveOnlyOfficeDocument("solution-writing");
        return result;
      }
      return result;
    } catch (error) {
      return { ok: false, error: error?.message || "方案规划段落插入失败" };
    }
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
    return entered.ok
      ? { ...entered, removeResult: removed }
      : { ...entered, partial: true, cleared: true, removeResult: removed };
  }

  function fillBookmarkedField(field) {
    if (field?.clear === true) return clearBookmarkedField(field);
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

  async function postOutline(trigger, requestId) {
    const payload = { ...extractOnlyOfficeOutline(), trigger, requestId: requestId || "" };
    const [documentStyles, outlineStyles] = await Promise.all([
      readDocumentStylesForPost(),
      readOutlineStyleMetadataForPost(payload.items),
    ]);
    const stylesByIndex = new Map(outlineStyles.map(function (item) { return [Number(item.index), item]; }));
    payload.items = Array.isArray(payload.items)
      ? payload.items.map(function (item) {
        const styleInfo = stylesByIndex.get(Number(item.index)) || {};
        return { ...item, ...styleInfo };
      })
      : [];
    payload.documentStyles = documentStyles;
    payload.styleDebug = window.Asc?.scope?.gfOutlineStyleDebug || null;
    payload.documentText = String(window.Asc?.scope?.gfOutlineDocumentText || "").slice(0, 80000);
    try {
      console.log("[guangfa-onlyoffice-outline]", payload);
      if (payload.items && console.table) console.table(payload.items);
    } catch {}
    try {
      window.parent.postMessage({ source: "guangfa-onlyoffice-custom", action: "onlyoffice-outline-probe", outline: payload }, "*");
    } catch {}
    try {
      if (window.top && window.top !== window.parent) window.top.postMessage({ source: "guangfa-onlyoffice-custom", action: "onlyoffice-outline-probe", outline: payload }, "*");
    } catch {}
    return payload;
  }

  async function insertSolutionWritingText(payload) {
    const requestId = payload?.requestId || "";
    const text = String(payload?.text || "").trim();
    const paragraphs = normalizeSolutionWritingParagraphs(payload);
    const replaceTarget = normalizeSolutionReplaceTarget(payload?.replaceTarget);
    const result = text
      ? await insertStructuredSolutionWritingText(paragraphs, text, replaceTarget)
      : { ok: false, error: "方案正文为空" };
    const message = { source: "guangfa-onlyoffice-custom", action: "solution-writing-inserted", result: { ...result, requestId } };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
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

  function normalizeKnowledgeTableRows(table) {
    const sourceRows = Array.isArray(table?.rows) ? table.rows : [];
    const rows = sourceRows.map(function (row) {
      const cells = Array.isArray(row) ? row : [];
      const expanded = [];
      cells.forEach(function (cell) {
        const colSpan = Math.max(1, Number(cell?.colSpan || 1) || 1);
        expanded.push(String(cell?.text || ""));
        for (let index = 1; index < colSpan; index += 1) expanded.push("");
      });
      return expanded;
    }).filter(function (row) {
      return row.some(function (text) { return String(text || "").trim(); });
    });
    const columnCount = rows.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
    return rows.map(function (row) {
      const nextRow = row.slice();
      while (nextRow.length < columnCount) nextRow.push("");
      return nextRow;
    });
  }

  function writeKnowledgeTableCell(tableApi, rowIndex, columnIndex, text) {
    const cell = safeCall(tableApi, "GetCell", null, rowIndex, columnIndex);
    const content = safeCall(cell, "GetContent", null);
    const paragraph = safeCall(content, "GetElement", null, 0);
    if (!paragraph || typeof paragraph.AddText !== "function") return false;
    paragraph.AddText(String(text || ""));
    return true;
  }

  async function insertKnowledgeTable(data) {
    const requestId = data.requestId || "";
    if (requestId) {
      if (handledKnowledgeTableRequestIds.has(requestId)) return null;
      handledKnowledgeTableRequestIds.add(requestId);
      window.setTimeout(function () {
        handledKnowledgeTableRequestIds.delete(requestId);
      }, 120000);
    }
    try {
      const sourceDocxUrl = String(data.table?.sourceDocxUrl || data.table?.docxUrl || "");
      if (sourceDocxUrl) {
        const inserted = insertKnowledgeTableDocx(sourceDocxUrl, requestId);
        if (inserted.deferred) return inserted;
        if (inserted.ok) return postKnowledgeTableResult({ ...inserted, requestId });
        return postKnowledgeTableResult({ ...inserted, requestId });
      }

      const rows = normalizeKnowledgeTableRows(data.table || {});
      if (rows.length === 0 || rows[0].length === 0) {
        return postKnowledgeTableResult({ ok: false, requestId, error: "所选表格为空，无法插入。" });
      }
      if (window.Asc?.Editor && typeof window.Asc.Editor.callCommand === "function") {
        window.Asc.scope = window.Asc.scope || {};
        window.Asc.scope.gfKnowledgeTableRows = rows;
        window.Asc.scope.gfKnowledgeTableResult = null;
        await window.Asc.Editor.callCommand(function () {
          try {
            const commandRows = Asc.scope.gfKnowledgeTableRows || [];
            const doc = Api.GetDocument();
            const table = Api.CreateTable(commandRows.length, commandRows[0].length);
            table.SetWidth("percent", 100);
            commandRows.forEach(function (row, rowIndex) {
              row.forEach(function (text, columnIndex) {
                const cell = table.GetCell(rowIndex, columnIndex);
                const paragraph = cell?.GetContent?.()?.GetElement?.(0);
                if (paragraph && typeof paragraph.AddText === "function") paragraph.AddText(String(text || ""));
              });
            });
            doc.InsertContent([table]);
            Asc.scope.gfKnowledgeTableResult = { ok: true, source: "asc-editor-command" };
          } catch (error) {
            Asc.scope.gfKnowledgeTableResult = { ok: false, error: error?.message || "资料表格插入失败" };
          }
        });
        const commandResult = window.Asc.scope.gfKnowledgeTableResult || { ok: false, error: "OnlyOffice 表格插入命令未返回结果。" };
        if (!commandResult.ok) return postKnowledgeTableResult({ ...commandResult, requestId });
        saveOnlyOfficeDocument("insert-knowledge-table");
        return postKnowledgeTableResult({
          ...commandResult,
          requestId,
          rowCount: rows.length,
          columnCount: rows[0].length,
        });
      }
      const documentApi = getApiDocumentAny();
      const tableApiRoot = getTableApiRoot();
      if (!documentApi || !tableApiRoot) {
        return postKnowledgeTableResult({ ok: false, requestId, error: "OnlyOffice 表格接口不可用。" });
      }
      if (typeof documentApi.InsertContent !== "function") {
        return postKnowledgeTableResult({ ok: false, requestId, error: "OnlyOffice 当前光标插入接口不可用。" });
      }

      const tableApi = tableApiRoot.CreateTable(rows.length, rows[0].length);
      if (!tableApi) return postKnowledgeTableResult({ ok: false, requestId, error: "OnlyOffice 表格创建失败。" });
      safeCall(tableApi, "SetWidth", null, "percent", 100);
      rows.forEach(function (row, rowIndex) {
        row.forEach(function (text, columnIndex) {
          writeKnowledgeTableCell(tableApi, rowIndex, columnIndex, text);
        });
      });
      documentApi.InsertContent([tableApi]);
      safeCall(getLogicDocument(), "Recalculate", null);
      safeCall(getLogicDocument(), "UpdateInterface", null);
      safeCall(getLogicDocument(), "UpdateSelection", null);
      saveOnlyOfficeDocument("insert-knowledge-table");
      return postKnowledgeTableResult({
        ok: true,
        requestId,
        rowCount: rows.length,
        columnCount: rows[0].length,
        source: "api-create-table-insert-content",
      });
    } catch (error) {
      return postKnowledgeTableResult({ ok: false, requestId, error: error?.message || "资料表格插入失败" });
    }
  }

  function insertKnowledgeTableDocx(url, requestId) {
    const api = getEditorApi() || window.Asc?.editor || window.editor;
    if (!api) return { ok: false, error: "OnlyOffice 编辑器接口不可用。" };
    try {
      const Manager = window.AscCommonWord?.CInsertDocumentManager;
      if (typeof Manager === "function") {
        const manager = new Manager(api);
        const originalEndLongAction = manager.endLongAction?.bind(manager);
        let finished = false;
        manager.endLongAction = function () {
          try {
            originalEndLongAction?.();
          } finally {
            if (finished) return;
            finished = true;
            window.setTimeout(function () {
              saveOnlyOfficeDocument("insert-knowledge-table-docx");
              postKnowledgeTableResult({ ok: true, requestId, source: "insert-document-manager-url" });
            }, 300);
          }
        };
        manager.insertTextFromUrl(url);
        return { deferred: true };
      }
      if (typeof api.asc_insertTextFromUrl === "function") {
        api.asc_insertTextFromUrl(url);
        window.setTimeout(function () {
          saveOnlyOfficeDocument("insert-knowledge-table-docx");
          postKnowledgeTableResult({ ok: true, requestId, source: "asc-insert-text-from-url" });
        }, 1800);
        return { deferred: true };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "OnlyOffice DOCX 表格插入失败" };
    }
    return { ok: false, error: "OnlyOffice DOCX 插入接口不可用。" };
  }

  function postKnowledgeTableResult(result) {
    const message = { source: "guangfa-onlyoffice-custom", action: "knowledge-table-inserted", result };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
  }

  async function insertKnowledgeImage(data) {
    const requestId = data.requestId || "";
    if (requestId) {
      if (handledKnowledgeImageRequestIds.has(requestId)) return null;
      handledKnowledgeImageRequestIds.add(requestId);
      window.setTimeout(function () {
        handledKnowledgeImageRequestIds.delete(requestId);
      }, 120000);
    }
    try {
      const imageSource = String(data.image?.dataUrl || data.image?.base64 || data.image?.imageUrl || data.image?.fileUrl || data.image?.previewUrl || "");
      if (imageSource) {
        const insertedImage = await insertKnowledgeImageApi(data.image, requestId);
        if (insertedImage.ok || insertedImage.deferred) return insertedImage;
      }
      const sourceDocxUrl = String(data.image?.sourceDocxUrl || data.image?.docxUrl || "");
      if (!sourceDocxUrl) {
        return postKnowledgeImageResult({ ok: false, requestId, error: "所选图片缺少可插入图片地址。" });
      }
      const inserted = insertKnowledgeImageDocx(sourceDocxUrl, requestId);
      if (inserted.deferred) return inserted;
      return postKnowledgeImageResult({ ...inserted, requestId });
    } catch (error) {
      return postKnowledgeImageResult({ ok: false, requestId, error: error?.message || "资料图片插入失败" });
    }
  }

  async function insertKnowledgeImageApi(image, requestId) {
    const nativeInserted = await insertKnowledgeImageByNativeApi(image, requestId);
    if (nativeInserted.ok) return nativeInserted;
    if (!window.Asc?.Editor || typeof window.Asc.Editor.callCommand !== "function") return nativeInserted;
    try {
      window.Asc.scope = window.Asc.scope || {};
      window.Asc.scope.gfKnowledgeImagePayload = {
        url: String(image?.dataUrl || image?.base64 || image?.imageUrl || image?.fileUrl || image?.previewUrl || ""),
        widthEmu: Number(image?.widthEmu) || 0,
        heightEmu: Number(image?.heightEmu) || 0,
      };
      window.Asc.scope.gfKnowledgeImageResult = null;
      await window.Asc.Editor.callCommand(function () {
        function callAny(targets, names, args) {
          for (var targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
            var target = targets[targetIndex];
            if (!target) continue;
            for (var nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
              var name = names[nameIndex];
              try {
                if (typeof target[name] === "function") {
                  target[name].apply(target, args || []);
                  return true;
                }
              } catch (error) {}
            }
          }
          return false;
        }

        function clampImageSize(widthEmu, heightEmu) {
          var fallbackWidth = Math.round(5.8 * 914400);
          var fallbackHeight = Math.round(3.6 * 914400);
          var width = Number(widthEmu) > 0 ? Number(widthEmu) : fallbackWidth;
          var height = Number(heightEmu) > 0 ? Number(heightEmu) : fallbackHeight;
          var maxWidth = Math.round(6.4 * 914400);
          if (width > maxWidth) {
            var scale = maxWidth / width;
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          return { width: width, height: height };
        }

        try {
          var payload = Asc.scope.gfKnowledgeImagePayload || {};
          var imageUrl = String(payload.url || "");
          if (!imageUrl) {
            Asc.scope.gfKnowledgeImageResult = { ok: false, error: "图片地址为空。" };
            return;
          }
          var doc = Api.GetDocument();
          if (!doc || typeof doc.InsertContent !== "function" || typeof Api.CreateImage !== "function") {
            Asc.scope.gfKnowledgeImageResult = { ok: false, error: "OnlyOffice 图片创建接口不可用。" };
            return;
          }
          var size = clampImageSize(payload.widthEmu, payload.heightEmu);
          var drawing = Api.CreateImage(imageUrl, size.width, size.height);
          if (!drawing) {
            Asc.scope.gfKnowledgeImageResult = { ok: false, error: "OnlyOffice 未创建图片对象。" };
            return;
          }
          var paragraph = typeof Api.CreateParagraph === "function" ? Api.CreateParagraph() : null;
          var inserted = false;
          if (paragraph) {
            inserted = callAny([paragraph], ["AddDrawing", "AddElement"], [drawing]);
            if (inserted) {
              var result = doc.InsertContent([paragraph]);
              if (result !== false) {
                Asc.scope.gfKnowledgeImageResult = { ok: true, source: "api-create-image-paragraph", widthEmu: size.width, heightEmu: size.height };
                return;
              }
            }
          }
          var direct = doc.InsertContent([drawing]);
          if (direct !== false) {
            Asc.scope.gfKnowledgeImageResult = { ok: true, source: "api-create-image-direct", widthEmu: size.width, heightEmu: size.height };
            return;
          }
          Asc.scope.gfKnowledgeImageResult = { ok: false, error: "OnlyOffice 未确认图片插入。" };
        } catch (error) {
          Asc.scope.gfKnowledgeImageResult = { ok: false, error: error && error.message ? error.message : "图片 API 插入失败" };
        }
      });
      const result = window.Asc.scope.gfKnowledgeImageResult || { ok: false, error: "OnlyOffice 图片命令未返回结果。" };
      if (result.ok) {
        safeCall(getLogicDocument(), "Recalculate", null);
        safeCall(getLogicDocument(), "UpdateInterface", null);
        safeCall(getLogicDocument(), "UpdateSelection", null);
        saveOnlyOfficeDocument("insert-knowledge-image-api");
        return postKnowledgeImageResult({ ...result, requestId });
      }
      return result;
    } catch (error) {
      return { ok: false, error: error?.message || "OnlyOffice 图片 API 插入失败" };
    }
  }

  async function insertKnowledgeImageByNativeApi(image, requestId) {
    const api = getEditorApi() || window.Asc?.editor || window.editor;
    const imageSource = String(image?.dataUrl || image?.base64 || image?.imageUrl || image?.fileUrl || image?.previewUrl || "");
    if (!api || typeof api.AddImageUrl !== "function") {
      return { ok: false, error: "OnlyOffice 原生图片插入接口不可用。" };
    }
    if (!imageSource) return { ok: false, error: "图片地址为空。" };
    try {
      api.AddImageUrl([imageSource], undefined, undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      safeCall(getLogicDocument(), "Recalculate", null);
      safeCall(getLogicDocument(), "UpdateInterface", null);
      safeCall(getLogicDocument(), "UpdateSelection", null);
      saveOnlyOfficeDocument("insert-knowledge-image-native");
      return postKnowledgeImageResult({ ok: true, requestId, source: "native-add-image-url" });
    } catch (error) {
      return { ok: false, error: error?.message || "OnlyOffice 原生图片插入失败" };
    }
  }

  function insertKnowledgeImageDocx(url, requestId) {
    const api = getEditorApi() || window.Asc?.editor || window.editor;
    if (!api) return { ok: false, error: "OnlyOffice 编辑器接口不可用。" };
    try {
      const Manager = window.AscCommonWord?.CInsertDocumentManager;
      if (typeof Manager === "function") {
        const manager = new Manager(api);
        const originalEndLongAction = manager.endLongAction?.bind(manager);
        let finished = false;
        manager.endLongAction = function () {
          try {
            originalEndLongAction?.();
          } finally {
            if (finished) return;
            finished = true;
            window.setTimeout(function () {
              saveOnlyOfficeDocument("insert-knowledge-image-docx");
              postKnowledgeImageResult({ ok: true, requestId, source: "insert-document-manager-url" });
            }, 300);
          }
        };
        manager.insertTextFromUrl(url);
        return { deferred: true };
      }
      if (typeof api.asc_insertTextFromUrl === "function") {
        api.asc_insertTextFromUrl(url);
        window.setTimeout(function () {
          saveOnlyOfficeDocument("insert-knowledge-image-docx");
          postKnowledgeImageResult({ ok: true, requestId, source: "asc-insert-text-from-url" });
        }, 1800);
        return { deferred: true };
      }
    } catch (error) {
      return { ok: false, error: error?.message || "OnlyOffice DOCX 图片插入失败" };
    }
    return { ok: false, error: "OnlyOffice DOCX 插入接口不可用。" };
  }

  function postKnowledgeImageResult(result) {
    const message = { source: "guangfa-onlyoffice-custom", action: "knowledge-image-inserted", result };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
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
    if (data.source === "guangfa-parent" && data.action === "request-outline") {
      postOutline("request", data.requestId);
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
    if (data.source === "guangfa-parent" && data.action === "insert-knowledge-table") {
      insertKnowledgeTable(data);
    }
    if (data.source === "guangfa-parent" && data.action === "insert-knowledge-image") {
      insertKnowledgeImage(data);
    }
    if (data.source === "guangfa-parent" && data.action === "insert-solution-writing-text") {
      insertSolutionWritingText(data);
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

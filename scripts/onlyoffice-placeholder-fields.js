(function () {
  const defaultDefinitions = [
    { key: "projectName", label: "项目名称", token: "{{项目名称}}" },
  ];
  let placeholderDefinitions = defaultDefinitions;

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

  function getSelectionPage(selectionState) {
    const docState = Array.isArray(selectionState) ? selectionState[selectionState.length - 1] : null;
    const rawPage = Number(docState?.CurPage);
    if (Number.isFinite(rawPage)) return Math.max(1, rawPage + 1);
    const api = getEditorApi();
    const page = Number(api?.WordControl?.m_oDrawingDocument?.m_lCurrentPage);
    return Number.isFinite(page) ? Math.max(1, page + 1) : 1;
  }

  function createSearchSettings(text) {
    const CSearchSettings = window.AscCommon?.CSearchSettings;
    if (typeof CSearchSettings !== "function") return null;
    const settings = new CSearchSettings();
    safeCall(settings, "put_Text", null, text);
    safeCall(settings, "put_MatchCase", null, true);
    safeCall(settings, "put_WholeWords", null, false);
    return settings;
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

  function getBookmarkManager() {
    const logicDocument = getLogicDocument();
    return logicDocument && typeof logicDocument.GetBookmarksManager === "function" ? logicDocument.GetBookmarksManager() : null;
  }

  function cleanupPlaceholderBookmarks(definitions) {
    const manager = getBookmarkManager();
    if (!manager || typeof manager.RemoveBookmark !== "function") return;
    definitions.forEach(function (definition) {
      for (let index = 1; index <= 200; index += 1) {
        try { manager.RemoveBookmark(buildBookmarkName(definition.key, index)); } catch {}
      }
    });
  }

  function buildBookmarkName(key, index) {
    return "GF_PH_" + String(key || "placeholder").replace(/[^A-Za-z0-9_]/g, "_") + "_" + String(index).padStart(3, "0");
  }

  function detectPlaceholderFields(definitions = placeholderDefinitions) {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    const manager = getBookmarkManager();
    if (!api || typeof api.asc_findText !== "function") return postResult({ ok: false, error: "OnlyOffice 搜索接口不可用", anchors: [] });
    if (!logicDocument || !manager || typeof manager.AddBookmark !== "function") return postResult({ ok: false, error: "OnlyOffice 书签接口不可用", anchors: [] });

    const anchors = [];
    cleanupPlaceholderBookmarks(definitions);
    definitions.forEach(function (definition) {
      const settings = createSearchSettings(definition.token);
      if (!settings) return;
      let hitIndex = 0;
      try {
        if (typeof api.asc_endFindText === "function") api.asc_endFindText();
        moveSearchCursorToStart();
        const count = Number(api.asc_findText(settings, true)) || 0;
        const max = Math.min(Math.max(count, 0), 200);
        for (let index = 0; index < max; index += 1) {
          const selectedText = normalizeSelectionText(readSelectedText(logicDocument) || readSelectedText(api));
          if (selectedText === definition.token) {
            hitIndex += 1;
            const bookmarkName = buildBookmarkName(definition.key, hitIndex);
            const selectionState = safeCall(logicDocument, "GetSelectionState", null);
            try { manager.RemoveBookmark(bookmarkName); } catch {}
            manager.AddBookmark(bookmarkName);
            const page = getSelectionPage(selectionState);
            anchors.push({
              key: definition.key,
              label: definition.label,
              token: definition.token,
              bookmarkName,
              page,
              index: hitIndex,
              documentOrder: page * 1000000 + anchors.length + 1,
            });
          }
          if (index < max - 1) api.asc_findText(settings, true);
        }
      } catch (error) {
        console.warn("[guangfa-placeholder-detect]", definition.token, error?.message || error);
      } finally {
        try { if (typeof api.asc_endFindText === "function") api.asc_endFindText(); } catch {}
      }
    });
    try { if (typeof api.asc_Save === "function") api.asc_Save(false); } catch {}
    return postResult({ ok: true, anchors });
  }

  function postResult(result) {
    const message = { source: "guangfa-onlyoffice-custom", action: "placeholder-anchors-detected", result };
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
    return result;
  }

  window.guangfaSetPlaceholderDefinitions = function (definitions) {
    if (Array.isArray(definitions) && definitions.length > 0) placeholderDefinitions = definitions;
  };
  window.guangfaDetectPlaceholderFields = function () {
    return detectPlaceholderFields(placeholderDefinitions);
  };

  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.source === "guangfa-parent" && data.action === "sync-placeholder-definitions") {
      window.guangfaSetPlaceholderDefinitions(data.definitions);
    }
    if (data.source === "guangfa-parent" && data.action === "detect-placeholder-fields") {
      detectPlaceholderFields(placeholderDefinitions);
    }
  });
})();

(function () {
  const twipsPerMm = 56.692913;
  const twipsPerPt = 20;

  function safeCall(target, name, fallback, ...args) {
    try {
      return target && typeof target[name] === "function" ? target[name](...args) : fallback;
    } catch {
      return fallback;
    }
  }

  function getEditorApi() {
    try {
      const app = window.DE && typeof window.DE.getController === "function" ? window.DE : null;
      const navigation = app && typeof app.getController === "function" ? app.getController("Navigation") : null;
      return navigation?.api || window.Asc?.editor || window.editor || null;
    } catch {
      return window.Asc?.editor || window.editor || null;
    }
  }

  function getApiDocument() {
    const attempts = [
      () => window.Api?.GetDocument?.(),
      () => window.AscBuilder?.Api?.GetDocument?.(),
      () => window.AscBuilder?.Word?.Api?.GetDocument?.(),
    ];
    for (const attempt of attempts) {
      try {
        const documentApi = attempt();
        if (documentApi) return documentApi;
      } catch {}
    }
    return null;
  }

  function getLogicDocument() {
    const api = getEditorApi();
    return api?.WordControl?.m_oLogicDocument || window.Asc?.editor?.WordControl?.m_oLogicDocument || null;
  }

  function getParagraphs(documentApi) {
    const direct = safeCall(documentApi, "GetAllParagraphs", null);
    if (Array.isArray(direct)) return direct;

    const paragraphs = [];
    const count = Number(safeCall(documentApi, "GetElementsCount", 0)) || 0;
    for (let index = 0; index < count; index += 1) {
      const element = safeCall(documentApi, "GetElement", null, index);
      collectParagraphs(element, paragraphs);
    }
    return paragraphs;
  }

  function collectParagraphs(element, paragraphs) {
    if (!element) return;
    const className = String(element.constructor?.name || "");
    if (/Paragraph/i.test(className) || typeof element.SetJc === "function" || typeof element.GetText === "function") {
      paragraphs.push(element);
    }
    const count = Number(safeCall(element, "GetElementsCount", 0)) || 0;
    for (let index = 0; index < count; index += 1) {
      collectParagraphs(safeCall(element, "GetElement", null, index), paragraphs);
    }
  }

  function getParagraphText(paragraph) {
    const text = safeCall(paragraph, "GetText", "");
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function applyLayoutPlan(plan) {
    const documentApi = getApiDocument();
    if (!documentApi) return { ok: false, summary: "OnlyOffice 文档 API 不可用。", items: [] };

    const paragraphs = getParagraphs(documentApi);
    const actions = Array.isArray(plan?.actions) ? plan.actions : [];
    const items = actions.map((action) => applyAction(documentApi, paragraphs, action));
    refreshDocument();
    return {
      ok: items.every((item) => item.ok || item.skipped),
      summary: `已执行 ${items.filter((item) => item.ok).length}/${items.length} 项排版动作。`,
      items,
    };
  }

  function applyAction(documentApi, paragraphs, action) {
    if (action.id === "page") return applyPageLayout(documentApi, action);
    if (action.id === "body") return applyBodyLayout(paragraphs, action);
    if (action.id === "headings") return applyHeadingLayout(paragraphs, action);
    if (action.id === "signature") return applySignatureLayout(paragraphs, action);
    return { id: action.id, title: action.title, ok: true, skipped: true, message: "未识别的排版动作，已跳过。" };
  }

  function applyPageLayout(documentApi, action) {
    const sections = getSections(documentApi);
    if (sections.length === 0) {
      return { id: action.id, title: action.title, ok: true, skipped: true, message: "未获取到页面节信息，已跳过页面设置。" };
    }
    const margins = action.payload?.marginsMm || {};
    const pageSize = action.payload?.pageSize || {};
    let changed = 0;
    sections.forEach((section) => {
      const marginArgs = [margins.left, margins.top, margins.right, margins.bottom].map(mmToTwips);
      const sizeArgs = [pageSize.widthMm, pageSize.heightMm].map(mmToTwips);
      const marginOk = callAny(section, ["SetPageMargins", "SetMargins"], marginArgs);
      const sizeOk = callAny(section, ["SetPageSize"], sizeArgs);
      if (marginOk || sizeOk) changed += 1;
    });
    return { id: action.id, title: action.title, ok: changed > 0, message: changed > 0 ? `已处理 ${changed} 个页面节。` : "OnlyOffice 页面设置接口不可用。" };
  }

  function getSections(documentApi) {
    const direct = safeCall(documentApi, "GetSections", null);
    if (Array.isArray(direct)) return direct;
    const current = safeCall(documentApi, "GetCurrentSection", null) || safeCall(documentApi, "GetFinalSection", null);
    return current ? [current] : [];
  }

  function applyBodyLayout(paragraphs, action) {
    let changed = 0;
    paragraphs.forEach((paragraph, index) => {
      const text = getParagraphText(paragraph);
      if (!text || isLikelyDocumentTitle(text, index) || isHeadingText(text)) return;
      applyParagraphFormat(paragraph, action.payload);
      changed += 1;
    });
    return { id: action.id, title: action.title, ok: changed > 0, message: `已处理 ${changed} 个正文段落。` };
  }

  function applyHeadingLayout(paragraphs, action) {
    let changed = 0;
    const titleParagraph = paragraphs.find((paragraph, index) => isLikelyDocumentTitle(getParagraphText(paragraph), index));
    if (titleParagraph) {
      applyParagraphFormat(titleParagraph, action.payload?.documentTitle || {});
      changed += 1;
    }
    const levels = Array.isArray(action.payload?.levels) ? action.payload.levels : [];
    paragraphs.forEach((paragraph) => {
      const text = getParagraphText(paragraph);
      const level = levels.find((item) => new RegExp(item.pattern).test(text));
      if (!level) return;
      applyParagraphFormat(paragraph, { ...level, firstLineChars: 0 });
      changed += 1;
    });
    return { id: action.id, title: action.title, ok: changed > 0, message: changed > 0 ? `已处理 ${changed} 个标题段落。` : "未识别到标题段落。" };
  }

  function applySignatureLayout(paragraphs, action) {
    let changed = 0;
    paragraphs.forEach((paragraph) => {
      const text = getParagraphText(paragraph);
      if (!isLikelySignature(text)) return;
      applyParagraphFormat(paragraph, action.payload);
      changed += 1;
    });
    return { id: action.id, title: action.title, ok: true, skipped: changed === 0, message: changed > 0 ? `已处理 ${changed} 个落款/日期段落。` : "未识别到落款或日期，已跳过。" };
  }

  function applyParagraphFormat(paragraph, format) {
    const paragraphPr = safeCall(paragraph, "GetParaPr", null);
    const alignment = normalizeAlignment(format.alignment);
    if (alignment) callAnyTarget([paragraphPr, paragraph], ["SetJc", "SetAlign"], [alignment]);
    if (Number.isFinite(Number(format.firstLineChars))) {
      callAnyTarget([paragraphPr, paragraph], ["SetIndFirstLine", "SetFirstLineIndent"], [charsToTwips(format.firstLineChars, format.fontSizePt || 16)]);
    }
    if (Number.isFinite(Number(format.lineSpacingPt))) {
      callAnyTarget([paragraphPr, paragraph], ["SetSpacingLine"], [ptToTwips(format.lineSpacingPt), "exact"]);
    }
    if (Number.isFinite(Number(format.beforePt))) callAnyTarget([paragraphPr, paragraph], ["SetSpacingBefore"], [ptToTwips(format.beforePt)]);
    if (Number.isFinite(Number(format.afterPt))) callAnyTarget([paragraphPr, paragraph], ["SetSpacingAfter"], [ptToTwips(format.afterPt)]);
    applyTextFormat(paragraph, format);
  }

  function applyTextFormat(paragraph, format) {
    const fonts = [format.fontFamily, ...(Array.isArray(format.fallbackFonts) ? format.fallbackFonts : [])].filter(Boolean);
    const fontSize = ptToHalfPoints(format.fontSizePt);
    const targets = collectTextTargets(paragraph);
    targets.forEach((target) => {
      const textPr = safeCall(target, "GetTextPr", null);
      fonts.some((font) => callAnyTarget([target, textPr], ["SetFontFamily", "SetFont"], [font]));
      if (Number.isFinite(fontSize)) callAnyTarget([target, textPr], ["SetFontSize"], [fontSize]);
      if (typeof format.bold === "boolean") callAnyTarget([target, textPr], ["SetBold"], [format.bold]);
    });
  }

  function collectTextTargets(paragraph) {
    const targets = [paragraph];
    const count = Number(safeCall(paragraph, "GetElementsCount", 0)) || 0;
    for (let index = 0; index < count; index += 1) {
      const child = safeCall(paragraph, "GetElement", null, index);
      if (child) targets.push(child);
    }
    return targets;
  }

  function isLikelyDocumentTitle(text, index) {
    return index < 8 && text.length >= 6 && text.length <= 80 && !/[：:。；;]/.test(text) && !/^(附件|主送|抄送|印发|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[．.、])/.test(text);
  }

  function isHeadingText(text) {
    return /^([一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|[0-9]+[．.、]|（[0-9]+）)/.test(text);
  }

  function isLikelySignature(text) {
    if (!text || text.length > 40) return false;
    return /([0-9〇零一二三四五六七八九十]{4}\s*年\s*[0-9一二三四五六七八九十]{1,2}\s*月\s*[0-9一二三四五六七八九十]{1,3}\s*日)$/.test(text)
      || /(委员会|办公室|人民政府|公司|单位)$/.test(text);
  }

  function normalizeAlignment(value) {
    if (value === "center") return "center";
    if (value === "right") return "right";
    if (value === "left") return "left";
    return "";
  }

  function callAny(target, names, args) {
    return names.some((name) => {
      try {
        if (target && typeof target[name] === "function") {
          target[name](...args);
          return true;
        }
      } catch {}
      return false;
    });
  }

  function callAnyTarget(targets, names, args) {
    return targets.some((target) => callAny(target, names, args));
  }

  function mmToTwips(value) {
    return Math.round(Number(value || 0) * twipsPerMm);
  }

  function ptToTwips(value) {
    return Math.round(Number(value || 0) * twipsPerPt);
  }

  function ptToHalfPoints(value) {
    return Math.round(Number(value || 0) * 2);
  }

  function charsToTwips(chars, fontSizePt) {
    return Math.round(Number(chars || 0) * Number(fontSizePt || 16) * twipsPerPt);
  }

  function refreshDocument() {
    const api = getEditorApi();
    const logicDocument = getLogicDocument();
    safeCall(logicDocument, "Recalculate", null);
    safeCall(logicDocument, "UpdateInterface", null);
    safeCall(logicDocument, "UpdateSelection", null);
    if (api && typeof api.asc_Save === "function") window.setTimeout(() => api.asc_Save(false), 120);
  }

  window.guangfaApplyLayoutFormat = applyLayoutPlan;

  function postLayoutResult(result) {
    const message = { source: "guangfa-onlyoffice-custom", action: "layout-format-applied", result };
    try { console.log("[guangfa-layout-format]", result); } catch {}
    try { window.parent?.postMessage(message, "*"); } catch {}
    try { if (window.top && window.top !== window.parent) window.top.postMessage(message, "*"); } catch {}
  }

  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.source !== "guangfa-parent" || data.action !== "apply-layout-format") return;
    const requestId = data.requestId || "";
    let result;
    try {
      result = applyLayoutPlan(data.plan || {});
    } catch (error) {
      result = { ok: false, summary: error?.message || "OnlyOffice 排版执行失败。", items: [] };
    }
    postLayoutResult({ ...result, requestId });
  });
})();

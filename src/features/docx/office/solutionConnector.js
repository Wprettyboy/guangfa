import { callOnlyOfficeConnectorCommand } from "./connector.js";

function insertSolutionWritingWithConnector({ text, paragraphs, requestId, timeoutMs, replaceTarget }) {
  const rows = Array.isArray(paragraphs) ? paragraphs : [];
  if (!rows.length) return Promise.resolve({ ok: false, skipped: true, source: "connector", reason: "empty-paragraphs" });
  const payload = JSON.stringify({
    requestId: requestId || "",
    text: String(text || ""),
    paragraphs: rows,
    replaceTarget: normalizeReplaceTarget(replaceTarget),
  });
  const command = new Function(`
    var payload = ${payload};
    function normalizeText(value) {
      return String(value || "").replace(/\\s+/g, " ").trim();
    }
    function callWithArgs(target, name, args) {
      try {
        if (target && typeof target[name] === "function") return target[name].apply(target, args || []);
      } catch (error) {}
      return null;
    }
    function getParagraphText(paragraph) {
      return normalizeText(
        callWithArgs(paragraph, "GetText", [{ NewLine: true, ParaSeparator: "\\n", Numbering: true }])
        || callWithArgs(paragraph, "GetText", [])
      );
    }
    function getAllParagraphs(doc) {
      var direct = callWithArgs(doc, "GetAllParagraphs", []);
      if (Array.isArray(direct)) return direct;
      return [];
    }
    function getReferenceParagraph(doc, item) {
      var ref = item && item.styleRef;
      if (!ref) return null;
      var paragraphs = getAllParagraphs(doc);
      var paragraphIndex = Number(ref.paragraphIndex);
      var expected = normalizeText(ref.title || ref.text || "");
      var candidate = Number.isFinite(paragraphIndex) ? paragraphs[paragraphIndex] : null;
      if (candidate && (!expected || getParagraphText(candidate) === expected)) return candidate;
      if (!expected) return null;
      for (var index = 0; index < paragraphs.length; index += 1) {
        if (getParagraphText(paragraphs[index]) === expected) return paragraphs[index];
      }
      return null;
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
    function getStyleCandidates(item) {
      var candidates = [];
      if (item.styleName) candidates.push(item.styleName);
      var raw = String(item.style || "");
      if (raw.indexOf("word-style:") === 0) candidates.push(raw.slice("word-style:".length));
      if (item.styleFallback) candidates.push(item.styleFallback);
      return candidates.filter(function (value, index, source) {
        return value && source.indexOf(value) === index;
      });
    }
    function isSolutionHeadingStyleName(styleName) {
      return /heading\\s*\\d|标题\\s*\\d|标题\\d/i.test(String(styleName || ""));
    }
    function getParagraphStyleName(paragraph) {
      try {
        var paragraphPr = typeof paragraph.GetParaPr === "function" ? paragraph.GetParaPr() : null;
        var style = paragraphPr && typeof paragraphPr.GetStyle === "function" ? paragraphPr.GetStyle() : null;
        return style && typeof style.GetName === "function" ? style.GetName() : "";
      } catch (error) {
        return "";
      }
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
      if (Number.isFinite(refIndex) && paragraphs[refIndex]) {
        var expected = normalizeText(ref.title || ref.text || title);
        var candidate = normalizeText(getParagraphText(paragraphs[refIndex]));
        if (!expected || candidate === expected || candidate === title) return refIndex;
      }
      if (!title) return -1;
      for (var index = 0; index < paragraphs.length; index += 1) {
        if (normalizeText(getParagraphText(paragraphs[index])) === title) return index;
      }
      return -1;
    }
    function findNextHeadingIndex(paragraphs, headingIndex) {
      for (var index = headingIndex + 1; index < paragraphs.length; index += 1) {
        if (isSolutionHeadingStyleName(getParagraphStyleName(paragraphs[index]))) return index;
      }
      return paragraphs.length;
    }
    function clearTargetBodyParagraphs(paragraphs, headingIndex, nextHeadingIndex) {
      var cleared = 0;
      for (var index = nextHeadingIndex - 1; index > headingIndex; index -= 1) {
        var paragraph = paragraphs[index];
        if (!paragraph || isSolutionHeadingStyleName(getParagraphStyleName(paragraph))) continue;
        try {
          if (typeof paragraph.Delete === "function" && paragraph.Delete() !== false) {
            cleared += 1;
            continue;
          }
        } catch (error) {}
        try {
          if (typeof paragraph.RemoveAllElements === "function" && paragraph.RemoveAllElements() !== false) cleared += 1;
        } catch (error) {}
      }
      return cleared;
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
      if (!content.length || typeof doc.AddElement !== "function") return false;
      var insertIndex = getDocumentContentIndex(headingParagraph, fallbackIndex);
      for (var index = 0; index < content.length; index += 1) {
        if (doc.AddElement(insertIndex + 1 + index, content[index]) === false) return false;
      }
      return true;
    }
    function applyWordStyle(doc, paragraph, item) {
      if (item && item.type === "body" && item.styleRef && isSolutionHeadingStyleName(item.styleRef.styleName)) {
        item = {
          type: item.type,
          style: item.style,
          styleName: item.styleName,
          styleFallback: item.styleFallback,
        };
      }
      if (applyReferenceStyle(doc, paragraph, item)) return true;
      if (!doc || typeof doc.GetStyle !== "function" || !paragraph) return false;
      var candidates = getStyleCandidates(item);
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
    try {
      var doc = Api.GetDocument();
      var content = [];
      var rows = Array.isArray(payload.paragraphs) ? payload.paragraphs : [];
      for (var index = 0; index < rows.length; index += 1) {
        var item = rows[index] || {};
        if (!item.text && item.type !== "blank") continue;
        var paragraph = Api.CreateParagraph();
        if (item.text) paragraph.AddText(String(item.text));
        applyWordStyle(doc, paragraph, item);
        content.push(paragraph);
      }
      if (!content.length) return { ok: false, source: "connector", requestId: payload.requestId, error: "方案正文为空" };
      var replaceTarget = payload.replaceTarget || null;
      if (replaceTarget) {
        var allParagraphs = getAllParagraphs(doc);
        var headingIndex = findTargetHeadingIndex(allParagraphs, replaceTarget);
        if (headingIndex < 0) return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: "未找到对应原模板标题：" + getTargetTitle(replaceTarget) };
        var nextHeadingIndex = findNextHeadingIndex(allParagraphs, headingIndex);
        var cleared = clearTargetBodyParagraphs(allParagraphs, headingIndex, nextHeadingIndex);
        if (!insertContentAfterHeading(doc, allParagraphs[headingIndex], headingIndex, content)) {
          return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: "未能写入目标标题正文：" + getTargetTitle(replaceTarget) };
        }
        return { ok: true, source: "connector-replace-heading-body", requestId: payload.requestId, count: content.length, cleared: cleared, targetTitle: getTargetTitle(replaceTarget) };
      }
      doc.InsertContent(content);
      return { ok: true, source: "connector-callCommand", requestId: payload.requestId, count: content.length };
    } catch (error) {
      return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: error && error.message ? error.message : "Connector 写入失败" };
    }
  `);
  return callOnlyOfficeConnectorCommand(command, { timeoutMs });
}

function normalizeReplaceTarget(target) {
  if (!target || typeof target !== "object") return null;
  const title = String(target.title || "").trim();
  const styleRef = normalizeStyleRef(target.styleRef);
  const bodyStyleRef = normalizeStyleRef(target.bodyStyleRef);
  return title || styleRef
    ? {
      title,
      headingPath: Array.isArray(target.headingPath) ? target.headingPath.map((item) => String(item || "").trim()).filter(Boolean) : [],
      styleRef,
      bodyStyleRef,
      bodyParagraphCount: Number.isFinite(Number(target.bodyParagraphCount)) ? Math.max(0, Number(target.bodyParagraphCount)) : 0,
    }
    : null;
}

function normalizeStyleRef(ref) {
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

export {
  insertSolutionWritingWithConnector,
};

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
    function prepareCurrentInsertPosition(doc) {
      if (!doc || typeof doc.InsertContent !== "function" || typeof Api.CreateParagraph !== "function") return { ok: false, inserted: false };
      try {
        var anchor = Api.CreateParagraph();
        var result = doc.InsertContent([anchor]);
        return result === false
          ? { ok: false, inserted: false, error: "OnlyOffice 插入锚点返回失败" }
          : { ok: true, inserted: true };
      } catch (error) {
        return { ok: false, inserted: false, error: error && error.message ? error.message : "OnlyOffice 插入锚点失败" };
      }
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
    var mutation = { anchorInserted: false, inserted: 0, cleared: 0 };
    try {
      var doc = Api.GetDocument();
      if (!doc || typeof Api.CreateParagraph !== "function") {
        return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: "OnlyOffice 段落接口不可用" };
      }
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
        if (headingIndex < 0) return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: "保存的标题定位已失效：" + getTargetTitle(replaceTarget) };
        var oldBodyParagraphs = getTargetBodyParagraphs(allParagraphs, headingIndex, replaceTarget);
        if (!oldBodyParagraphs) {
          return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: "保存的标题正文范围已失效：" + getTargetTitle(replaceTarget) };
        }
        var inserted = insertContentAfterHeading(doc, allParagraphs[headingIndex], headingIndex, content);
        mutation.inserted = inserted.inserted || 0;
        if (!inserted.ok) {
          return { ok: false, partial: Boolean(inserted.partial), source: "connector-callCommand", requestId: payload.requestId, inserted: mutation.inserted, error: inserted.error || "未能写入目标标题正文：" + getTargetTitle(replaceTarget) };
        }
        var cleared = clearTargetBodyParagraphs(oldBodyParagraphs);
        mutation.cleared = cleared.cleared || 0;
        if (!cleared.ok) {
          return { ok: false, partial: true, source: "connector-callCommand", requestId: payload.requestId, inserted: mutation.inserted, cleared: mutation.cleared, error: cleared.error || "新正文已写入，但原正文未能完整清理" };
        }
        return { ok: true, source: "connector-replace-heading-body", requestId: payload.requestId, count: content.length, cleared: mutation.cleared, targetTitle: getTargetTitle(replaceTarget) };
      }
      var anchor = prepareCurrentInsertPosition(doc);
      mutation.anchorInserted = Boolean(anchor.inserted);
      if (!anchor.ok) {
        return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: anchor.error || "OnlyOffice 未能建立当前插入位置" };
      }
      if (typeof doc.InsertContent !== "function") {
        return { ok: false, partial: true, source: "connector-callCommand", requestId: payload.requestId, error: "OnlyOffice 段落插入接口不可用" };
      }
      var insertResult = doc.InsertContent(content);
      if (insertResult === false) {
        return { ok: false, partial: true, source: "connector-callCommand", requestId: payload.requestId, error: "OnlyOffice 未确认方案正文插入" };
      }
      mutation.inserted = content.length;
      return { ok: true, source: "connector-callCommand", requestId: payload.requestId, count: content.length };
    } catch (error) {
      return {
        ok: false,
        partial: mutation.anchorInserted || mutation.inserted > 0 || mutation.cleared > 0,
        source: "connector-callCommand",
        requestId: payload.requestId,
        inserted: mutation.inserted,
        cleared: mutation.cleared,
        error: error && error.message ? error.message : "Connector 写入失败",
      };
    }
  `);
  return callOnlyOfficeConnectorCommand(command, { timeoutMs });
}

function normalizeReplaceTarget(target) {
  if (!target || typeof target !== "object") return null;
  const title = String(target.title || "").trim();
  const styleRef = normalizeStyleRef(target.styleRef);
  const bodyStyleRef = normalizeStyleRef(target.bodyStyleRef);
  const rawBodyParagraphCount = target.bodyParagraphCount;
  const bodyParagraphCount = rawBodyParagraphCount == null || String(rawBodyParagraphCount).trim() === "" ? null : Number(rawBodyParagraphCount);
  return title || styleRef
    ? {
      title,
      headingPath: Array.isArray(target.headingPath) ? target.headingPath.map((item) => String(item || "").trim()).filter(Boolean) : [],
      styleRef,
      bodyStyleRef,
      bodyParagraphCount: Number.isInteger(bodyParagraphCount) && bodyParagraphCount >= 0 ? bodyParagraphCount : null,
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

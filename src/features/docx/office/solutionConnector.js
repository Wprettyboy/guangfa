import { callOnlyOfficeConnectorCommand } from "./connector.js";

function insertSolutionWritingWithConnector({ text, paragraphs, requestId, timeoutMs }) {
  const rows = Array.isArray(paragraphs) ? paragraphs : [];
  if (!rows.length) return Promise.resolve({ ok: false, skipped: true, source: "connector", reason: "empty-paragraphs" });
  const payload = JSON.stringify({
    requestId: requestId || "",
    text: String(text || ""),
    paragraphs: rows,
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
    function applyWordStyle(doc, paragraph, item) {
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
        var paragraph = Api.CreateParagraph();
        applyWordStyle(doc, paragraph, item);
        if (item.text) paragraph.AddText(String(item.text));
        content.push(paragraph);
      }
      if (!content.length) return { ok: false, source: "connector", requestId: payload.requestId, error: "方案正文为空" };
      doc.InsertContent(content);
      return { ok: true, source: "connector-callCommand", requestId: payload.requestId, count: content.length };
    } catch (error) {
      return { ok: false, source: "connector-callCommand", requestId: payload.requestId, error: error && error.message ? error.message : "Connector 写入失败" };
    }
  `);
  return callOnlyOfficeConnectorCommand(command, { timeoutMs });
}

export {
  insertSolutionWritingWithConnector,
};

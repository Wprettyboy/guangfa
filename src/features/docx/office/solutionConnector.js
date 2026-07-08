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
      if (!doc || typeof doc.GetStyle !== "function" || !paragraph || typeof paragraph.SetStyle !== "function") return false;
      var candidates = getStyleCandidates(item);
      for (var index = 0; index < candidates.length; index += 1) {
        try {
          var style = doc.GetStyle(candidates[index]);
          if (style) {
            paragraph.SetStyle(style);
            return true;
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

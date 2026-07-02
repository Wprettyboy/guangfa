import JSZip from "jszip";

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export async function loadDocxXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);
  if (!documentXml) throw new Error("DOCX 缺少 word/document.xml");

  const parser = new DOMParser();
  return {
    zip,
    documentDoc: parser.parseFromString(documentXml, "application/xml"),
    stylesDoc: stylesXml ? parser.parseFromString(stylesXml, "application/xml") : null,
    numberingDoc: numberingXml ? parser.parseFromString(numberingXml, "application/xml") : null,
  };
}

export function serializeXml(doc) {
  return new XMLSerializer().serializeToString(doc);
}

export function getWordAttr(node, name) {
  if (!node) return "";
  return node.getAttributeNS(WORD_NS, name) || node.getAttribute(`w:${name}`) || node.getAttribute(name) || "";
}

export function setWordAttr(node, name, value) {
  node.setAttributeNS(WORD_NS, `w:${name}`, String(value));
}

export function getWordChild(node, localName) {
  if (!node) return null;
  return [...node.children].find((child) => child.localName === localName) || null;
}

export function getWordChildren(node, localName) {
  if (!node) return [];
  return [...node.children].filter((child) => child.localName === localName);
}

export function getWordElements(node, localName) {
  if (!node) return [];
  const namespaced = [...node.getElementsByTagNameNS(WORD_NS, localName)];
  return namespaced.length > 0 ? namespaced : [...node.getElementsByTagName(`w:${localName}`)];
}

export function createWordElement(doc, localName) {
  return doc.createElementNS(WORD_NS, `w:${localName}`);
}

export function ensureWordChild(doc, node, localName, before = null) {
  let child = getWordChild(node, localName);
  if (child) return child;
  child = createWordElement(doc, localName);
  node.insertBefore(child, before || node.firstChild);
  return child;
}

export function removeWordChild(node, localName) {
  const child = getWordChild(node, localName);
  if (child) child.remove();
}

export function getParagraphText(paragraph) {
  return getWordElements(paragraph, "t")
    .map((node) => node.textContent || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function isInWordTable(node) {
  for (let current = node?.parentElement; current; current = current.parentElement) {
    if (current.localName === "tc" || current.localName === "tbl") return true;
  }
  return false;
}

export function parseOutlineLevel(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const level = Number(value);
  return Number.isInteger(level) ? level : null;
}

export function parseHeadingStyleLevel(name) {
  const match = String(name || "").match(/^heading\s*([1-9])$/i);
  return match ? Number(match[1]) - 1 : null;
}

export function parseDocxStyles(stylesDoc) {
  const styles = new Map();
  const headingStyleIds = new Map();
  let normalStyleId = "";

  getWordElements(stylesDoc, "style").forEach((style) => {
    const styleId = getWordAttr(style, "styleId");
    if (!styleId) return;

    const type = getWordAttr(style, "type");
    const name = getWordAttr(getWordChild(style, "name"), "val");
    const outline = getWordChild(getWordChild(style, "pPr"), "outlineLvl");
    const outlineLevel = parseOutlineLevel(getWordAttr(outline, "val"));
    const headingLevel = parseHeadingStyleLevel(name);
    const level = Number.isInteger(outlineLevel) ? outlineLevel : headingLevel;
    const styleInfo = { id: styleId, name, type, level };
    styles.set(styleId, styleInfo);

    if (type === "paragraph" && !normalStyleId && /^(normal|正文)$/i.test(name || "")) {
      normalStyleId = styleId;
    }
    if (Number.isInteger(level) && level >= 0 && level <= 8 && !headingStyleIds.has(level)) {
      headingStyleIds.set(level, styleId);
    }
  });

  return { styles, headingStyleIds, normalStyleId };
}

export function collectParagraphs(documentDoc, styleData) {
  return getWordElements(documentDoc, "p").map((paragraph, index) => {
    const pPr = getWordChild(paragraph, "pPr");
    const styleId = getWordAttr(getWordChild(pPr, "pStyle"), "val");
    const directOutlineLevel = parseOutlineLevel(getWordAttr(getWordChild(pPr, "outlineLvl"), "val"));
    const style = styleData.styles.get(styleId);
    const level = Number.isInteger(directOutlineLevel) ? directOutlineLevel : style?.level;
    return {
      index,
      paragraph,
      text: getParagraphText(paragraph),
      styleId,
      styleName: style?.name || "",
      level,
      directOutlineLevel,
      inTable: isInWordTable(paragraph),
    };
  });
}

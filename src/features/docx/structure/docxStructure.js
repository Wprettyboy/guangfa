import JSZip from "jszip";

const WORD_XML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function readDocxStructure(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);
  if (!documentXml) return { outline: [], blocks: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const styles = stylesXml ? parseDocxOutlineStyles(parser.parseFromString(stylesXml, "application/xml")) : new Map();
  const numbering = numberingXml ? parseDocxNumbering(parser.parseFromString(numberingXml, "application/xml")) : { nums: new Map() };
  const body = structureDescendants(doc, "body")[0];
  if (!body) return { outline: [], blocks: [] };

  const root = {
    id: "audit-out-root",
    parentId: "",
    level: 0,
    order: 0,
    title: "文档正文",
    paragraphIndex: 0,
    blockIds: [],
  };
  const outline = [];
  const stack = [root];
  const blocks = [];
  let currentOutline = root;
  let paragraphIndex = 0;
  let tableIndex = 0;
  let tocFieldDepth = 0;
  const numberingState = new Map();

  structureElementChildren(body).forEach((child) => {
    const name = structureLocalName(child);
    if (name === "p") {
      paragraphIndex += 1;
      const text = getStructureNodeText(child);
      const styleId = getStructureParagraphStyleId(child);
      const styleInfo = styles.get(styleId);
      const styleName = styleInfo?.name || "";
      const pPr = structureElementChildren(child, "pPr")[0];
      const directOutline = pPr ? structureElementChildren(pPr, "outlineLvl")[0] : null;
      const directLevel = parseOutlineLevel(getStructureAttr(directOutline, "val"));
      const actualLevel = Number.isInteger(directLevel) ? directLevel : styleInfo?.level;
      const fieldInfo = getParagraphFieldInfo(child);
      const insideToc = tocFieldDepth > 0 || fieldInfo.startsToc || isTocStyle(styleInfo, styleId);
      if (fieldInfo.startsToc) tocFieldDepth += Math.max(1, fieldInfo.beginCount);
      if (tocFieldDepth > 0 && fieldInfo.endCount > 0) tocFieldDepth = Math.max(0, tocFieldDepth - fieldInfo.endCount);
      const isHeading = !insideToc && Number.isInteger(actualLevel) && actualLevel >= 0 && actualLevel <= 8;
      if (!text && !isHeading) return;
      const displayText = text || "空标题";
      if (isHeading) {
        const numberPrefix = formatAndAdvanceNumbering(numberingState, numbering, resolveParagraphNumbering(child, styleInfo));
        currentOutline = addStructureOutlineNode(outline, stack, actualLevel + 1, structureOutlineTitle(joinOutlineNumbering(numberPrefix, displayText)), paragraphIndex);
      }

      const block = {
        id: `audit-block-${String(blocks.length + 1).padStart(4, "0")}`,
        outlineId: currentOutline.id,
        outlineTitle: currentOutline.title,
        type: "paragraph",
        order: blocks.length + 1,
        paragraphIndex,
        tableIndex: 0,
        level: isHeading ? actualLevel + 1 : 0,
        styleId,
        styleName,
        isHeading,
        text: displayText,
        preview: structureBlockPreview(displayText),
      };
      blocks.push(block);
      currentOutline.blockIds.push(block.id);
      return;
    }

    if (name === "tbl") {
      tableIndex += 1;
      const text = getStructureTableText(child);
      if (!text) return;
      const block = {
        id: `audit-block-${String(blocks.length + 1).padStart(4, "0")}`,
        outlineId: currentOutline.id,
        outlineTitle: currentOutline.title,
        type: "table",
        order: blocks.length + 1,
        paragraphIndex,
        tableIndex,
        level: 0,
        styleId: "",
        styleName: "",
        isHeading: false,
        text,
        preview: structureBlockPreview(text),
      };
      blocks.push(block);
      currentOutline.blockIds.push(block.id);
    }
  });

  return {
    outline: outline.map((item) => ({
      id: item.id,
      title: item.title,
      level: Math.max(0, item.level - 1),
      index: item.paragraphIndex,
      page: 1,
      blockIds: item.blockIds,
    })),
    blocks,
  };
}

function structureLocalName(node) {
  return String(node?.localName || node?.nodeName || "").split(":").pop();
}

function structureElementChildren(node, name) {
  const children = [];
  for (let index = 0; index < (node?.childNodes?.length || 0); index += 1) {
    const child = node.childNodes[index];
    if (child.nodeType === 1 && (!name || structureLocalName(child) === name)) children.push(child);
  }
  return children;
}

function structureDescendants(node, name) {
  const found = [];
  function visit(current) {
    for (let index = 0; index < (current?.childNodes?.length || 0); index += 1) {
      const child = current.childNodes[index];
      if (child.nodeType !== 1) continue;
      if (!name || structureLocalName(child) === name) found.push(child);
      visit(child);
    }
  }
  visit(node);
  return found;
}

function getStructureAttr(node, name) {
  return node?.getAttribute?.(`w:${name}`) || node?.getAttribute?.(name) || "";
}

function getStructureNodeText(node) {
  return structureDescendants(node)
    .map((item) => {
      const name = structureLocalName(item);
      if (name === "t") return item.textContent || "";
      if (name === "tab") return " ";
      if (name === "br" || name === "cr") return "\n";
      return "";
    })
    .join("")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function getStructureTableText(table) {
  return structureElementChildren(table, "tr")
    .map((row) =>
      structureElementChildren(row, "tc")
        .map((cell) => getStructureNodeText(cell))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

function getStructureParagraphStyleId(paragraph) {
  const pPr = structureElementChildren(paragraph, "pPr")[0];
  const pStyle = pPr ? structureElementChildren(pPr, "pStyle")[0] : null;
  return getStructureAttr(pStyle, "val");
}

async function readStructureStyleMap(zip, parser) {
  const stylesXml = await zip.file("word/styles.xml")?.async("text");
  const styleMap = new Map();
  if (!stylesXml) return styleMap;
  const doc = parser.parseFromString(stylesXml, "application/xml");
  structureDescendants(doc, "style").forEach((style) => {
    const styleId = getStructureAttr(style, "styleId");
    const type = getStructureAttr(style, "type");
    const name = getStructureAttr(structureElementChildren(style, "name")[0], "val");
    if (styleId) styleMap.set(styleId, { styleId, type, name });
  });
  return styleMap;
}

function structureChineseNumberToInt(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (map[raw]) return map[raw];
  if (raw === "十一") return 11;
  if (raw === "十二") return 12;
  return 0;
}

function structureHeadingLevelFromStyle(styleId, styleName = "") {
  const source = `${styleId} ${styleName}`.toLowerCase();
  if (/\btoc\b|目录/.test(source)) return 0;
  const headingMatch = /(heading|标题)\s*([1-6一二三四五六])/.exec(source);
  if (headingMatch) return structureChineseNumberToInt(headingMatch[2]);
  const titleMatch = /^([1-6])$/.exec(String(styleId || ""));
  if (titleMatch && /标题/.test(styleName)) return Number(titleMatch[1]);
  return 0;
}

function normalizeStructureString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inferStructureHeadingLevel(text, styleId, styleName) {
  const styledLevel = structureHeadingLevelFromStyle(styleId, styleName);
  const value = normalizeStructureString(text);
  if (!value || value.length > 90 || value === "目 录" || value === "目录") return 0;
  if (/^□?第[一二三四五六七八九十0-9]+章/.test(value)) return 1;
  if (/^(询比采购公告|采购公告)$/.test(value)) return 1;
  if (/^(供应商须知|供应商资格证明材料|项目详细要求|响应文件格式|合同主要条款)$/.test(value)) return 1;
  if (/^□?第五章\s*评审办法/.test(value)) return 1;

  const isChineseSection = /^[一二三四五六七八九十]+[、.．]\s*\S+/.test(value);
  if (styledLevel === 2 && isChineseSection) return 2;
  if (styledLevel === 1) return 1;
  if (styledLevel === 2 && !/^[0-9]+(?:\.[0-9]+)*[、.．\s]/.test(value)) return 2;
  return 0;
}

function structureOutlineTitle(text) {
  return normalizeStructureString(text).replace(/\s+/g, " ").slice(0, 80) || "未命名章节";
}

function structureBlockPreview(text, maxLength = 220) {
  const value = normalizeStructureString(text);
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function addStructureOutlineNode(outline, stack, level, title, paragraphIndex) {
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
  const parent = stack[stack.length - 1];
  const order = outline.length + 1;
  const node = {
    id: `audit-out-${String(order).padStart(3, "0")}`,
    parentId: parent?.id || "",
    level,
    order,
    title,
    paragraphIndex,
    blockIds: [],
  };
  outline.push(node);
  stack.push(node);
  return node;
}

async function readDocxOutlineItems(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);
  if (!documentXml) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const styles = stylesXml ? parseDocxOutlineStyles(parser.parseFromString(stylesXml, "application/xml")) : new Map();
  const numbering = numberingXml ? parseDocxNumbering(parser.parseFromString(numberingXml, "application/xml")) : { nums: new Map() };
  return collectDocxOutlineItems(doc, styles, numbering);
}

function collectDocxOutlineItems(doc, styles, numbering) {
  const numberingState = new Map();
  let tocFieldDepth = 0;

  return getWordXmlElements(doc, "p")
    .map((paragraph, index) => {
      const text = getXmlParagraphText(paragraph).replace(/\s+/g, " ").trim();

      const pPr = getWordXmlChild(paragraph, "pPr");
      const pStyle = getWordXmlChild(pPr, "pStyle");
      const styleId = getWordXmlAttr(pStyle, "val");
      const styleInfo = styles.get(styleId);
      const fieldInfo = getParagraphFieldInfo(paragraph);
      const insideToc = tocFieldDepth > 0 || fieldInfo.startsToc || isTocStyle(styleInfo, styleId);
      if (fieldInfo.startsToc) tocFieldDepth += Math.max(1, fieldInfo.beginCount);
      if (tocFieldDepth > 0 && fieldInfo.endCount > 0) tocFieldDepth = Math.max(0, tocFieldDepth - fieldInfo.endCount);
      if (insideToc || !text) return null;

      const directOutline = getWordXmlChild(pPr, "outlineLvl");
      const directLevel = parseOutlineLevel(getWordXmlAttr(directOutline, "val"));
      const styleLevel = styleInfo?.level;
      const level = Number.isInteger(directLevel) ? directLevel : styleLevel;
      if (!Number.isInteger(level) || level < 0 || level > 8) return null;

      const numberPrefix = formatAndAdvanceNumbering(
        numberingState,
        numbering,
        resolveParagraphNumbering(paragraph, styleInfo),
      );

      return {
        id: `outline-${index}`,
        title: joinOutlineNumbering(numberPrefix, text),
        level,
        index,
      };
    })
    .filter(Boolean);
}

function parseDocxOutlineStyles(stylesDoc) {
  const styles = new Map();
  getWordXmlElements(stylesDoc, "style").forEach((style) => {
    const styleId = getWordXmlAttr(style, "styleId");
    if (!styleId) return;

    const name = getWordXmlAttr(getWordXmlChild(style, "name"), "val");
    const pPr = getWordXmlChild(style, "pPr");
    const outline = getWordXmlChild(pPr, "outlineLvl");
    const outlineLevel = parseOutlineLevel(getWordXmlAttr(outline, "val"));
    const headingLevel = parseHeadingStyleLevel(name);
    const level = Number.isInteger(outlineLevel) ? outlineLevel : headingLevel;
    styles.set(styleId, { name, level, numPr: parseNumberingProperties(getWordXmlChild(pPr, "numPr")) });
  });
  return styles;
}

function parseDocxNumbering(numberingDoc) {
  const abstracts = new Map();
  getWordXmlElements(numberingDoc, "abstractNum").forEach((abstractNum) => {
    const abstractId = getWordXmlAttr(abstractNum, "abstractNumId");
    if (!abstractId) return;
    const levels = new Map();
    getWordXmlChildren(abstractNum, "lvl").forEach((levelNode) => {
      const level = parseOutlineLevel(getWordXmlAttr(levelNode, "ilvl"));
      if (Number.isInteger(level)) levels.set(level, parseNumberingLevel(levelNode));
    });
    abstracts.set(abstractId, levels);
  });

  const nums = new Map();
  getWordXmlElements(numberingDoc, "num").forEach((numNode) => {
    const numId = getWordXmlAttr(numNode, "numId");
    const abstractId = getWordXmlAttr(getWordXmlChild(numNode, "abstractNumId"), "val");
    if (!numId || !abstracts.has(abstractId)) return;

    const levels = new Map([...abstracts.get(abstractId)].map(([level, info]) => [level, { ...info }]));
    getWordXmlChildren(numNode, "lvlOverride").forEach((override) => {
      const level = parseOutlineLevel(getWordXmlAttr(override, "ilvl"));
      if (!Number.isInteger(level)) return;
      const overrideLevel = getWordXmlChild(override, "lvl");
      const base = overrideLevel ? parseNumberingLevel(overrideLevel) : levels.get(level) || {};
      const startOverride = Number(getWordXmlAttr(getWordXmlChild(override, "startOverride"), "val"));
      levels.set(level, {
        ...levels.get(level),
        ...base,
        ...(Number.isInteger(startOverride) ? { start: startOverride } : {}),
      });
    });

    nums.set(numId, { levels });
  });

  return { nums };
}

function parseNumberingLevel(levelNode) {
  const start = Number(getWordXmlAttr(getWordXmlChild(levelNode, "start"), "val") || "1");
  return {
    start: Number.isInteger(start) ? start : 1,
    numFmt: getWordXmlAttr(getWordXmlChild(levelNode, "numFmt"), "val") || "decimal",
    lvlText: getWordXmlAttr(getWordXmlChild(levelNode, "lvlText"), "val") || "",
  };
}

function parseNumberingProperties(numPr) {
  if (!numPr) return null;
  const numId = getWordXmlAttr(getWordXmlChild(numPr, "numId"), "val");
  const ilvl = parseOutlineLevel(getWordXmlAttr(getWordXmlChild(numPr, "ilvl"), "val"));
  if (!numId && !Number.isInteger(ilvl)) return null;
  return { numId, ilvl: Number.isInteger(ilvl) ? ilvl : 0 };
}

function resolveParagraphNumbering(paragraph, styleInfo) {
  const pPr = getWordXmlChild(paragraph, "pPr");
  const direct = parseNumberingProperties(getWordXmlChild(pPr, "numPr"));
  const inherited = styleInfo?.numPr;
  const numId = direct?.numId || inherited?.numId;
  if (!numId) return null;
  return {
    numId,
    ilvl: Number.isInteger(direct?.ilvl) ? direct.ilvl : Number.isInteger(inherited?.ilvl) ? inherited.ilvl : 0,
  };
}

function formatAndAdvanceNumbering(state, numbering, numPr) {
  if (!numPr) return "";
  const num = numbering.nums.get(String(numPr.numId));
  const level = Number.isInteger(numPr.ilvl) ? numPr.ilvl : 0;
  const levelInfo = num?.levels.get(level);
  if (!levelInfo) return "";

  const counters = state.get(numPr.numId) || [];
  const previous = Number.isInteger(counters[level]) ? counters[level] : levelInfo.start - 1;
  counters[level] = previous + 1;
  for (let index = level + 1; index < counters.length; index += 1) counters[index] = undefined;
  state.set(numPr.numId, counters);

  if (levelInfo.numFmt === "none") return "";
  const pattern = levelInfo.lvlText || `%${level + 1}`;
  return pattern.replace(/%([1-9])/g, (_, levelNumber) => {
    const levelIndex = Number(levelNumber) - 1;
    const value = counters[levelIndex];
    const format = num.levels.get(levelIndex)?.numFmt || "decimal";
    return Number.isInteger(value) ? formatNumberValue(value, format) : "";
  });
}

function formatNumberValue(value, format) {
  const normalizedFormat = String(format || "decimal").toLowerCase();
  if (normalizedFormat.includes("chinese") || normalizedFormat.includes("japanese")) return toChineseNumber(value);
  if (normalizedFormat === "lowerletter") return toLetterNumber(value, false);
  if (normalizedFormat === "upperletter") return toLetterNumber(value, true);
  if (normalizedFormat === "lowerroman") return toRomanNumber(value).toLowerCase();
  if (normalizedFormat === "upperroman") return toRomanNumber(value);
  return String(value);
}

function toChineseNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 9999) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const chars = String(value).split("").map(Number);
  let result = "";
  let pendingZero = false;
  chars.forEach((digit, index) => {
    const unit = units[chars.length - index - 1];
    if (digit === 0) {
      pendingZero = Boolean(result);
      return;
    }
    if (pendingZero) result += "零";
    result += `${digits[digit]}${unit}`;
    pendingZero = false;
  });
  return result.replace(/^一十/, "十");
}

function toLetterNumber(value, uppercase) {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(97 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return uppercase ? result.toUpperCase() : result;
}

function toRomanNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 3999) return String(value);
  const pairs = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let current = value;
  let result = "";
  pairs.forEach(([number, roman]) => {
    while (current >= number) {
      result += roman;
      current -= number;
    }
  });
  return result;
}

function joinOutlineNumbering(numberPrefix, text) {
  const prefix = String(numberPrefix || "").trim();
  if (!prefix) return text;
  return normalizeOutlineTitle(text).startsWith(normalizeOutlineTitle(prefix)) ? text : `${prefix} ${text}`;
}

function getParagraphFieldInfo(paragraph) {
  const instrText = getWordXmlElements(paragraph, "instrText")
    .map((node) => node.textContent || "")
    .join(" ");
  const fldChars = getWordXmlElements(paragraph, "fldChar");
  return {
    startsToc: /\bTOC\b/i.test(instrText),
    beginCount: fldChars.filter((node) => getWordXmlAttr(node, "fldCharType") === "begin").length,
    endCount: fldChars.filter((node) => getWordXmlAttr(node, "fldCharType") === "end").length,
  };
}

function isTocStyle(styleInfo, styleId) {
  return /^toc\b/i.test(styleInfo?.name || "") || /^TOC/i.test(styleId || "");
}

function parseHeadingStyleLevel(name) {
  const match = String(name || "").match(/^heading\s*([1-9])$/i);
  return match ? Number(match[1]) - 1 : null;
}

function parseOutlineLevel(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const level = Number(value);
  return Number.isInteger(level) ? level : null;
}

function getWordXmlAttr(node, name) {
  if (!node) return "";
  return (
    node.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name) ||
    node.getAttribute(`w:${name}`) ||
    node.getAttribute(name) ||
    ""
  );
}

function getWordXmlChild(node, localName) {
  if (!node) return null;
  return [...node.children].find((child) => child.localName === localName) || null;
}

function getWordXmlChildren(node, localName) {
  if (!node) return [];
  return [...node.children].filter((child) => child.localName === localName);
}

function getWordXmlElements(node, localName) {
  if (!node) return [];
  const namespaced = node.getElementsByTagNameNS ? [...node.getElementsByTagNameNS(WORD_XML_NS, localName)] : [];
  return namespaced.length > 0 ? namespaced : [...node.getElementsByTagName?.(`w:${localName}`) ?? []];
}

function getWordXmlParagraphText(paragraph) {
  return getWordXmlElements(paragraph, "t")
    .map((node) => node.textContent || "")
    .join("");
}

function normalizeOutlineTitle(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}
export {
  WORD_XML_NS,
  addStructureOutlineNode,
  collectDocxOutlineItems,
  formatAndAdvanceNumbering,
  formatNumberValue,
  getParagraphFieldInfo,
  getStructureAttr,
  getStructureNodeText,
  getStructureParagraphStyleId,
  getStructureTableText,
  getWordXmlAttr,
  getWordXmlChild,
  getWordXmlChildren,
  getWordXmlElements,
  getWordXmlParagraphText,
  inferStructureHeadingLevel,
  isTocStyle,
  joinOutlineNumbering,
  normalizeOutlineTitle,
  normalizeStructureString,
  parseDocxNumbering,
  parseDocxOutlineStyles,
  parseHeadingStyleLevel,
  parseNumberingLevel,
  parseNumberingProperties,
  parseOutlineLevel,
  readDocxOutlineItems,
  readDocxStructure,
  readStructureStyleMap,
  resolveParagraphNumbering,
  structureBlockPreview,
  structureChineseNumberToInt,
  structureDescendants,
  structureElementChildren,
  structureHeadingLevelFromStyle,
  structureLocalName,
  structureOutlineTitle,
  toChineseNumber,
  toLetterNumber,
  toRomanNumber,
};
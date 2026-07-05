const gbOfficialDocumentRule = {
  id: "gbt-9704-2012",
  name: "GB/T 9704-2012 党政机关公文格式",
  actions: [
    {
      id: "page",
      title: "页面版式",
      summary: "A4 版面、常用公文页边距。",
      payload: {
        pageSize: { widthMm: 210, heightMm: 297 },
        marginsMm: { top: 37, right: 26, bottom: 35, left: 28 },
      },
    },
    {
      id: "body",
      title: "正文格式",
      summary: "仿宋三号、两字符首行缩进、固定 28 磅行距。",
      payload: {
        fontFamily: "仿宋_GB2312",
        fallbackFonts: ["仿宋", "FangSong"],
        fontSizePt: 16,
        firstLineChars: 2,
        lineSpacingPt: 28,
        beforePt: 0,
        afterPt: 0,
      },
    },
    {
      id: "headings",
      title: "标题层级",
      summary: "按常见公文层级识别并设置标题字体、字号和对齐。",
      payload: {
        documentTitle: { fontFamily: "方正小标宋简体", fallbackFonts: ["小标宋", "宋体"], fontSizePt: 22, alignment: "center" },
        levels: [
          { pattern: "^([一二三四五六七八九十]+、)", fontFamily: "黑体", fontSizePt: 16, bold: false },
          { pattern: "^（[一二三四五六七八九十]+）", fontFamily: "楷体_GB2312", fallbackFonts: ["楷体"], fontSizePt: 16, bold: false },
          { pattern: "^[0-9]+[．.、]", fontFamily: "仿宋_GB2312", fallbackFonts: ["仿宋"], fontSizePt: 16, bold: false },
          { pattern: "^（[0-9]+）", fontFamily: "仿宋_GB2312", fallbackFonts: ["仿宋"], fontSizePt: 16, bold: false },
        ],
      },
    },
    {
      id: "signature",
      title: "落款与日期",
      summary: "识别发文机关、成文日期等短段落，右对齐并保留正文规格。",
      payload: {
        fontFamily: "仿宋_GB2312",
        fallbackFonts: ["仿宋"],
        fontSizePt: 16,
        alignment: "right",
      },
    },
  ],
};

function buildGbLayoutPlan(actionIds = gbOfficialDocumentRule.actions.map((item) => item.id)) {
  const enabled = new Set(actionIds);
  return {
    standardId: gbOfficialDocumentRule.id,
    standardName: gbOfficialDocumentRule.name,
    actions: gbOfficialDocumentRule.actions.filter((action) => enabled.has(action.id)),
  };
}

export { buildGbLayoutPlan, gbOfficialDocumentRule };

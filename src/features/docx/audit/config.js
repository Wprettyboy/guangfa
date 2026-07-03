const auditConfigStorageKey = "format-audit-config";

const auditConfigItems = [
  { id: "page-margin", group: "页面版式", name: "页边距" },
  { id: "body-font", group: "基础文字", name: "正文字体" },
  { id: "body-size", group: "基础文字", name: "正文字号" },
  { id: "first-line-indent", group: "段落格式", name: "首行缩进" },
  { id: "line-spacing", group: "段落格式", name: "行距" },
  { id: "paragraph-spacing", group: "段落格式", name: "段前段后" },
  { id: "blank-lines", group: "段落格式", name: "空行" },
  { id: "body-outline", group: "标题体系", name: "正文误入标题（AI审查，脚本移出大纲）" },
  { id: "missing-heading-style", group: "标题体系", name: "标题未入大纲（AI审查，脚本套用标题层级）" },
  { id: "heading-level", group: "标题体系", name: "标题层级" },
  { id: "heading-visual-style", group: "标题体系", name: "标题字体字号" },
  { id: "split-heading", group: "标题体系", name: "标题拆分（合并被断开的标题段落）" },
  { id: "word-outline", group: "目录大纲", name: "Word 大纲（AI审查，脚本修正文档导航窗格层级）" },
  { id: "toc-items", group: "目录大纲", name: "目录项（按当前标题重建目录项）" },
];

const auditIssueConfigMap = {
  "section-normalize": ["page-margin"],
  "body-font-format": ["body-font"],
  "body-size-format": ["body-size"],
  "first-line-indent-format": ["first-line-indent"],
  "line-spacing-format": ["line-spacing"],
  "paragraph-spacing-format": ["paragraph-spacing"],
  "blank-lines-format": ["blank-lines"],
  "body-outline": ["body-outline"],
  "missing-heading-style": ["missing-heading-style"],
  "heading-level-format": ["heading-level"],
  "heading-visual-style-format": ["heading-visual-style"],
  "split-heading": ["split-heading"],
  "word-outline-format": ["word-outline"],
  "toc-items-format": ["toc-items"],
  "ai-body-outline": ["body-outline"],
  "ai-missing-heading-style": ["missing-heading-style"],
  "ai-word-outline-format": ["word-outline"],
};

const aiOutlineSourceIssueIds = new Set(["body-outline", "missing-heading-style", "word-outline-format"]);

const defaultAuditConfig = {
  version: 2,
  enabled: auditConfigItems.map((item) => item.id),
  params: {
    pageMarginTopMm: 37,
    pageMarginRightMm: 26,
    pageMarginBottomMm: 35,
    pageMarginLeftMm: 28,
    bodyFont: "仿宋",
    bodyFontSizePt: 16,
    firstLineChars: 2,
    lineSpacing: 1.5,
    paragraphBeforePt: 0,
    paragraphAfterPt: 0,
    headingLevel1Font: "小标宋",
    headingLevel1SizePt: 22,
    headingLevel2Font: "黑体",
    headingLevel2SizePt: 16,
    headingLevel3Font: "楷体",
    headingLevel3SizePt: 16,
  },
};

function readAuditConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(auditConfigStorageKey) || "null");
    if (Array.isArray(parsed)) return defaultAuditConfig;
    if (parsed && typeof parsed === "object") {
      const enabled = parsed.version === defaultAuditConfig.version && Array.isArray(parsed.enabled) ? parsed.enabled.filter(isKnownAuditConfigId) : defaultAuditConfig.enabled;
      return {
        version: defaultAuditConfig.version,
        enabled: enabled.length > 0 ? enabled : defaultAuditConfig.enabled,
        params: { ...defaultAuditConfig.params, ...(parsed.params || {}) },
      };
    }
  } catch {
    // ignore bad local config
  }
  return defaultAuditConfig;
}

function isKnownAuditConfigId(id) {
  return auditConfigItems.some((item) => item.id === id);
}

function isAuditIssueEnabled(issue, enabledItems) {
  if (!issue?.fixable || issue.layer === "evidence") return false;
  const keys = auditIssueConfigMap[issue.id] || (issue.auditConfigKey ? [issue.auditConfigKey] : null);
  return Boolean(keys?.some((key) => enabledItems.has(key)));
}

function shouldRunAiOutlineAudit(config) {
  const enabledSet = new Set(config.enabled || []);
  return enabledSet.has("body-outline") || enabledSet.has("missing-heading-style") || enabledSet.has("word-outline");
}

export {
  aiOutlineSourceIssueIds,
  auditConfigItems,
  auditConfigStorageKey,
  auditIssueConfigMap,
  defaultAuditConfig,
  isAuditIssueEnabled,
  isKnownAuditConfigId,
  readAuditConfig,
  shouldRunAiOutlineAudit,
};

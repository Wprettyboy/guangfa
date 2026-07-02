import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { auditDocxFormat } from "./lib/docx/formatAudit";
import { reviseDocxFormat } from "./lib/docx/formatRevise";
import {
  Archive,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  Eye,
  FileCheck2,
  FileText,
  FolderOpen,
  Highlighter,
  Info,
  Layers,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Menu,
  MessageSquareText,
  PenLine,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import "./styles.css";

gsap.registerPlugin(useGSAP);

function createPreviewId(prefix = "doc") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const documentSlots = [
  {
    id: "slot-project-code",
    label: "项目编号：",
    suggestedName: "项目编号",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目编号",
    answerFormat: "保留招标文件原始编号格式",
    aiInstruction: "从招标文件封面、项目基础信息或招标公告中提取项目编号，不要改写编号中的字母、短横线和年份。",
  },
  {
    id: "slot-project-name",
    label: "项目名称：",
    suggestedName: "项目名称",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目名称",
    answerFormat: "使用完整项目名称",
    aiInstruction: "从招标公告、技术方案封面或项目概况中提取完整项目名称，避免使用简称。",
  },
  {
    id: "slot-tenderer",
    label: "招 标 人：",
    suggestedName: "招标人",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目招标人",
    answerFormat: "单位全称",
    aiInstruction: "优先使用招标公告中的招标人单位全称，不要补充联系人、地址等无关信息。",
  },
  {
    id: "slot-agency",
    label: "招标代理机构：",
    suggestedName: "招标代理机构",
    defaultType: "填空",
    required: false,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写招标代理机构",
    answerFormat: "单位全称；没有则留空",
    aiInstruction: "从招标公告或投标人须知中提取招标代理机构名称，若资料没有明确写出则返回需补充资料。",
  },
  {
    id: "slot-date",
    label: "日　　期：",
    suggestedName: "日期",
    defaultType: "日期",
    required: true,
    page: 1,
    path: "封面 / 日期",
    suggestedQuestion: "请填写文件编制日期",
    answerFormat: "YYYY年MM月DD日",
    aiInstruction: "根据投标文件编制日期或用户指定日期填写，必须使用中文年月日格式。",
  },
  {
    id: "slot-bond",
    label: "投标保证金：",
    suggestedName: "投标保证金金额",
    defaultType: "金额",
    required: false,
    page: 5,
    path: "第二章 / 投标人须知前附表",
    suggestedQuestion: "请填写投标保证金金额",
    answerFormat: "人民币金额，保留单位",
    aiInstruction: "从投标人须知前附表中提取投标保证金金额；如果资料缺失或金额不唯一，标记为需补充资料。",
  },
];

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

const emptyPdfHighlights = [];
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
let aiRevisionId = 1000;
let fillBookmarkId = 50000;
let fillBookmarkNames = new Set();
const fillModeOptions = [
  { value: "short", label: "短文本" },
  { value: "paragraph", label: "长文本" },
  { value: "date", label: "日期" },
  { value: "amount", label: "金额" },
  { value: "choice", label: "选择" },
  { value: "choice-replace", label: "替换+选择" },
  { value: "amount-choice", label: "金额+选择" },
];
const choiceFillModeOptions = fillModeOptions.filter((item) => ["choice", "choice-replace", "amount-choice"].includes(item.value));
const blankFillModeOptions = fillModeOptions.filter((item) => ["short", "paragraph", "date", "amount"].includes(item.value));
const fieldCategoryOptions = ["填空", "单选项"];

function createAnnotatedField(slot, order, typeOverride) {
  const sourceText = getTemplateFieldSourceText(slot);
  const category = normalizeFieldCategory(typeOverride ?? slot.defaultType);
  return {
    id: `F-${String(order).padStart(3, "0")}`,
    slotId: slot.id,
    name: sourceText.slice(0, 30) || slot.suggestedName,
    sourceText,
    category,
    type: category,
    required: slot.required,
    status: "已标注",
    question: slot.suggestedQuestion,
    answerFormat: slot.answerFormat,
    aiInstruction: `根据模板选区原文自动填充`,
    fillMode: inferFillMode({ ...slot, sourceText, category }),
    page: slot.page,
    path: slot.path,
    marker: slot.marker ?? null,
  };
}

function createFillFieldsFromTemplate(templateFields, existingFields = []) {
  return templateFields.map((field) => {
    const existing = existingFields.find((item) => item.id === field.id || item.slotId === field.slotId || item.name === field.name);
    return {
      ...pickTemplateFillContext(field),
      value: existing?.value ?? "",
      status: existing?.status === "已确认" ? "已确认" : existing?.value ? "待确认" : "未填充",
      confidence: existing?.confidence ?? 0,
      source: existing?.source ?? "待上传资料后生成",
      evidence: existing?.evidence ?? `${getFieldDisplayText(field)}尚未执行 AI 填充，暂无溯源证据。`,
    };
  });
}

function mergeFillFieldsWithTemplate(fillFields, templateFields) {
  return fillFields.map((field) => {
    const templateField = templateFields.find(
      (item) => item.id === field.id || item.slotId === field.slotId || item.name === field.name,
    );
    return templateField ? { ...pickTemplateFillContext(templateField), ...field } : field;
  });
}

function pickTemplateFillContext(field) {
  return {
    id: field.id,
    slotId: field.slotId,
    name: field.name,
    sourceText: getTemplateFieldSourceText(field),
    category: normalizeFieldCategory(field.category || field.type),
    type: normalizeFieldCategory(field.type || field.category),
    fillMode: normalizeFillMode(field.fillMode, field),
    question: field.question,
    answerFormat: field.answerFormat,
    aiInstruction: field.aiInstruction,
    page: field.page,
    path: field.path,
    marker: field.marker ?? null,
    inputPoint: field.inputPoint ?? null,
  };
}

function normalizeTemplateFieldForRuntime(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type);
  return { ...field, category, type: category, fillMode: normalizeFillMode(field.fillMode, field) };
}

function createDynamicSlot(target, order) {
  const text = target.text?.replace(/\s+/g, " ").trim() ?? "";
  const guessedName = guessFieldName(text, order);
  const guessedType = guessFieldType(text);
  return {
    id: `dynamic-${Date.now()}-${order}`,
    label: guessedName,
    suggestedName: guessedName,
    defaultType: guessedType,
    required: true,
    page: target.page ?? 1,
    path: target.path ?? "文档选区",
    suggestedQuestion: text ? `模板上下文：${text.slice(0, 60)}` : "请补充字段说明",
    answerFormat: text || "按模板上下文填写",
    marker: target.marker ?? null,
    aiInstruction:
      guessedType === "单选项"
        ? `根据资料自动判断并选择“${guessedName}”`
        : `根据资料自动获取“${guessedName}”`,
  };
}

function getTemplateFieldSourceText(field = {}) {
  return String(
    field.sourceText ||
      field.marker?.text ||
      field.answerFormat ||
      field.question?.replace(/^模板上下文[：:]/, "") ||
      "",
  ).replace(/\s+/g, " ").trim();
}

function normalizeFieldCategory(value) {
  const category = String(value || "").trim();
  return category === "单选项" ? "单选项" : "填空";
}

function isReplacementField(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type || field.defaultType);
  return category === "单选项";
}

function requiresInputPoint(field = {}) {
  return !isReplacementField(field);
}

function hasInputPoint(field = {}) {
  return Boolean(field.inputPoint?.bookmarkName);
}

function getFieldDisplayText(field = {}) {
  return getTemplateFieldSourceText(field) || field.name || field.id || "未命名字段";
}

function normalizeFillMode(value, field = {}) {
  const mode = String(value || "").trim();
  const options = getFillModeOptions(field);
  const legacyMode = getLegacyFillMode(field);
  if (legacyMode && (!mode || mode === "short" || mode === "list" || mode === "table")) return legacyMode;
  return options.some((item) => item.value === mode) ? mode : inferFillMode(field);
}

function getLegacyFillMode(field = {}) {
  const legacyType = String(field.type || field.category || field.defaultType || "").trim();
  if (legacyType === "日期") return "date";
  if (legacyType === "金额") return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段") return "paragraph";
  return "";
}

function getFillModeOptions(field = {}) {
  return normalizeFieldCategory(field.category || field.type || field.defaultType) === "单选项"
    ? choiceFillModeOptions
    : blankFillModeOptions;
}

function inferFillMode(field = {}) {
  const category = normalizeFieldCategory(field.category || field.type || field.defaultType);
  const legacyType = String(field.type || field.category || field.defaultType || "").trim();
  const text = getTemplateFieldSourceText(field) || field.label || field.name || "";
  const context = `${text} ${field.question || ""} ${field.answerFormat || ""}`.replace(/\s+/g, " ");
  if (category === "单选项") return isAmountChoiceContext(context) ? "amount-choice" : "choice";
  if (legacyType === "日期" || /日期|年月日|编制时间/.test(context)) return "date";
  if (legacyType === "金额" || /金额|限价|报价|费用|预算|元|万元/.test(context)) return "amount";
  if (legacyType === "长文本" || legacyType === "表格字段" || /包括但不限于|包括|包含|不限于|清单|配置|分项|表格|主要施工内容|工作内容|采购范围|实施范围|服务范围|内容|规模|范围|概况|要求|服务内容|建设内容|实施内容|技术要求|商务要求|项目详细要求/.test(context)) return "paragraph";
  return "short";
}

function isAmountChoiceContext(context) {
  const text = String(context || "");
  return /[□☐○〇▢☑✓✔]/.test(text) && /含税|不含税/.test(text) && /金额|限价|报价|费用|预算/.test(text) && /元|万元/.test(text);
}

function getFillModeLabel(value) {
  return fillModeOptions.find((item) => item.value === value)?.label || "短文本";
}

const initialTemplateFile = null;
const initialTemplateFields = [];
const currentProjectId = "default-project";
const templateCategories = ["全部", "招标类", "合同类", "方案类"];

const initialFillFields = [
  {
    id: "F-001",
    slotId: "slot-project-code",
    name: "项目编号",
    value: "",
    status: "未填充",
    confidence: 0,
    source: "招标文件首页.docx 第 1 页",
    evidence: "项目编号：GF-SZDL-2026-042。该编号位于招标文件首页基本信息区。",
  },
  {
    id: "F-002",
    slotId: "slot-project-name",
    name: "项目名称",
    value: "XX市政道路改造工程项目",
    status: "待确认",
    confidence: 92,
    source: "技术方案.docx 第 12 页",
    evidence: "本项目名称为 XX市政道路改造工程项目，位于XX市XX区，项目建设内容包含道路、雨污水管网及照明改造。",
  },
  {
    id: "F-003",
    slotId: "slot-tenderer",
    name: "招标人",
    value: "XX市住房和城乡建设局",
    status: "已确认",
    confidence: 96,
    source: "招标公告.pdf 第 2 页",
    evidence: "招标人为 XX市住房和城乡建设局，联系人及地址详见招标公告第二页。",
  },
  {
    id: "F-004",
    slotId: "slot-agency",
    name: "招标代理机构",
    value: "XX工程咨询有限公司",
    status: "待确认",
    confidence: 88,
    source: "招标公告.pdf 第 2 页",
    evidence: "招标代理机构：XX工程咨询有限公司，负责本项目招标代理工作。",
  },
  {
    id: "F-005",
    slotId: "slot-date",
    name: "日期",
    value: "2026年06月26日",
    status: "已确认",
    confidence: 94,
    source: "投标文件编制说明.docx 第 4 页",
    evidence: "文件编制日期为 2026年06月26日。",
  },
  {
    id: "F-006",
    slotId: "slot-bond",
    name: "投标保证金金额",
    value: "",
    status: "需补充资料",
    confidence: 38,
    source: "未找到可靠来源",
    evidence: "现有资料中未检索到投标保证金金额的明确描述，需要补充商务文件或招标须知原件。",
  },
];

const statusMeta = {
  未填充: { tone: "muted", icon: Info },
  生成中: { tone: "blue", icon: Loader2 },
  待确认: { tone: "amber", icon: CircleAlert },
  已确认: { tone: "green", icon: Check },
  需补充资料: { tone: "red", icon: CircleAlert },
  人工填写: { tone: "purple", icon: PenLine },
  已标注: { tone: "green", icon: ShieldCheck },
};

function App() {
  const [activeModule, setActiveModule] = useState("workspace");
  const [activeWorkspace, setActiveWorkspace] = useState("annotate");
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(true);
  const [settingsNavOpen, setSettingsNavOpen] = useState(true);
  const [templateFile, setTemplateFile] = useState(initialTemplateFile);
  const [templateFields, setTemplateFields] = useState(initialTemplateFields);
  const [templateOfficeDocId, setTemplateOfficeDocId] = useState("");
  const [selectedTemplateFieldId, setSelectedTemplateFieldId] = useState(initialTemplateFields[0]?.id ?? "");
  const [brushActive, setBrushActive] = useState(false);
  const [brushType, setBrushType] = useState("填空");
  const [annotatePreviewPage, setAnnotatePreviewPage] = useState(1);
  const [fillPreviewPage, setFillPreviewPage] = useState(1);
  const [fillOfficeDocId, setFillOfficeDocId] = useState("");
  const [filledTemplateFile, setFilledTemplateFile] = useState(null);
  const [fillFieldPageMap, setFillFieldPageMap] = useState({});
  const [saveState, setSaveState] = useState("idle");
  const [templateLibrary, setTemplateLibrary] = useState([]);
  const [fillFields, setFillFields] = useState(initialFillFields);
  const [materialFiles, setMaterialFiles] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("F-002");
  const [citationFieldId, setCitationFieldId] = useState("F-002");
  const [showCitations, setShowCitations] = useState(true);
  const [draftReady, setDraftReady] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [selectedProjectKnowledgeBaseIds, setSelectedProjectKnowledgeBaseIds] = useState([]);
  const [selectedGlobalKnowledgeBaseIds, setSelectedGlobalKnowledgeBaseIds] = useState([]);
  const [knowledgeTopK, setKnowledgeTopK] = useState(6);
  const appRef = useRef(null);
  const annotatedTemplateBufferRef = useRef(null);
  const filledTemplateBufferRef = useRef(null);
  const filledTemplateDraftFileRef = useRef(null);
  const annotateSyncTimerRef = useRef(0);
  const fillSyncTimerRef = useRef(0);
  const templateFileRef = useRef(templateFile);
  const enrichedFillFields = useMemo(
    () => mergeFillFieldsWithTemplate(fillFields, templateFields),
    [fillFields, templateFields],
  );
  const enrichedFillFieldsRef = useRef(enrichedFillFields);
  const fillValueSignature = useMemo(
    () => enrichedFillFields.map((field) => `${field.id}:${field.value || ""}:${field.amountValue || ""}:${field.choiceValue || ""}:${field.source || ""}`).join("|"),
    [enrichedFillFields],
  );
  const fillPreviewFile = filledTemplateFile || templateFile;

  useEffect(() => {
    setFillFieldPageMap({});
  }, [fillPreviewFile?.previewId]);

  useGSAP(
    () => {
      const sidebarItems = gsap.utils.toArray(".sidebar-item");
      if (sidebarItems.length > 0) gsap.from(sidebarItems, {
        x: -14,
        autoAlpha: 0,
        duration: 0.45,
        stagger: 0.04,
        ease: "power2.out",
      });
      const topbarActions = gsap.utils.toArray(".topbar-action");
      if (topbarActions.length > 0) gsap.from(topbarActions, {
        y: -10,
        autoAlpha: 0,
        duration: 0.4,
        stagger: 0.05,
        ease: "power2.out",
      });
      const workspaceCards = gsap.utils.toArray(".document-card, .right-panel");
      if (workspaceCards.length > 0) gsap.from(workspaceCards, {
        y: 18,
        autoAlpha: 0,
        duration: 0.55,
        stagger: 0.08,
        ease: "power3.out",
      });
    },
    { scope: appRef },
  );

  useEffect(() => {
    templateFileRef.current = templateFile;
  }, [templateFile]);

  const selectedTemplateField = templateFields.find((field) => field.id === selectedTemplateFieldId);
  const workspaceTitle =
    activeModule === "template-management"
      ? "模板管理"
      : activeModule === "knowledge-management"
        ? "知识库管理"
        : activeModule === "settings"
          ? "系统设置"
          : activeWorkspace === "annotate"
            ? "模板标注工作台"
            : activeWorkspace === "audit"
              ? "格式审核工作台"
              : "填充确认工作台";

  useEffect(() => {
    if (selectedTemplateField && (selectedTemplateField.page || 1) !== annotatePreviewPage) {
      setSelectedTemplateFieldId("");
    }
  }, [annotatePreviewPage, selectedTemplateField]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readStoredTemplates(), readDraftState()]).then(([templates, draft]) => {
      if (cancelled) return;
      setTemplateLibrary(templates);
      if (draft?.templateFile?.buffer) {
        setTemplateFile(draft.templateFile);
        setFilledTemplateFile(draft.filledTemplateFile || null);
        filledTemplateBufferRef.current = draft.filledTemplateFile?.buffer ? draft.filledTemplateFile.buffer.slice(0) : null;
        filledTemplateDraftFileRef.current = draft.filledTemplateFile || null;
        setTemplateFields(draft.templateFields || []);
        setFillFields(draft.fillFields || []);
        setMaterialFiles(draft.materialFiles || []);
        setSelectedFieldId(draft.selectedFieldId || draft.fillFields?.[0]?.id || "");
        setCitationFieldId(draft.citationFieldId || draft.fillFields?.[0]?.id || "");
        setAnnotatePreviewPage(draft.annotatePreviewPage || 1);
        setFillPreviewPage(draft.fillPreviewPage || 1);
        setSelectedProjectKnowledgeBaseIds(normalizeKnowledgeBaseIds(draft.selectedProjectKnowledgeBaseIds ?? draft.selectedProjectKnowledgeBaseId));
        setSelectedGlobalKnowledgeBaseIds(normalizeKnowledgeBaseIds(draft.selectedGlobalKnowledgeBaseIds ?? draft.selectedGlobalKnowledgeBaseId));
        setActiveWorkspace(draft.activeWorkspace || "fill");
        setActiveModule("workspace");
      }
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshKnowledgeBases();
  }, []);

  useEffect(() => {
    if (selectedProjectKnowledgeBaseIds.length === 0 && knowledgeBases.length > 0) {
      const firstProjectBase = knowledgeBases.find((base) => base.scope !== "global" && (base.projectId || currentProjectId) === currentProjectId);
      if (firstProjectBase) setSelectedProjectKnowledgeBaseIds([firstProjectBase.id]);
      return;
    }
    const validIds = selectedProjectKnowledgeBaseIds.filter((id) => {
      const base = knowledgeBases.find((item) => item.id === id);
      return base && base.scope !== "global";
    });
    if (validIds.length !== selectedProjectKnowledgeBaseIds.length) {
      setSelectedProjectKnowledgeBaseIds(validIds);
    }
  }, [knowledgeBases, selectedProjectKnowledgeBaseIds]);

  useEffect(() => {
    if (selectedGlobalKnowledgeBaseIds.length === 0) return;
    const validIds = selectedGlobalKnowledgeBaseIds.filter((id) => {
      const base = knowledgeBases.find((item) => item.id === id);
      return base && base.scope === "global" && (base.documentCount || 0) > 0;
    });
    if (validIds.length !== selectedGlobalKnowledgeBaseIds.length) {
      setSelectedGlobalKnowledgeBaseIds(validIds);
    }
  }, [knowledgeBases, selectedGlobalKnowledgeBaseIds]);

  useEffect(() => {
    enrichedFillFieldsRef.current = enrichedFillFields;
  }, [enrichedFillFields]);

  useEffect(() => {
    if (!draftReady) return;
    if (!templateFile?.buffer) return;
    const timeout = window.setTimeout(() => {
      saveDraftState({
        activeWorkspace,
        templateFile: getDraftTemplateFile(),
        filledTemplateFile: getDraftFilledTemplateFile(),
        templateFields,
        fillFields,
        materialFiles,
        selectedFieldId,
        citationFieldId,
        annotatePreviewPage,
        fillPreviewPage,
        selectedProjectKnowledgeBaseIds,
        selectedGlobalKnowledgeBaseIds,
      });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [
    activeWorkspace,
    annotatePreviewPage,
    citationFieldId,
    draftReady,
    fillFields,
    fillPreviewPage,
    materialFiles,
    selectedProjectKnowledgeBaseIds,
    selectedGlobalKnowledgeBaseIds,
    selectedFieldId,
    templateFields,
    templateFile,
  ]);

  function animateWorkspace(nextWorkspace) {
    setActiveModule("workspace");
    if (nextWorkspace === activeWorkspace) return;
    const workspace = appRef.current?.querySelector(".workspace-body");
    if (!workspace) {
      setActiveWorkspace(nextWorkspace);
      return;
    }

    gsap.to(workspace, {
      autoAlpha: 0,
      y: 10,
      duration: 0.16,
      ease: "power1.out",
      onComplete: () => {
        setActiveWorkspace(nextWorkspace);
        requestAnimationFrame(() => {
          gsap.fromTo(
            workspace,
            { autoAlpha: 0, y: 14 },
            { autoAlpha: 1, y: 0, duration: 0.38, ease: "power3.out" },
          );
        });
      },
    });
  }

  function getDraftTemplateFile(file = templateFile) {
    const buffer = annotatedTemplateBufferRef.current;
    return buffer && file ? { ...file, buffer: buffer.slice(0), size: formatFileSize(buffer.byteLength) } : file;
  }

  function getDraftFilledTemplateFile(file = filledTemplateFile) {
    return filledTemplateDraftFileRef.current || file || null;
  }

  function clearFilledTemplateDraft() {
    filledTemplateBufferRef.current = null;
    filledTemplateDraftFileRef.current = null;
    setFilledTemplateFile(null);
  }

  function syncAnnotatedOfficeDocument(fieldsSnapshot, sourceOfficeDocId = templateOfficeDocId) {
    if (!sourceOfficeDocId || !templateFile?.buffer) return;
    const officeDocId = sourceOfficeDocId;
    const sourcePreviewId = templateFile.previewId;
    const baselineBuffer = annotatedTemplateBufferRef.current || templateFile.buffer;
    window.clearTimeout(annotateSyncTimerRef.current);
    annotateSyncTimerRef.current = window.setTimeout(async () => {
      try {
        const buffer = await waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer);
        if (!buffer) return;
        if (templateFileRef.current?.previewId !== sourcePreviewId) return;
        annotatedTemplateBufferRef.current = buffer.slice(0);
        setTemplateFile((file) =>
          file?.buffer && file.previewId === sourcePreviewId ? { ...file, buffer: buffer.slice(0), size: formatFileSize(buffer.byteLength) } : file,
        );
        console.log("[annotate] synced highlighted docx", { id: officeDocId, bytes: buffer.byteLength });
        await saveDraftState({
          activeWorkspace: "annotate",
          templateFile: getDraftTemplateFile({ ...templateFile, buffer }),
          templateFields: fieldsSnapshot,
          fillFields,
          materialFiles,
          selectedFieldId,
          citationFieldId,
          annotatePreviewPage,
          fillPreviewPage,
          selectedProjectKnowledgeBaseIds,
          selectedGlobalKnowledgeBaseIds,
        });
      } catch {
        // Annotation persistence is best effort; field creation should stay instant.
      }
    }, 1800);
  }

  function queueFilledOfficeDocumentSync(fieldsSnapshot = enrichedFillFieldsRef.current) {
    if (!templateFile?.buffer) return;
    window.clearTimeout(fillSyncTimerRef.current);
    fillSyncTimerRef.current = window.setTimeout(async () => {
      try {
        let buffer = await requestOnlyOfficeDocumentDownloadAs("docx", 15000);
        if (!buffer && fillOfficeDocId) {
          requestOnlyOfficeDocumentSave("fill-sync");
          buffer =
            (await waitForChangedOfficeDocumentBuffer(fillOfficeDocId, filledTemplateBufferRef.current || templateFile.buffer, {
              timeoutMs: 9000,
              intervalMs: 600,
              initialDelayMs: 600,
            })) || (await fetchOfficeDocumentBuffer(fillOfficeDocId));
        }
        if (!buffer) return;
        const baseFile = filledTemplateDraftFileRef.current || filledTemplateFile || templateFile;
        const filledFile = {
          ...baseFile,
          previewId: baseFile.previewId || createPreviewId("filled"),
          name: baseFile.name || templateFile.name,
          uploadedAt: baseFile.uploadedAt || templateFile.uploadedAt,
          supported: true,
          buffer: buffer.slice(0),
          size: formatFileSize(buffer.byteLength),
        };
        filledTemplateBufferRef.current = buffer.slice(0);
        filledTemplateDraftFileRef.current = filledFile;
        setFilledTemplateFile(filledFile);
        await saveDraftState({
          activeWorkspace: "fill",
          templateFile: getDraftTemplateFile(),
          filledTemplateFile: filledFile,
          templateFields,
          fillFields: fieldsSnapshot,
          materialFiles,
          selectedFieldId,
          citationFieldId,
          annotatePreviewPage,
          fillPreviewPage,
          selectedProjectKnowledgeBaseIds,
          selectedGlobalKnowledgeBaseIds,
        });
        console.log("[fill] synced filled docx", { bytes: buffer.byteLength, fields: fieldsSnapshot.length });
      } catch {
        // Fill persistence is best effort; the visible OnlyOffice document should keep working.
      }
    }, 1000);
  }

  function startNewAnnotatedTemplate() {
    clearDraftState();
    annotatedTemplateBufferRef.current = null;
    setTemplateFile(null);
    setTemplateFields([]);
    setTemplateOfficeDocId("");
    setSelectedTemplateFieldId("");
    setAnnotatePreviewPage(1);
    setBrushActive(true);
    setSaveState("idle");
    setFillFields([]);
    setMaterialFiles([]);
    clearFilledTemplateDraft();
    setFillOfficeDocId("");
    setFillFieldPageMap({});
    setSelectedFieldId("");
    setCitationFieldId("");
    setActiveModule("workspace");
    setActiveWorkspace("annotate");
  }

  function openTemplateManagement() {
    const workspace = appRef.current?.querySelector(".workspace-body");
    if (!workspace) {
      setActiveModule("template-management");
      return;
    }

    gsap.to(workspace, {
      autoAlpha: 0,
      y: 10,
      duration: 0.14,
      ease: "power1.out",
      onComplete: () => {
        setActiveModule("template-management");
        requestAnimationFrame(() => {
          gsap.fromTo(workspace, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: "power3.out" });
        });
      },
    });
  }

  function openKnowledgeManagement() {
    const workspace = appRef.current?.querySelector(".workspace-body");
    if (!workspace) {
      setActiveModule("knowledge-management");
      return;
    }

    gsap.to(workspace, {
      autoAlpha: 0,
      y: 10,
      duration: 0.14,
      ease: "power1.out",
      onComplete: () => {
        setActiveModule("knowledge-management");
        requestAnimationFrame(() => {
          gsap.fromTo(workspace, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: "power3.out" });
        });
      },
    });
  }

  function openSettings() {
    const workspace = appRef.current?.querySelector(".workspace-body");
    if (!workspace) {
      setActiveModule("settings");
      return;
    }

    gsap.to(workspace, {
      autoAlpha: 0,
      y: 10,
      duration: 0.18,
      ease: "power1.out",
      onComplete: () => {
        setActiveModule("settings");
        requestAnimationFrame(() => {
          gsap.fromTo(workspace, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: "power3.out" });
        });
      },
    });
  }

  async function refreshKnowledgeBases() {
    const bases = await readKnowledgeBases();
    setKnowledgeBases(bases);
    setSelectedKnowledgeBaseId((current) => {
      if (current && bases.some((base) => base.id === current)) return current;
      return bases.find((base) => base.scope === "project")?.id || bases[0]?.id || "";
    });
  }

  async function createKnowledgeBase(payload) {
    const created = await postKnowledgeBase(payload);
    await refreshKnowledgeBases();
    setSelectedKnowledgeBaseId(created.id);
  }

  async function uploadKnowledgeDocuments(kbId, files) {
    const materials = await Promise.all([...files].map(readKnowledgeDocumentFile));
    for (const material of materials) {
      await postKnowledgeDocument(kbId, material);
    }
    await refreshKnowledgeBases();
    return materials.length;
  }

  async function deleteKnowledgeDocument(kbId, documentId) {
    await removeKnowledgeDocument(kbId, documentId);
    await refreshKnowledgeBases();
  }

  async function deleteKnowledgeBase(kbId) {
    await removeKnowledgeBase(kbId);
    if (selectedKnowledgeBaseId === kbId) setSelectedKnowledgeBaseId("");
    setSelectedProjectKnowledgeBaseIds((ids) => ids.filter((id) => id !== kbId));
    setSelectedGlobalKnowledgeBaseIds((ids) => ids.filter((id) => id !== kbId));
    await refreshKnowledgeBases();
  }

  async function uploadTemplate(file) {
    if (!file) return;
    const isDocx = /\.(docx)$/i.test(file.name);
    const buffer = isDocx ? await file.arrayBuffer() : null;
    annotatedTemplateBufferRef.current = null;
    clearFilledTemplateDraft();
    setTemplateFile({
      previewId: createPreviewId("template"),
      name: file.name,
      size: formatFileSize(file.size),
      uploadedAt: "刚刚上传",
      buffer,
      supported: isDocx,
    });
    setTemplateFields([]);
    setTemplateOfficeDocId("");
    setSelectedTemplateFieldId("");
    setAnnotatePreviewPage(1);
    setBrushActive(true);
    setSaveState(isDocx ? "uploaded" : "unsupported");
  }

  function markSlot(target = {}) {
    if (!templateFile?.buffer) {
      setSaveState("no-file");
      return;
    }

    const presetSlot = target.slotId ? documentSlots.find((item) => item.id === target.slotId) : null;
    const slot = presetSlot ?? createDynamicSlot(target, templateFields.length + 1);

    const existingField = templateFields.find((field) => field.slotId === slot.id);
    if (existingField) {
      setSelectedTemplateFieldId(existingField.id);
      return existingField.id;
    }

    const fieldType = slot.defaultType === "单选项" ? "单选项" : brushType;
    const nextField = createAnnotatedField(slot, getNextFieldNumber(templateFields), fieldType);
    const nextFields = [...templateFields, nextField];
    setTemplateFields(nextFields);
    setSelectedTemplateFieldId(nextField.id);
    setSaveState("dirty");
    requestOnlyOfficeAddFieldBookmark(nextField);
    syncAnnotatedOfficeDocument(nextFields, target.officeDocId);
    return nextField.id;
  }

  function updateTemplateField(patch) {
    if (!selectedTemplateFieldId) return;
    setTemplateFields((fields) =>
      fields.map((field) =>
        field.id === selectedTemplateFieldId ? { ...field, ...patch } : field,
      ),
    );
    setSaveState("dirty");
  }

  function addInputPointForTemplateField(fieldId) {
    const field = templateFields.find((item) => item.id === fieldId);
    if (!field) return;
    setSelectedTemplateFieldId(field.id);
    requestOnlyOfficeAddInputPoint(field);
  }

  function applyTemplateInputPoint(result) {
    if (!result?.ok) {
      window.alert(result?.error || "输入点设置失败，请把光标放到填写位置后重试。");
      return;
    }
    const targetId = result.id || selectedTemplateFieldId;
    const nextFields = templateFields.map((field) =>
      field.id === targetId
        ? {
            ...field,
            inputPoint: {
              kind: "office-caret",
              bookmarkName: result.bookmarkName,
              page: result.page || field.page || 1,
            },
          }
        : field,
    );
    setTemplateFields(nextFields);
    setSelectedTemplateFieldId(targetId);
    setSaveState("dirty");
    syncAnnotatedOfficeDocument(nextFields);
  }

  function removeTemplateField(fieldId) {
    removePreviewMarker(fieldId);
    const nextFields = templateFields.filter((field) => field.id !== fieldId);
    setTemplateFields(nextFields);
    if (selectedTemplateFieldId === fieldId) {
      setSelectedTemplateFieldId(nextFields.find((field) => (field.page || 1) === annotatePreviewPage)?.id ?? "");
    }
    setSaveState("dirty");
  }

  function clearAnnotations() {
    clearPreviewMarkers();
    setTemplateFields([]);
    setSelectedTemplateFieldId("");
    setSaveState("dirty");
  }

  async function saveTemplate(category) {
    if (!templateFile) {
      setSaveState("no-file");
      return;
    }

    if (!templateFile.buffer) {
      setSaveState("no-file");
      return;
    }

    const invalidFields = templateFields.filter((field) => !getTemplateFieldSourceText(field) || !(field.category || field.type || "").trim());
    const hasPendingFields = templateFields.some((field) => field.status !== "已标注");
    const isComplete = templateFields.length > 0 && invalidFields.length === 0 && !hasPendingFields;

    if (!isComplete) {
      setSaveState("incomplete");
      return;
    }

    setSaveState("saving");
    let fileBuffer = (annotatedTemplateBufferRef.current || templateFile.buffer).slice(0);
    if (templateOfficeDocId) {
      try {
        let officeBuffer = await requestOnlyOfficeDocumentDownloadAs("docx");
        if (!officeBuffer) {
          requestOnlyOfficeDocumentSave("save-template");
          officeBuffer =
            (await waitForChangedOfficeDocumentBuffer(templateOfficeDocId, fileBuffer, { timeoutMs: 10000, intervalMs: 500, initialDelayMs: 600 })) ||
            (await fetchOfficeDocumentBuffer(templateOfficeDocId));
        }
        if (!officeBuffer) {
          setSaveState("storage-error");
          return;
        }
        fileBuffer = officeBuffer;
        annotatedTemplateBufferRef.current = officeBuffer.slice(0);
        setTemplateFile((file) => (file?.buffer ? { ...file, buffer: officeBuffer.slice(0), size: formatFileSize(officeBuffer.byteLength) } : file));
      } catch {
        setSaveState("storage-error");
        return;
      }
    }

    const normalizedTemplateFields = templateFields.map(normalizeTemplateFieldForRuntime);

    const savedTemplate = {
      id: `TPL-${Date.now()}`,
      name: templateFile.name.replace(/\.(docx|doc)$/i, ""),
      category: normalizeTemplateCategory(category || inferTemplateCategory(templateFile.name)),
      fileName: templateFile.name,
      fileSize: formatFileSize(fileBuffer.byteLength),
      savedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      savedAtMs: Date.now(),
      uploadedAt: templateFile.uploadedAt,
      supported: templateFile.supported,
      fieldCount: normalizedTemplateFields.length,
      confirmedCount: normalizedTemplateFields.filter((field) => field.status === "已标注").length,
      typeSummary: summarizeFieldTypes(normalizedTemplateFields),
      fields: normalizedTemplateFields,
      fileBuffer,
    };

    try {
      const nextTemplates = [savedTemplate, ...templateLibrary.filter((item) => item.fileName !== templateFile.name)];
      await storeTemplates(nextTemplates);
      setTemplateLibrary(nextTemplates);
    } catch {
      setSaveState("storage-error");
      return;
    }

    setTemplateFields(normalizedTemplateFields);
    setFillFields(createFillFieldsFromTemplate(normalizedTemplateFields, fillFields));
    setSelectedFieldId(normalizedTemplateFields[0]?.id ?? "");
    setCitationFieldId(normalizedTemplateFields[0]?.id ?? "");
    await saveDraftState({
      activeWorkspace: "annotate",
      templateFile: getDraftTemplateFile({ ...templateFile, buffer: fileBuffer, size: formatFileSize(fileBuffer.byteLength) }),
      templateFields: normalizedTemplateFields,
      fillFields,
      materialFiles,
      selectedFieldId,
      citationFieldId,
      annotatePreviewPage,
      fillPreviewPage,
      selectedProjectKnowledgeBaseIds,
      selectedGlobalKnowledgeBaseIds,
    });
    setSaveState("saved");
  }

  async function useTemplate(template) {
    const storedTemplate = await readStoredTemplate(template.id);
    const templateToUse = storedTemplate ?? template;
    const templateFieldsToUse = (templateToUse.fields || []).map(normalizeTemplateFieldForRuntime);
    const mappedFields = createFillFieldsFromTemplate(templateFieldsToUse);
    setTemplateFields(templateFieldsToUse);
    clearFilledTemplateDraft();
    if (templateToUse.fileBuffer) {
      annotatedTemplateBufferRef.current = null;
      setTemplateFile({
        previewId: createPreviewId("template"),
        name: templateToUse.fileName,
        size: templateToUse.fileSize,
        uploadedAt: templateToUse.uploadedAt || templateToUse.savedAt,
        buffer: templateToUse.fileBuffer.slice(0),
        supported: templateToUse.supported !== false,
      });
      setTemplateOfficeDocId("");
      setAnnotatePreviewPage(1);
    } else {
      setTemplateFile(null);
      setSaveState("no-file");
    }
    setFillFields(mappedFields);
    setFillFieldPageMap({});
    setSelectedFieldId(mappedFields[0]?.id ?? "");
    setCitationFieldId(mappedFields[0]?.id ?? "");
    setFillPreviewPage(mappedFields[0]?.page || 1);
    setActiveModule("workspace");
    setActiveWorkspace("fill");
  }

  async function editTemplate(template) {
    const storedTemplate = await readStoredTemplate(template.id);
    const templateToEdit = storedTemplate ?? template;
    const fields = (templateToEdit.fields || []).map(normalizeTemplateFieldForRuntime);
    setTemplateFields(fields);
    clearFilledTemplateDraft();
    setFillFieldPageMap({});
    if (templateToEdit.fileBuffer) {
      annotatedTemplateBufferRef.current = null;
      setTemplateFile({
        previewId: createPreviewId("template"),
        name: templateToEdit.fileName,
        size: templateToEdit.fileSize,
        uploadedAt: templateToEdit.uploadedAt || templateToEdit.savedAt,
        buffer: templateToEdit.fileBuffer.slice(0),
        supported: templateToEdit.supported !== false,
      });
      setTemplateOfficeDocId("");
      setSaveState("saved");
    } else {
      setTemplateFile(null);
      setSaveState("no-file");
    }
    setSelectedTemplateFieldId(fields[0]?.id ?? "");
    setAnnotatePreviewPage(fields[0]?.page || 1);
    setBrushActive(true);
    setActiveModule("workspace");
    setActiveWorkspace("annotate");
  }

  async function deleteTemplate(templateId) {
    const nextTemplates = templateLibrary.filter((template) => template.id !== templateId);
    try {
      await storeTemplates(nextTemplates);
      setTemplateLibrary(nextTemplates);
    } catch {
      setSaveState("storage-error");
    }
  }

  async function updateTemplateCategory(templateId, category) {
    const nextTemplates = templateLibrary.map((template) =>
      template.id === templateId ? { ...template, category: normalizeTemplateCategory(category) } : template,
    );
    try {
      await storeTemplates(nextTemplates);
      setTemplateLibrary(nextTemplates);
    } catch {
      setSaveState("storage-error");
    }
  }

  async function storeAuditTemplate(file, category) {
    if (!file?.buffer) throw new Error("当前没有可保存的修订文件");
    const savedAtMs = Date.now();
    const savedTemplate = {
      id: `TPL-AUDIT-${savedAtMs}`,
      name: file.name.replace(/\.(docx|doc)$/i, ""),
      category: normalizeTemplateCategory(category),
      fileName: file.name,
      fileSize: file.size || formatFileSize(file.buffer.byteLength || 0),
      savedAt: new Date(savedAtMs).toLocaleString("zh-CN", { hour12: false }),
      savedAtMs,
      uploadedAt: file.uploadedAt || "格式审核生成",
      supported: true,
      fieldCount: 0,
      confirmedCount: 0,
      typeSummary: [{ type: "格式修订模板", count: 1 }],
      fields: [],
      source: "format-audit",
      fileBuffer: file.buffer.slice(0),
    };
    const nextTemplates = [savedTemplate, ...templateLibrary.filter((item) => item.fileName !== savedTemplate.fileName)];
    await storeTemplates(nextTemplates);
    setTemplateLibrary(nextTemplates);
    return savedTemplate;
  }

  async function uploadMaterials(files, options = {}) {
    const fileList = [...files];
    if (fileList.length === 0) return;
    const nextFiles = await Promise.all(fileList.map(readMaterialFile));
    setMaterialFiles((items) => [...nextFiles, ...items].slice(0, 10));

    if (options.persistToKnowledge) {
      const kb = await ensureFillProjectKnowledgeBase();
      const knowledgeMaterials = await Promise.all(fileList.map(readKnowledgeDocumentFile));
      for (const material of knowledgeMaterials) {
        await postKnowledgeDocument(kb.id, material);
      }
      await refreshKnowledgeBases();
      const uploadedNames = new Set(knowledgeMaterials.map((item) => item.name));
      setMaterialFiles((items) =>
        items.map((item) =>
          uploadedNames.has(item.name)
            ? { ...item, storage: "knowledge", knowledgeBaseName: kb.name }
            : item,
        ),
      );
    }
  }

  function removeMaterial(materialId) {
    setMaterialFiles((items) => items.filter((item) => item.id !== materialId));
  }

  async function ensureFillProjectKnowledgeBase() {
    const bases = await readKnowledgeBases();
    const selected = bases.find((base) => selectedProjectKnowledgeBaseIds.includes(base.id) && base.scope !== "global");
    if (selected) return selected;
    const projectBases = bases.filter((base) => base.scope === "project" && (base.projectId || currentProjectId) === currentProjectId);
    const existing = projectBases[0];
    if (existing) {
      setSelectedProjectKnowledgeBaseIds([existing.id]);
      return existing;
    }
    const createdName = `${templateFile?.name ? templateFile.name.replace(/\.[^.]+$/, "") : "临时项目"}资料库`;
    const created = await postKnowledgeBase({ name: createdName, scope: "project", projectId: currentProjectId });
    setSelectedProjectKnowledgeBaseIds([created.id]);
    return created;
  }

  async function fillFieldWithAI(fieldId, fieldsSnapshot = enrichedFillFields) {
    const targetField = fieldsSnapshot.find((field) => field.id === fieldId);
    const templateField = templateFields.find((field) => field.id === fieldId);
    if (!targetField) return;
    const contractField = { ...targetField, ...templateField };

    if (requiresInputPoint(contractField) && !hasInputPoint(contractField)) {
      setSelectedFieldId(fieldId);
      setFillFields((fields) =>
        fields.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                status: "需补充资料",
                confidence: 0,
                source: "缺少输入点",
                evidence: "该字段是填空写入字段，请先在模板标注工作台把光标放到实际填写位置并添加输入点。",
              }
            : field,
        ),
      );
      return;
    }

    setSelectedFieldId(fieldId);
    setShowCitations(false);
    setFillFields((fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, status: "生成中" } : field)),
    );

    try {
      const aiCategory = normalizeFieldCategory(templateField?.category || templateField?.type || targetField.category || targetField.type);
      const aiFillMode = normalizeFillMode(templateField?.fillMode || targetField.fillMode, { ...targetField, ...templateField, category: aiCategory, type: aiCategory });
      const response = await fetch("/api/ai/fill-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: {
            ...targetField,
            sourceText: getTemplateFieldSourceText(templateField || targetField),
            category: aiCategory,
            type: aiCategory,
            fillMode: aiFillMode,
            writeMode: isReplacementField(contractField) ? "replace-selection" : "insert-at-input-point",
            hasInputPoint: hasInputPoint(contractField),
            inputPoint: templateField?.inputPoint || targetField.inputPoint || null,
            answerFormat: templateField?.answerFormat,
            aiInstruction: templateField?.aiInstruction,
            question: templateField?.question,
            templateContext: getTemplateFieldSourceText(templateField || targetField) || targetField.answerFormat || "",
          },
          materials: materialFiles,
          knowledgeOptions: {
            enabled: selectedProjectKnowledgeBaseIds.length > 0,
            projectId: currentProjectId,
            kbIds: [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds],
            topK: knowledgeTopK,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "AI 填充失败");
      }
      const appliedField = {
        ...targetField,
        value: result.value || "",
        amountValue: result.amountValue || "",
        choiceValue: result.choiceValue || "",
        status: result.status || (result.value ? "待确认" : "需补充资料"),
        confidence: result.confidence || 0,
        source: result.source || "AI 基于上传资料生成",
        evidence: result.evidence || "AI 未返回明确证据。",
      };
      const nextFieldsSnapshot = enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? appliedField : field));
      setFillFields((fields) =>
        fields.map((field) =>
          field.id === fieldId
            ? appliedField
            : field,
        ),
      );
      requestOnlyOfficeFillField(appliedField);
      queueFilledOfficeDocumentSync(nextFieldsSnapshot);
    } catch (error) {
      setFillFields((fields) =>
        fields.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                status: "需补充资料",
                confidence: 0,
                source: "AI 填充失败",
                evidence: error.message || "请检查模型配置、网络或上传资料。",
              }
            : field,
        ),
      );
    }
  }

  async function generateField(fieldId) {
    await fillFieldWithAI(fieldId);
  }

  async function generateAllFields() {
    const pendingFields = enrichedFillFields.filter((field) => field.status !== "已确认" && field.status !== "生成中");
    if (pendingFields.length === 0 || generatingAll) return;

    setGeneratingAll(true);
    setShowCitations(false);
    try {
      for (const field of pendingFields) {
        await fillFieldWithAI(field.id, enrichedFillFields);
      }
    } finally {
      setGeneratingAll(false);
    }
  }

  function confirmField(fieldId) {
    setFillFields((fields) =>
      fields.map((field) =>
        field.id === fieldId && field.status !== "需补充资料"
          ? { ...field, status: "已确认" }
          : field,
      ),
    );
  }

  function updateFillFieldValue(fieldId, value) {
    const targetField = enrichedFillFieldsRef.current.find((field) => field.id === fieldId);
    const appliedField = targetField
      ? {
          ...targetField,
          value,
          status: value.trim() ? "待确认" : "未填充",
          confidence: targetField.confidence || 100,
          source: "人工修改",
          evidence: value.trim() ? "用户对 AI 填充内容进行了人工修改。" : "用户清空了填充内容。",
        }
      : null;
    if (appliedField && value.trim()) {
      requestOnlyOfficeFillField(appliedField);
      queueFilledOfficeDocumentSync(enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? appliedField : field)));
    }
    setFillFields((fields) =>
      fields.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              value,
              status: value.trim() ? "待确认" : "未填充",
              confidence: field.confidence || 100,
              source: "人工修改",
              evidence: value.trim() ? "用户对 AI 填充内容进行了人工修改。" : "用户清空了填充内容。",
            }
          : field,
      ),
    );
  }

  function openCitation(fieldId) {
    setCitationFieldId(fieldId);
    setShowCitations(true);
  }

  return (
    <div className="app-shell" ref={appRef}>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <button className="icon-button" aria-label="展开菜单">
            <Menu size={20} />
          </button>
          <div>
            <strong>招标文件智能体</strong>
            <span>Bid Agent</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <SidebarItem
            icon={LayoutDashboard}
            label="工作台"
            active={activeModule === "workspace"}
            expanded={workspaceNavOpen}
            hasChildren
            onClick={() => setWorkspaceNavOpen((open) => !open)}
          />
          {workspaceNavOpen ? (
            <div className="nav-children">
              <button
                className={activeModule === "workspace" && activeWorkspace === "annotate" ? "child-link active" : "child-link"}
                onClick={() => animateWorkspace("annotate")}
              >
                模板标注工作台
              </button>
              <button
                className={activeModule === "workspace" && activeWorkspace === "fill" ? "child-link active" : "child-link"}
                onClick={() => animateWorkspace("fill")}
              >
                填充确认工作台
              </button>
              <button
                className={activeModule === "workspace" && activeWorkspace === "audit" ? "child-link active" : "child-link"}
                onClick={() => animateWorkspace("audit")}
              >
                格式审核工作台
              </button>
            </div>
          ) : null}
          <SidebarItem icon={Archive} label="模板管理" active={activeModule === "template-management"} onClick={openTemplateManagement} />
          <SidebarItem icon={BookOpenText} label="知识库管理" active={activeModule === "knowledge-management"} onClick={openKnowledgeManagement} />
          <SidebarItem
            icon={Settings}
            label="系统设置"
            active={activeModule === "settings"}
            expanded={settingsNavOpen}
            hasChildren
            onClick={() => setSettingsNavOpen((open) => !open)}
          />
          {settingsNavOpen ? (
            <div className="nav-children">
              <button className={activeModule === "settings" ? "child-link active" : "child-link"} onClick={openSettings}>
                模型配置
              </button>
            </div>
          ) : null}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span>当前项目：</span>
            <strong>XX市政道路改造工程项目</strong>
            <ChevronDown size={16} />
          </div>
          <div className="topbar-actions">
            <button className="ghost-button topbar-action">
              <ShieldCheck size={17} />
              模板版本 v1.2
            </button>
            <button className="ghost-button topbar-action">
              <MessageSquareText size={17} />
              审阅意见 3
            </button>
            <button className="avatar-button topbar-action">张工</button>
          </div>
        </header>

        <section className="workspace">
          <div className="workspace-head">
            <div>
              <p className="eyebrow">BS 架构工作台</p>
              <h1>{workspaceTitle}</h1>
            </div>
            {activeModule === "workspace" ? (
              <div className="workspace-tabs" role="tablist" aria-label="工作台切换">
                <button
                  className={activeWorkspace === "annotate" ? "tab active" : "tab"}
                  data-testid="tab-annotate"
                  onClick={() => animateWorkspace("annotate")}
                >
                  模板标注工作台
                </button>
                <button
                  className={activeWorkspace === "fill" ? "tab active" : "tab"}
                  data-testid="tab-fill"
                  onClick={() => animateWorkspace("fill")}
                >
                  填充确认工作台
                </button>
                <button
                  className={activeWorkspace === "audit" ? "tab active" : "tab"}
                  data-testid="tab-audit"
                  onClick={() => animateWorkspace("audit")}
                >
                  格式审核工作台
                </button>
              </div>
            ) : null}
          </div>

          <div className="workspace-body">
            {activeModule === "template-management" ? (
              <TemplateManagement
                templates={templateLibrary}
                onUseTemplate={useTemplate}
                onEditTemplate={editTemplate}
                onDeleteTemplate={deleteTemplate}
                onUpdateCategory={updateTemplateCategory}
                onCreateTemplate={startNewAnnotatedTemplate}
              />
            ) : activeModule === "knowledge-management" ? (
              <KnowledgeBaseManagement
                knowledgeBases={knowledgeBases}
                selectedKnowledgeBaseId={selectedKnowledgeBaseId}
                projectId={currentProjectId}
                onSelectKnowledgeBase={setSelectedKnowledgeBaseId}
                onCreateKnowledgeBase={createKnowledgeBase}
                onUploadDocuments={uploadKnowledgeDocuments}
                onDeleteKnowledgeBase={deleteKnowledgeBase}
                onDeleteDocument={deleteKnowledgeDocument}
                onRefresh={refreshKnowledgeBases}
              />
            ) : activeModule === "settings" ? (
              <SystemSettings />
            ) : activeWorkspace === "audit" ? (
              <FormatAuditWorkspace onStoreTemplate={storeAuditTemplate} />
            ) : activeWorkspace === "annotate" ? (
              <AnnotateWorkspace
                templateFile={templateFile}
                fields={templateFields}
                selectedField={selectedTemplateField}
                selectedFieldId={selectedTemplateFieldId}
                brushActive={brushActive}
                saveState={saveState}
                currentPage={annotatePreviewPage}
                onUploadTemplate={uploadTemplate}
                onSaveTemplate={saveTemplate}
                onPreviewPageChange={setAnnotatePreviewPage}
                onSlotClick={markSlot}
                onSelectField={setSelectedTemplateFieldId}
                onUpdateField={updateTemplateField}
                onRemoveField={removeTemplateField}
                onAddInputPoint={addInputPointForTemplateField}
                onInputPointCaptured={applyTemplateInputPoint}
                onOfficeDocumentReady={setTemplateOfficeDocId}
              />
            ) : (
              <FillWorkspace
                fields={enrichedFillFields}
                templateFile={fillPreviewFile}
                sourceTemplateFile={templateFile}
                selectedFieldId={selectedFieldId}
                materialFiles={materialFiles}
                currentPage={fillPreviewPage}
                fieldPageMap={fillFieldPageMap}
                officeDocId={fillOfficeDocId}
                onPreviewPageChange={setFillPreviewPage}
                onFieldPagesChange={setFillFieldPageMap}
                onSelectField={setSelectedFieldId}
                onUploadMaterials={uploadMaterials}
                onRemoveMaterial={removeMaterial}
                onOfficeDocumentReady={setFillOfficeDocId}
                onGenerate={generateField}
                onGenerateAll={generateAllFields}
                generatingAll={generatingAll}
                knowledgeBases={knowledgeBases}
                selectedProjectKnowledgeBaseIds={selectedProjectKnowledgeBaseIds}
                selectedGlobalKnowledgeBaseIds={selectedGlobalKnowledgeBaseIds}
                knowledgeTopK={knowledgeTopK}
                onSelectedProjectKnowledgeBaseChange={setSelectedProjectKnowledgeBaseIds}
                onSelectedGlobalKnowledgeBaseChange={setSelectedGlobalKnowledgeBaseIds}
                onKnowledgeTopKChange={setKnowledgeTopK}
                onUpdateValue={updateFillFieldValue}
                onConfirm={confirmField}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, expanded, hasChildren, onClick }) {
  return (
    <button className={active ? "sidebar-item active" : "sidebar-item"} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
      {hasChildren ? expanded ? <ChevronDown size={15} className="item-chevron" /> : <ChevronRight size={15} className="item-chevron" /> : null}
    </button>
  );
}

const emptyModelConfig = {
  provider: "local",
  local: { baseUrl: "", model: "", apiKey: "" },
  cloud: { baseUrl: "", model: "", apiKey: "" },
  embedding: { baseUrl: "", model: "", apiKey: "", dimension: "1024", timeoutMs: "60000" },
};

function SystemSettings() {
  const [config, setConfig] = useState(emptyModelConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activeRuntime = config.provider === "cloud" ? config.cloud : config.local;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/model")
      .then((response) => {
        if (!response.ok) throw new Error("读取模型配置失败");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setConfig(mergeModelConfig(data));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "读取模型配置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateSection(section, key, value) {
    setConfig((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  }

  async function saveConfig() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "保存模型配置失败");
      setConfig(mergeModelConfig(data.config || config));
      setMessage("配置已保存，后端当前进程已生效。");
    } catch (err) {
      setError(err.message || "保存模型配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConfig(target) {
    setTesting(target);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, config }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "连接测试失败");
      setMessage(data.message || "连接测试通过。");
    } catch (err) {
      setError(err.message || "连接测试失败");
    } finally {
      setTesting("");
    }
  }

  return (
    <section className="settings-manager">
      <div className="manager-toolbar">
        <div>
          <h2>系统设置</h2>
          <p>配置 AI 填充模型与知识库 Embedding 服务，支持本地 OpenAI-compatible 服务和云端 API。</p>
        </div>
        <button className="tool-button primary" onClick={saveConfig} disabled={loading || saving}>
          {saving ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
          保存配置
        </button>
      </div>

      {message ? <div className="settings-message ok"><Check size={16} />{message}</div> : null}
      {error ? <div className="settings-message error"><CircleAlert size={16} />{error}</div> : null}

      <div className="settings-grid">
        <section className="settings-card provider-card">
          <div className="settings-card-title">
            <Settings size={18} />
            <div>
              <h3>当前填充模型</h3>
              <span>{activeRuntime.baseUrl || "未配置 Base URL"} · {activeRuntime.model || "未配置模型"}</span>
            </div>
          </div>
          <div className="provider-switch" role="tablist" aria-label="模型来源">
            <button
              className={config.provider === "local" ? "provider-option active" : "provider-option"}
              onClick={() => setConfig((current) => ({ ...current, provider: "local" }))}
              type="button"
            >
              本地模型
            </button>
            <button
              className={config.provider === "cloud" ? "provider-option active" : "provider-option"}
              onClick={() => setConfig((current) => ({ ...current, provider: "cloud" }))}
              type="button"
            >
              云端 API
            </button>
          </div>
          <button className="tool-button" onClick={() => testConfig("llm")} disabled={loading || Boolean(testing)}>
            {testing === "llm" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            测试当前模型
          </button>
        </section>

        <ModelRuntimeCard
          title="本地模型"
          desc="适配 llama-server、vLLM、Ollama 兼容网关等 /v1 接口。"
          runtime={config.local}
          active={config.provider === "local"}
          onChange={(key, value) => updateSection("local", key, value)}
        />

        <ModelRuntimeCard
          title="云端 API"
          desc="适配 DeepSeek、OpenAI-compatible 云服务。"
          runtime={config.cloud}
          active={config.provider === "cloud"}
          onChange={(key, value) => updateSection("cloud", key, value)}
        />

        <section className="settings-card embedding-card">
          <div className="settings-card-title">
            <Database size={18} />
            <div>
              <h3>Embedding 服务</h3>
              <span>知识库向量化与语义检索使用</span>
            </div>
          </div>
          <SettingsField label="Base URL" value={config.embedding.baseUrl} placeholder="http://127.0.0.1:8000/v1" onChange={(value) => updateSection("embedding", "baseUrl", value)} />
          <SettingsField label="模型名称" value={config.embedding.model} placeholder="BAAI/bge-m3" onChange={(value) => updateSection("embedding", "model", value)} />
          <SettingsField label="API Key" type="password" value={config.embedding.apiKey} placeholder="本地服务通常可留空" onChange={(value) => updateSection("embedding", "apiKey", value)} />
          <div className="settings-two-col">
            <SettingsField label="向量维度" value={config.embedding.dimension} placeholder="1024" onChange={(value) => updateSection("embedding", "dimension", value)} />
            <SettingsField label="超时 ms" value={config.embedding.timeoutMs} placeholder="60000" onChange={(value) => updateSection("embedding", "timeoutMs", value)} />
          </div>
          <button className="tool-button" onClick={() => testConfig("embedding")} disabled={loading || Boolean(testing)}>
            {testing === "embedding" ? <Loader2 size={16} className="spin" /> : <Database size={16} />}
            测试 Embedding
          </button>
        </section>
      </div>
    </section>
  );
}

function ModelRuntimeCard({ title, desc, runtime, active, onChange }) {
  return (
    <section className={active ? "settings-card active" : "settings-card"}>
      <div className="settings-card-title">
        <Sparkles size={18} />
        <div>
          <h3>{title}</h3>
          <span>{desc}</span>
        </div>
      </div>
      <SettingsField label="Base URL" value={runtime.baseUrl} placeholder="http://127.0.0.1:8129/v1" onChange={(value) => onChange("baseUrl", value)} />
      <SettingsField label="模型名称" value={runtime.model} placeholder="qwen3.6-35b-a3b" onChange={(value) => onChange("model", value)} />
      <SettingsField label="API Key" type="password" value={runtime.apiKey} placeholder="本地服务可留空，云端必填" onChange={(value) => onChange("apiKey", value)} />
    </section>
  );
}

function SettingsField({ label, value, placeholder, type = "text", onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
    </label>
  );
}

function mergeModelConfig(data = {}) {
  return {
    provider: data.provider === "cloud" ? "cloud" : "local",
    local: { ...emptyModelConfig.local, ...(data.local || {}) },
    cloud: { ...emptyModelConfig.cloud, ...(data.cloud || {}) },
    embedding: { ...emptyModelConfig.embedding, ...(data.embedding || {}) },
  };
}

function TemplateManagement({ templates, onUseTemplate, onEditTemplate, onDeleteTemplate, onUpdateCategory, onCreateTemplate }) {
  const managerRef = useRef(null);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [activeContractFolder, setActiveContractFolder] = useState("全部");

  useGSAP(
    () => {
      const cards = gsap.utils.toArray(".template-card");
      if (cards.length > 0) {
        gsap.fromTo(
          cards,
          { y: 12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.05, ease: "power2.out" },
        );
      }
    },
    { dependencies: [templates.length], scope: managerRef },
  );

  const totalFields = templates.reduce((sum, template) => sum + (template.fieldCount || template.fields?.length || 0), 0);
  const allTypes = new Set(templates.flatMap((template) => (template.fields || []).map((field) => normalizeFieldCategory(field.type || field.category))));
  const normalizedTemplates = templates.map((template) => ({
    ...template,
    category: normalizeTemplateCategory(template.category || inferTemplateCategory(template.name || template.fileName)),
    contractFolder: getContractFolder(template),
  }));
  const categoryTemplates =
    activeCategory === "全部"
      ? normalizedTemplates
      : normalizedTemplates.filter((template) => template.category === activeCategory);
  const contractFolders = buildContractFolders(normalizedTemplates);
  const visibleTemplates =
    activeCategory === "合同类" && activeContractFolder.startsWith("一级:")
      ? categoryTemplates.filter((template) => template.level1 === activeContractFolder.replace("一级:", ""))
      : activeCategory === "合同类" && activeContractFolder !== "全部"
      ? categoryTemplates.filter((template) => template.contractFolder === activeContractFolder)
      : categoryTemplates;
  const contractFolderGroups = groupContractFolders(contractFolders);
  const activeFolder = contractFolders.find((folder) => folder.key === activeContractFolder);
  const activeLevel1 = activeContractFolder.startsWith("一级:")
    ? activeContractFolder.replace("一级:", "")
    : activeFolder?.level1 || contractFolderGroups[0]?.level1 || "";
  const contractSelectValue = activeContractFolder === "全部" ? "全部" : `一级:${activeLevel1}`;
  const activeContractGroup = contractFolderGroups.find((group) => group.level1 === activeLevel1) || contractFolderGroups[0];

  useEffect(() => {
    if (activeCategory !== "合同类") {
      setActiveContractFolder("全部");
      return;
    }
    const hasFolder = contractFolders.some((folder) => folder.key === activeContractFolder);
    const hasLevel1 = contractFolderGroups.some((group) => `一级:${group.level1}` === activeContractFolder);
    if (activeContractFolder !== "全部" && !hasFolder && !hasLevel1) {
      setActiveContractFolder("全部");
    }
  }, [activeCategory, activeContractFolder, contractFolders, contractFolderGroups]);

  return (
    <section className="template-manager" ref={managerRef}>
      <div className="manager-toolbar">
        <div>
          <h2>模板库</h2>
          <p>合同类、招标类、方案类模板统一管理，后续按智能体场景直接调用。</p>
        </div>
        <button className="tool-button solid" onClick={onCreateTemplate}>
          <Highlighter size={17} />
          新建标注模板
        </button>
      </div>

      <div className="manager-summary">
        <div className="summary-card">
          <span>模板数量</span>
          <strong>{templates.length}</strong>
          <em>已保存</em>
        </div>
        <div className="summary-card">
          <span>字段总数</span>
          <strong>{totalFields}</strong>
          <em>可填充字段</em>
        </div>
        <div className="summary-card">
          <span>自动填充类别</span>
          <strong>{allTypes.size}</strong>
          <em>已配置</em>
        </div>
      </div>

      <div className="template-category-tabs">
        {templateCategories.map((category) => {
          const count = category === "全部"
            ? normalizedTemplates.length
            : normalizedTemplates.filter((template) => template.category === category).length;
          return (
            <button
              className={activeCategory === category ? "category-tab active" : "category-tab"}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {activeCategory === "合同类" && contractFolders.length > 0 ? (
        <div className="contract-folder-browser">
          <div className="contract-folder-bar">
            <button
              className={activeContractFolder === "全部" ? "contract-folder all active" : "contract-folder all"}
              onClick={() => setActiveContractFolder("全部")}
            >
              <FolderOpen size={16} />
              全部合同
              <span>{contractFolders.reduce((sum, folder) => sum + folder.count, 0)}</span>
            </button>
            <select value={contractSelectValue} onChange={(event) => setActiveContractFolder(event.target.value)}>
              <option value="全部">全部合同</option>
              {contractFolderGroups.map((group) => (
                <option value={`一级:${group.level1}`} key={group.level1}>{group.level1}（{group.count}）</option>
              ))}
            </select>
          </div>
          {activeContractGroup ? (
            <div className="contract-folder-group">
              <button
                className={activeContractFolder === `一级:${activeContractGroup.level1}` ? "contract-folder level active" : "contract-folder level"}
                onClick={() => setActiveContractFolder(`一级:${activeContractGroup.level1}`)}
              >
                <FolderOpen size={16} />
                {activeContractGroup.level1}
                <span>{activeContractGroup.count}</span>
              </button>
              <div>
                {activeContractGroup.folders.map((folder) => (
                  <button
                    className={activeContractFolder === folder.key ? "contract-folder active" : "contract-folder"}
                    key={folder.key}
                    onClick={() => setActiveContractFolder(folder.key)}
                    title={folder.key}
                  >
                    <FolderOpen size={16} />
                    <span className="folder-name">{folder.level2}</span>
                    <span>{folder.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="template-empty">
          <Archive size={28} />
          <strong>暂无模板</strong>
          <span>在模板标注工作台上传 DOCX、标注字段并设置输入点后，点击保存模板即可入库。</span>
          <button className="tool-button primary" onClick={onCreateTemplate}>
            <Upload size={17} />
            去标注模板
          </button>
        </div>
      ) : (
        <div className="template-grid">
          {visibleTemplates.map((template) => (
            <article className="template-card" key={template.id}>
              <div className="template-card-head">
                <FileCheck2 size={20} />
                <div>
                  <h3>{template.name}</h3>
                  <p>{template.fileName}</p>
                </div>
                <span className={`template-category ${getTemplateCategoryTone(template.category)}`}>{template.category}</span>
              </div>
              {template.category === "合同类" ? (
                <div className="template-folder-path">
                  <FolderOpen size={15} />
                  {template.contractFolder}
                </div>
              ) : null}
              <dl className="template-meta">
                <div>
                  <dt>字段数</dt>
                  <dd>{template.fieldCount || template.fields?.length || 0}</dd>
                </div>
                <div>
                  <dt>已确认</dt>
                  <dd>{template.confirmedCount ?? template.fields?.filter((field) => field.status === "已标注").length ?? 0}</dd>
                </div>
                <div>
                  <dt>文件大小</dt>
                  <dd>{template.fileSize || "--"}</dd>
                </div>
              </dl>
              <div className={template.fileBuffer || template.fileBase64 ? "template-file-state ok" : "template-file-state"}>
                {template.fileBuffer || template.fileBase64
                  ? template.supported === false
                    ? "已保存原始文件（需转换DOCX预览）"
                    : "已持久化 DOCX 文件"
                  : "仅字段配置"}
              </div>
              <label className="template-category-editor">
                <span>模板分类</span>
                <select value={template.category} onChange={(event) => onUpdateCategory(template.id, event.target.value)}>
                  <option>招标类</option>
                  <option>合同类</option>
                  <option>方案类</option>
                </select>
              </label>
              <div className="template-type-list">
                {(template.typeSummary || summarizeFieldTypes(template.fields || [])).map((item) => (
                  <span key={item.type}>{item.type} {item.count}</span>
                ))}
              </div>
              <div className="template-foot">
                <span>保存于 {template.savedAt}</span>
                <div>
                  <button className="mini-button" onClick={() => onEditTemplate(template)}>
                    <Highlighter size={15} />
                    编辑模板
                  </button>
                  <button className="mini-button blue" onClick={() => onUseTemplate(template)}>
                    <Wand2 size={15} />
                    使用模板
                  </button>
                  <button className="icon-button quiet" aria-label={`删除${template.name}`} onClick={() => onDeleteTemplate(template.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
          {visibleTemplates.length === 0 ? (
            <div className="template-empty inline">
              <Archive size={24} />
              <strong>当前分类暂无模板</strong>
              <span>切换其他分类，或在模板标注工作台保存新的{activeCategory}模板。</span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function KnowledgeBaseManagement({
  knowledgeBases,
  selectedKnowledgeBaseId,
  projectId,
  onSelectKnowledgeBase,
  onCreateKnowledgeBase,
  onUploadDocuments,
  onDeleteKnowledgeBase,
  onDeleteDocument,
  onRefresh,
}) {
  const fileInputRef = useRef(null);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseScope, setNewBaseScope] = useState("project");
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [expandedKnowledgeGroups, setExpandedKnowledgeGroups] = useState({ project: true, global: true });
  const selectedBase = knowledgeBases.find((base) => base.id === selectedKnowledgeBaseId) || knowledgeBases[0];
  const selectedResult = searchResults.find((item) => item.id === selectedResultId) || searchResults[0];
  const totalDocuments = knowledgeBases.reduce((sum, base) => sum + (base.documentCount || 0), 0);
  const totalChunks = knowledgeBases.reduce((sum, base) => sum + (base.chunkCount || 0), 0);
  const knowledgeTreeGroups = [
    {
      id: "project",
      name: "专项数据库",
      description: "按专题归集法规资料",
      items: knowledgeBases.filter((base) => base.scope !== "global"),
    },
    {
      id: "global",
      name: "全局库",
      description: "填充时需点名引用",
      items: knowledgeBases.filter((base) => base.scope === "global"),
    },
  ];

  useEffect(() => {
    if (!selectedKnowledgeBaseId && selectedBase?.id) {
      onSelectKnowledgeBase(selectedBase.id);
    }
  }, [onSelectKnowledgeBase, selectedBase, selectedKnowledgeBaseId]);

  async function handleCreateBase(event) {
    event.preventDefault();
    await onCreateKnowledgeBase({
      name: newBaseName,
      scope: newBaseScope,
      projectId,
    });
    setNewBaseName("");
  }

  async function handleUploadChange(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    await uploadSelectedFiles(files);
  }

  async function uploadSelectedFiles(files) {
    const fileList = [...(files || [])];
    if (!selectedBase || fileList.length === 0 || uploading) return;
    setUploading(true);
    setUploadError("");
    setUploadMessage(`正在解析并入库 ${fileList.length} 个资料...`);
    try {
      const count = await onUploadDocuments(selectedBase.id, fileList);
      setUploadMessage(`已完成 ${count} 个资料入库，可在右侧检索预览中搜索验证。`);
    } catch (error) {
      setUploadError(error.message || "资料入库失败，请检查文件格式或后端配置。");
      setUploadMessage("");
    } finally {
      setUploading(false);
    }
  }

  function handleDropUpload(event) {
    event.preventDefault();
    uploadSelectedFiles([...(event.dataTransfer.files || [])]);
  }

  async function handleDeleteBase(base) {
    const documentCount = base.documentCount || 0;
    const chunkCount = base.chunkCount || 0;
    const message = `确定删除知识库“${base.name}”吗？\n\n将同时删除 ${documentCount} 个资料、${chunkCount} 个切片，此操作不可恢复。`;
    if (!window.confirm(message)) return;
    await onDeleteKnowledgeBase(base.id);
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setSelectedResultId("");
      return;
    }
    setSearching(true);
    try {
      const results = await searchKnowledge(searchTerm, projectId);
      setSearchResults(results);
      setSelectedResultId(results[0]?.id || "");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="knowledge-manager">
      <div className="manager-toolbar">
        <div>
          <h2>知识库管理</h2>
          <p>项目资料与全局资料统一入库，AI 填充时自动召回相关片段作为证据。</p>
        </div>
        <button className="tool-button" onClick={onRefresh}>
          <RotateCcw size={17} />
          刷新
        </button>
      </div>

      <div className="manager-summary">
        <div className="summary-card">
          <span>知识库</span>
          <strong>{knowledgeBases.length}</strong>
          <em>专项数据库 / 全局库</em>
        </div>
        <div className="summary-card">
          <span>资料</span>
          <strong>{totalDocuments}</strong>
          <em>已入库</em>
        </div>
        <div className="summary-card">
          <span>切片</span>
          <strong>{totalChunks}</strong>
          <em>可检索片段</em>
        </div>
      </div>

      <div className="knowledge-grid">
        <aside className="knowledge-sidebar panel-section">
          <div className="panel-title">
            <h2>知识库</h2>
            <span className="soft-count">{knowledgeBases.length} 个</span>
          </div>
          <form className="knowledge-create" onSubmit={handleCreateBase}>
            <input value={newBaseName} onChange={(event) => setNewBaseName(event.target.value)} placeholder="新建知识库名称" />
            <select value={newBaseScope} onChange={(event) => setNewBaseScope(event.target.value)}>
              <option value="project">专项数据库</option>
              <option value="global">全局库</option>
            </select>
            <button className="tool-button solid" type="submit">
              <BookOpenText size={16} />
              新建
            </button>
          </form>
          <div className="knowledge-base-tree" role="tree" aria-label="知识库树">
            {knowledgeTreeGroups.map((group) => (
              <div className="knowledge-tree-group" key={group.id}>
                <button
                  className="knowledge-tree-heading"
                  type="button"
                  aria-expanded={expandedKnowledgeGroups[group.id]}
                  onClick={() => setExpandedKnowledgeGroups((value) => ({ ...value, [group.id]: !value[group.id] }))}
                >
                  {expandedKnowledgeGroups[group.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <FolderOpen size={15} />
                  <div>
                    <strong>{group.name}</strong>
                    <span>{group.description}</span>
                  </div>
                  <em>{group.items.length}</em>
                </button>
                {expandedKnowledgeGroups[group.id] ? (
                  <div className="knowledge-tree-children">
                    {group.items.length ? (
                      group.items.map((base) => (
                        <div className={base.id === selectedBase?.id ? "knowledge-tree-node selected" : "knowledge-tree-node"} key={base.id} role="treeitem" aria-selected={base.id === selectedBase?.id}>
                          <span className="knowledge-tree-line" />
                          <button className="knowledge-tree-select" type="button" onClick={() => onSelectKnowledgeBase(base.id)}>
                            <BookOpenText size={15} />
                            <div>
                              <strong>{base.name}</strong>
                              <span>{base.indexStatus} · {base.documentCount || 0} 资料 / {base.chunkCount || 0} 片段</span>
                            </div>
                          </button>
                          <button className="knowledge-tree-delete" type="button" aria-label={`删除${base.name}`} onClick={() => handleDeleteBase(base)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="knowledge-tree-empty">
                        <span className="knowledge-tree-line" />
                        <em>暂无知识库</em>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <section className="knowledge-documents panel-section">
          <div className="panel-title align-top">
            <div>
              <h2>{selectedBase?.name || "未选择知识库"}</h2>
              <p>{selectedBase?.scope === "global" ? "全局资料会参与所有项目召回。" : "项目资料仅参与当前项目召回。"}</p>
            </div>
            <input
              className="visually-hidden"
              type="file"
              accept=".docx,.txt,.md,.json,.csv"
              multiple
              ref={fileInputRef}
              onChange={handleUploadChange}
            />
            <button className="tool-button primary" onClick={() => fileInputRef.current?.click()} disabled={!selectedBase || uploading}>
              {uploading ? <Loader2 size={17} className="spin" /> : <Upload size={17} />}
              {uploading ? "入库中" : "上传资料"}
            </button>
          </div>
          <div
            className={uploading ? "knowledge-upload-zone busy" : "knowledge-upload-zone"}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropUpload}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            {uploading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            <div>
              <strong>{uploading ? "正在入库资料" : "点击或拖拽资料入库"}</strong>
              <span>支持 DOCX、TXT、MD、JSON、CSV；资料会切片后进入当前知识库。</span>
            </div>
          </div>
          {uploadMessage ? <div className="knowledge-upload-message ok">{uploadMessage}</div> : null}
          {uploadError ? <div className="knowledge-upload-message error">{uploadError}</div> : null}
          <div className="knowledge-document-table">
            {selectedBase?.documents?.length ? (
              selectedBase.documents.map((document) => (
                <div className="knowledge-document-row" key={document.id}>
                  <FileText size={17} />
                  <div>
                    <strong>{document.name}</strong>
                    <span>{document.size || "--"} · {document.chunkCount || 0} 片段 · {document.status}</span>
                    {document.error ? <em>{document.error}</em> : null}
                  </div>
                  <button className="icon-button quiet" onClick={() => onDeleteDocument(selectedBase.id, document.id)} aria-label={`删除${document.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Database size={18} />
                <span>当前知识库暂无资料</span>
              </div>
            )}
          </div>
        </section>

        <aside className="knowledge-search panel-section">
          <div className="panel-title align-top">
            <div>
              <h2>检索预览</h2>
              <p>同时检索当前项目库与全局库。</p>
            </div>
          </div>
          <form className="knowledge-search-form" onSubmit={handleSearch}>
            <div className="search-box editable">
              <Search size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索项目名称、评审办法、业绩要求" />
            </div>
            <button className="tool-button solid" type="submit" disabled={searching}>
              {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              检索
            </button>
          </form>
          {searchTerm.trim() ? (
            <div className="knowledge-result-summary">
              {searching ? "正在检索..." : `共 ${searchResults.length} 条结果`}
            </div>
          ) : null}
          <div className="knowledge-result-list">
            {searchResults.length === 0 ? (
              <div className="empty-state compact">
                <Info size={17} />
                <span>暂无检索结果</span>
              </div>
            ) : (
              searchResults.map((result) => (
                <button
                  className={result.id === selectedResult?.id ? "knowledge-result-row selected" : "knowledge-result-row"}
                  key={result.id}
                  onClick={() => setSelectedResultId(result.id)}
                >
                  <strong>{result.documentName}</strong>
                  <span>{result.scope === "global" ? "全局库" : "项目库"} · 片段{result.chunkIndex} · {result.mode} · 相关度 {result.score}</span>
                  <p>{renderKnowledgeText(getKnowledgePreview(result.text, searchTerm), searchTerm)}</p>
                </button>
              ))
            )}
          </div>
          {selectedResult ? (
            <div className="knowledge-result-detail">
              <strong>{selectedResult.documentName}</strong>
              <span>相关度 {selectedResult.score} · {selectedResult.scope === "global" ? "全局库" : "项目库"}</span>
              <p>{renderKnowledgeText(selectedResult.text, searchTerm)}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function getKnowledgePreview(text, query, maxLength = 220) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  const terms = createKnowledgeDisplayTerms(query);
  const hitIndex = terms.reduce((best, term) => {
    const index = value.toLowerCase().indexOf(term.toLowerCase());
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const start = hitIndex >= 0 ? Math.max(0, hitIndex - 70) : 0;
  const end = Math.min(value.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${value.slice(start, end).trim()}${end < value.length ? "..." : ""}`;
}

function renderKnowledgeText(text, query) {
  const value = String(text || "");
  const terms = createKnowledgeDisplayTerms(query);
  if (!value || terms.length === 0) return value;
  const escapedTerms = terms.map(escapeKnowledgeRegExp).filter(Boolean);
  if (escapedTerms.length === 0) return value;
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  return value.split(pattern).map((part, index) => {
    if (!part) return null;
    return terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark className="knowledge-hit" key={`${part}-${index}`}>{part}</mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    );
  });
}

function createKnowledgeDisplayTerms(query) {
  const raw = String(query || "").trim();
  const normalized = raw.replace(/\s+/g, "");
  const stripped = normalized
    .replace(/^(请|帮我|根据|自动|获取|提取|生成|填写|填充|查询|搜索|查找)+/g, "")
    .replace(/(是什么|是啥|怎么写|如何写|怎么填|如何填|填写什么|填什么|多少天|多少|有哪些|是什么内容|的内容|内容|要求)$/g, "");
  const terms = [raw, normalized, stripped, ...raw.split(/[\s,，。；;、:：()（）]+/)];

  if (/项目名称|工程名称|项目名|工程名/.test(stripped)) terms.push("项目名称", "工程名称", "名称统一使用");
  if (/评审办法|评标办法|综合评分|综合评估|采购方式|招采方式/.test(stripped)) terms.push("综合评估法", "询比采购", "招采方式");
  if (/业绩|类似项目|合同金额|发票/.test(stripped)) terms.push("业绩要求", "类似项目业绩", "合同金额", "合同发票");
  if (/人员|技术负责人|安全员|专职安全/.test(stripped)) terms.push("人员要求", "技术负责人", "专职安全生产管理人员", "C2", "C3");
  if (/付款|支付|进度款|结算款|质保金/.test(stripped)) terms.push("付款方式", "进度款", "结算款", "质保金");
  if (/工期|日历天|进场通知/.test(stripped)) terms.push("工期", "日历天", "进场通知");
  if (/控制价|最高限价|预算金额/.test(stripped)) terms.push("采购控制价", "控制价", "最高限价");

  return [...new Set(terms.map((term) => String(term || "").trim()).filter((term) => term.length >= 2))]
    .sort((a, b) => b.length - a.length);
}

function escapeKnowledgeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function FormatAuditWorkspace({ onStoreTemplate }) {
  const fileInputRef = useRef(null);
  const aiAuditRequestRef = useRef(0);
  const currentAuditFileRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [auditResult, setAuditResult] = useState(null);
  const [outlineAuditResult, setOutlineAuditResult] = useState(null);
  const [auditPanelMode, setAuditPanelMode] = useState(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState([]);
  const [auditState, setAuditState] = useState("idle");
  const [error, setError] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [auditConfig, setAuditConfig] = useState(() => readAuditConfig());
  const [expandedIssueIds, setExpandedIssueIds] = useState([]);
  const [aiOutlineBusy, setAiOutlineBusy] = useState(false);
  const [outlineUserInput, setOutlineUserInput] = useState("");
  const [templateCategory, setTemplateCategory] = useState("招标类");
  const [templateStoreState, setTemplateStoreState] = useState("idle");
  const [onlyOfficeOutline, setOnlyOfficeOutline] = useState(null);
  const activeAuditResult = auditPanelMode === "outline" ? outlineAuditResult : auditPanelMode === "content" ? auditResult : null;
  const issues = activeAuditResult?.issues || [];
  const enabledAuditItems = auditConfig.enabled;
  const enabledAuditItemSet = useMemo(() => new Set(enabledAuditItems), [enabledAuditItems]);
  const repairableIssues = issues.filter((issue) => isAuditIssueEnabled(issue, enabledAuditItemSet));
  const selectedIssues = repairableIssues.filter((issue) => selectedIssueIds.includes(issue.id));
  const allIssuesSelected = repairableIssues.length > 0 && repairableIssues.every((issue) => selectedIssueIds.includes(issue.id));
  const isAuditBusy = auditState === "auditing" || auditState === "revising" || aiOutlineBusy;
  const canRevise = Boolean(previewFile?.buffer && selectedIssues.length > 0 && !isAuditBusy);
  const canStoreTemplate = Boolean((currentAuditFileRef.current || previewFile)?.buffer && !isAuditBusy && onStoreTemplate);
  const canStartOutlineAudit = Boolean(auditPanelMode === "outline" && onlyOfficeOutline?.ok && previewFile?.buffer && !isAuditBusy);
  const outlineAuditStarted = Boolean(outlineAuditResult || aiOutlineBusy);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      setError("请上传 .docx 文件。");
      setAuditState("error");
      return;
    }

    setError("");
    setAiOutlineBusy(false);
    setAuditState("auditing");
    try {
      const buffer = await file.arrayBuffer();
      const structure = await readDocxStructure(buffer.slice(0)).catch(() => null);
      const nextFile = {
        previewId: createPreviewId("audit-source"),
        name: file.name,
        size: formatFileSize(file.size),
        uploadedAt: "刚刚上传",
        buffer,
        supported: true,
        structure,
      };
      currentAuditFileRef.current = nextFile;
      setPreviewFile(nextFile);
      setOutlineAuditResult(null);
      setAuditPanelMode("content");
      setTemplateStoreState("idle");
      setOnlyOfficeOutline(null);
      await runAudit(nextFile);
    } catch (uploadError) {
      setAuditState("error");
      setError(uploadError?.message || "文档审查失败。");
    }
  }

  async function runAudit(file, config = auditConfig) {
    aiAuditRequestRef.current += 1;
    const scriptAudit = await auditDocxFormat(file.buffer.slice(0), config);
    const visibleAudit = scriptAudit;
    setError("");
    setAuditResult(visibleAudit);
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setAuditState("ready");
    setAiOutlineBusy(false);
    setOutlineAuditResult(null);
    return visibleAudit;
  }

  async function runOutlineAudit(file = currentAuditFileRef.current || previewFile, userInstruction = "") {
    if (!file?.buffer || aiOutlineBusy) return;
    const outline = window.__guangfaOnlyOfficeOutline || onlyOfficeOutline;
    if (!outline?.ok || !Array.isArray(outline.items) || outline.items.length === 0) {
      setAuditPanelMode("outline");
      setOutlineAuditResult({ issues: [] });
      setError("OnlyOffice 大纲未挂载，不能开始 AI 审查。");
      return;
    }
    const requestId = aiAuditRequestRef.current + 1;
    aiAuditRequestRef.current = requestId;
    setAuditPanelMode("outline");
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setAiOutlineBusy(true);
    setOutlineAuditResult(null);
    setError("");
    try {
      const nextAudit = await enhanceAuditWithAiOutline({ issues: [] }, file, auditConfig, outline, userInstruction);
      if (requestId !== aiAuditRequestRef.current) return;
      const outlineIssues = nextAudit.issues.filter((issue) => /^ai-/.test(issue.id));
      setOutlineAuditResult({ ...nextAudit, issues: outlineIssues });
      setError(nextAudit.aiError || "");
    } catch (outlineError) {
      if (requestId !== aiAuditRequestRef.current) return;
      setOutlineAuditResult({ issues: [] });
      setError(outlineError?.message || "AI 大纲审查失败。");
    } finally {
      if (requestId === aiAuditRequestRef.current) {
        setAiOutlineBusy(false);
        setAuditState("ready");
      }
    }
  }

  function toggleContentAuditPanel() {
    setAuditPanelMode((mode) => (mode === "content" ? null : "content"));
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
  }

  function toggleOutlineAuditPanel() {
    if (auditPanelMode === "outline") {
      setAuditPanelMode(null);
      setSelectedIssueIds([]);
      setExpandedIssueIds([]);
      return;
    }
    setAuditPanelMode("outline");
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setOutlineAuditResult(null);
    setError("");
  }

  function handleStartOutlineAudit() {
    runOutlineAudit(currentAuditFileRef.current || previewFile, "");
  }

  function handleSendOutlineInstruction() {
    const instruction = outlineUserInput.trim();
    if (!instruction) return;
    setOutlineUserInput("");
    runOutlineAudit(currentAuditFileRef.current || previewFile, instruction);
  }

  useEffect(() => {
    function handleOfficeCustomAction(event) {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom") return;
      if (data.action === "onlyoffice-outline-probe") {
        window.__guangfaOnlyOfficeOutline = data.outline;
        setOnlyOfficeOutline(data.outline);
        console.log("[format-audit] onlyoffice-outline-probe", data.outline);
        if (data.outline?.items && console.table) console.table(data.outline.items);
        fetch("/api/office/outline-probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: previewFile?.name || "",
            previewId: previewFile?.previewId || "",
            outline: data.outline,
          }),
        }).catch(() => {});
        return;
      }
      if (data.action === "toggle-content-audit") toggleContentAuditPanel();
      if (data.action === "toggle-outline-audit") toggleOutlineAuditPanel();
    }

    window.addEventListener("message", handleOfficeCustomAction);
    return () => window.removeEventListener("message", handleOfficeCustomAction);
  });

  async function applyAuditConfig() {
    setConfigOpen(false);
    const currentFile = currentAuditFileRef.current || previewFile;
    if (!currentFile?.buffer) return;
    setAuditState("auditing");
    setAiOutlineBusy(false);
    setOutlineAuditResult(null);
    setAuditPanelMode("content");
    setError("");
    try {
      await runAudit(currentFile, auditConfig);
    } catch (auditError) {
      setAuditState("error");
      setError(auditError?.message || "按配置重新审查失败。");
    }
  }

  function toggleIssue(issueId) {
    setSelectedIssueIds((ids) => (ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId]));
  }

  function toggleSelectAllIssues() {
    setSelectedIssueIds(allIssuesSelected ? [] : repairableIssues.map((issue) => issue.id));
  }

  function toggleIssueDetails(issueId) {
    setExpandedIssueIds((ids) => (ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId]));
  }

  async function handleReviseSelectedIssues() {
    if (!canRevise) return;
    const baseFile = currentAuditFileRef.current || previewFile;
    if (!baseFile?.buffer) return;
    const wasOutlinePanel = auditPanelMode === "outline";
    setAuditState("revising");
    setError("");
    try {
      const blob = await reviseDocxFormat(baseFile.buffer.slice(0), selectedIssues, auditConfig);
      const revisedBuffer = await blob.arrayBuffer();
      const revisedFile = {
        ...baseFile,
        previewId: createPreviewId("audit-revised"),
        name: buildFormatRevisionFileName(baseFile.name),
        size: formatFileSize(blob.size),
        uploadedAt: "刚刚修订",
        buffer: revisedBuffer,
        supported: true,
        structure: await readDocxStructure(revisedBuffer.slice(0)).catch(() => null),
      };
      setPreviewFile(null);
      await waitForNextFrame();
      currentAuditFileRef.current = revisedFile;
      if (wasOutlinePanel) {
        setOnlyOfficeOutline(null);
        setOutlineAuditResult(null);
        setSelectedIssueIds([]);
        setExpandedIssueIds([]);
      }
      setPreviewFile(revisedFile);
      setTemplateStoreState("idle");
      if (wasOutlinePanel) setAuditState("ready");
      else await runAudit(revisedFile, auditConfig);
    } catch (reviseError) {
      setAuditState("error");
      setError(reviseError?.message || "执行修复失败。");
    }
  }

  async function handleStoreTemplate() {
    const currentFile = currentAuditFileRef.current || previewFile;
    if (!currentFile?.buffer || !onStoreTemplate) return;
    setTemplateStoreState("saving");
    try {
      await onStoreTemplate(currentFile, templateCategory);
      setTemplateStoreState("saved");
    } catch {
      setTemplateStoreState("error");
    }
  }

  function toggleAuditConfigItem(itemId) {
    setAuditConfig((config) => {
      const enabled = config.enabled.includes(itemId) ? config.enabled.filter((id) => id !== itemId) : [...config.enabled, itemId];
      const next = { ...config, enabled };
      localStorage.setItem(auditConfigStorageKey, JSON.stringify(next));
      setSelectedIssueIds((ids) => ids.filter((id) => issues.some((issue) => issue.id === id && isAuditIssueEnabled(issue, new Set(enabled)))));
      return next;
    });
  }

  function updateAuditParam(name, value) {
    setAuditConfig((config) => {
      const next = { ...config, params: { ...config.params, [name]: value } };
      localStorage.setItem(auditConfigStorageKey, JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className={auditPanelMode ? "work-grid audit-grid" : "work-grid audit-grid audit-grid-full"}>
      <section className="document-card">
        <input className="visually-hidden" type="file" accept=".docx" ref={fileInputRef} onChange={handleFileChange} />

        <DocumentFrame key={previewFile?.previewId || "audit-empty"} mode="audit" templateFile={previewFile} onUploadClick={() => fileInputRef.current?.click()} />
      </section>

      {auditPanelMode ? (
      <aside className="right-panel field-panel audit-panel">
        <div className="panel-section grow-section">
          <div className="panel-title">
            <h2>{auditPanelMode === "outline" ? "大纲审查" : "内容审查"}</h2>
            <div className="panel-actions">
              <div className="audit-template-store">
                <select value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)} disabled={!canStoreTemplate || templateStoreState === "saving"}>
                  {templateCategories.filter((category) => category !== "全部").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <button className="text-button" type="button" onClick={handleStoreTemplate} disabled={!canStoreTemplate || templateStoreState === "saving"}>
                  {templateStoreState === "saving" ? "保存中" : "存入模板库"}
                </button>
              </div>
              <button className="text-button" type="button" onClick={toggleSelectAllIssues} disabled={repairableIssues.length === 0 || isAuditBusy}>
                {allIssuesSelected ? "取消全选" : "全选"}
              </button>
              <button className="icon-button quiet" type="button" onClick={() => setConfigOpen(true)} aria-label="格式审查配置">
                <Settings size={16} />
              </button>
            </div>
          </div>
          {auditPanelMode === "outline" ? (
            <div className={onlyOfficeOutline?.ok ? "outline-mount-status ready" : onlyOfficeOutline ? "outline-mount-status error" : "outline-mount-status pending"}>
              {onlyOfficeOutline?.ok ? <Check size={15} /> : onlyOfficeOutline ? <CircleAlert size={15} /> : <Loader2 size={15} className="spin" />}
              <div>
                <strong>{onlyOfficeOutline?.ok ? `OnlyOffice 大纲已挂载：${onlyOfficeOutline.count || onlyOfficeOutline.items?.length || 0} 项` : onlyOfficeOutline ? "OnlyOffice 大纲挂载失败" : "OnlyOffice 大纲挂载中"}</strong>
                <span>{onlyOfficeOutline?.ok ? "AI 将按当前 OnlyOffice 导航大纲进行审查。" : onlyOfficeOutline?.error || "等待编辑器返回当前文档导航大纲。"}</span>
              </div>
              <button className="tool-button primary" type="button" onClick={handleStartOutlineAudit} disabled={!canStartOutlineAudit}>
                {aiOutlineBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                开始审查
              </button>
            </div>
          ) : null}
          {repairableIssues.length === 0 && !aiOutlineBusy ? (
            <div className="template-empty inline">
              <strong>{auditState === "idle" ? "等待上传文档" : auditPanelMode === "outline" && !outlineAuditStarted ? "等待开始审查" : "暂无可修订项"}</strong>
              <span>{auditState === "idle" ? "上传 DOCX 后生成审查清单。" : auditPanelMode === "outline" ? (outlineAuditStarted ? "AI 大纲审查未发现可修复项。" : "大纲挂载后点击开始审查，AI 只生成修复计划。") : "脚本审查未发现可修复项。"}</span>
            </div>
          ) : (
            <div className="audit-issue-list">
              {auditPanelMode === "outline" && repairableIssues.length > 0 ? (
                <div className="outline-revision-table-wrap">
                  <table className="outline-revision-table">
                    <thead>
                      <tr>
                        <th>选</th>
                        <th>index</th>
                        <th>displayLevel</th>
                        <th>title</th>
                        <th>修订原因</th>
                        <th>修订方式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repairableIssues.map((issue) => {
                        const target = issue.targets?.[0] || {};
                        return (
                          <tr className={selectedIssueIds.includes(issue.id) ? "selected" : ""} key={issue.id}>
                            <td>
                              <input type="checkbox" checked={selectedIssueIds.includes(issue.id)} onChange={() => toggleIssue(issue.id)} disabled={isAuditBusy} />
                            </td>
                            <td>{Number.isInteger(target.outlineIndex) ? target.outlineIndex : target.index}</td>
                            <td>{`L${(Number.isInteger(target.outlineLevel) ? target.outlineLevel : target.level ?? 0) + 1}`}</td>
                            <td title={target.text}>{target.text || "空标题"}</td>
                            <td>{getOutlineRevisionReason(target)}</td>
                            <td>{getOutlineRevisionAction(target)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : repairableIssues.map((issue) => {
                const expanded = expandedIssueIds.includes(issue.id);
                return (
                <div className={selectedIssueIds.includes(issue.id) ? "audit-issue selected" : "audit-issue"} key={issue.id}>
                  <label className="audit-issue-check">
                    <input type="checkbox" checked={selectedIssueIds.includes(issue.id)} onChange={() => toggleIssue(issue.id)} disabled={isAuditBusy} />
                  </label>
                  <div className="audit-issue-body">
                    <div className="audit-issue-head">
                      <strong>{issue.title}</strong>
                    </div>
                    <p>{issue.description}</p>
                    <div className="audit-issue-meta">
                      <em>{issue.category} · {issue.count} 处</em>
                      {issue.samples.length > 0 ? (
                        <button className="text-button" type="button" onClick={() => toggleIssueDetails(issue.id)}>
                          {expanded ? "收起" : "查看"}
                        </button>
                      ) : null}
                    </div>
                    {expanded && issue.samples.length > 0 ? (
                      <div className="audit-samples">
                        {issue.samples.map((sample, index) => (
                          <span key={`${issue.id}-${index}`}>{sample}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                );
              })}
              {aiOutlineBusy ? (
                <div className="audit-ai-loading">
                  <Loader2 size={16} className="spin" />
                  <div>
                    <strong>AI 正在审查大纲</strong>
                    <span>标题体系和 Word 大纲结果稍后自动补充到清单。</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {auditPanelMode === "outline" ? (
            <div className="outline-chat-box">
              <MessageSquareText size={16} />
              <input
                value={outlineUserInput}
                onChange={(event) => setOutlineUserInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSendOutlineInstruction();
                }}
                placeholder="输入调整要求，如：这个保留为标题、这些都降为正文"
                disabled={!onlyOfficeOutline?.ok || isAuditBusy}
              />
              <button className="text-button" type="button" onClick={handleSendOutlineInstruction} disabled={!outlineUserInput.trim() || !onlyOfficeOutline?.ok || isAuditBusy}>
                发送
              </button>
            </div>
          ) : null}
          <div className="audit-revise-bar">
            {error ? (
              <span className="audit-error-text">{error}</span>
            ) : templateStoreState === "saved" ? (
              <span>已存入{templateCategory}模板库</span>
            ) : templateStoreState === "error" ? (
              <span className="audit-error-text">模板库保存失败</span>
            ) : (
              <span>已选择 {selectedIssues.length} 项</span>
            )}
            <button className="tool-button primary" type="button" onClick={handleReviseSelectedIssues} disabled={!canRevise}>
              {auditState === "revising" ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
              执行修复
            </button>
          </div>
        </div>
      </aside>
      ) : null}
      {configOpen ? (
        <FormatAuditConfigModal
          config={auditConfig}
          onClose={() => setConfigOpen(false)}
          onApply={applyAuditConfig}
          onToggleItem={toggleAuditConfigItem}
          onUpdateParam={updateAuditParam}
        />
      ) : null}
    </div>
  );
}

function FormatAuditConfigModal({ config, onClose, onApply, onToggleItem, onUpdateParam }) {
  const params = config.params;
  const itemById = new Map(auditConfigItems.map((item) => [item.id, item]));
  const sections = [
    { group: "页面版式", items: ["page-margin"] },
    { group: "基础文字", items: ["body-font", "body-size"] },
    { group: "段落格式", items: ["first-line-indent", "line-spacing", "paragraph-spacing", "blank-lines"] },
    { group: "标题体系", items: ["body-outline", "missing-heading-style", "heading-level", "heading-visual-style", "split-heading"] },
    { group: "目录大纲", items: ["word-outline", "toc-items"] },
  ];

  function renderItemParams(itemId) {
    if (itemId === "page-margin") {
      return (
        <div className="audit-param-grid">
          <NumberField label="上边距 mm" value={params.pageMarginTopMm} onChange={(value) => onUpdateParam("pageMarginTopMm", value)} />
          <NumberField label="右边距 mm" value={params.pageMarginRightMm} onChange={(value) => onUpdateParam("pageMarginRightMm", value)} />
          <NumberField label="下边距 mm" value={params.pageMarginBottomMm} onChange={(value) => onUpdateParam("pageMarginBottomMm", value)} />
          <NumberField label="左边距 mm" value={params.pageMarginLeftMm} onChange={(value) => onUpdateParam("pageMarginLeftMm", value)} />
        </div>
      );
    }
    if (itemId === "body-font") return <TextField label="标准字体" value={params.bodyFont} onChange={(value) => onUpdateParam("bodyFont", value)} />;
    if (itemId === "body-size") return <NumberField label="标准字号 pt" value={params.bodyFontSizePt} onChange={(value) => onUpdateParam("bodyFontSizePt", value)} />;
    if (itemId === "first-line-indent") return <NumberField label="首行缩进 字符" value={params.firstLineChars} onChange={(value) => onUpdateParam("firstLineChars", value)} />;
    if (itemId === "line-spacing") return <NumberField label="行距 倍" value={params.lineSpacing} step="0.1" onChange={(value) => onUpdateParam("lineSpacing", value)} />;
    if (itemId === "paragraph-spacing") {
      return (
        <div className="audit-param-grid">
          <NumberField label="段前 pt" value={params.paragraphBeforePt} onChange={(value) => onUpdateParam("paragraphBeforePt", value)} />
          <NumberField label="段后 pt" value={params.paragraphAfterPt} onChange={(value) => onUpdateParam("paragraphAfterPt", value)} />
        </div>
      );
    }
    if (itemId === "heading-visual-style") {
      return (
        <div className="audit-param-grid">
          <TextField label="一级标题字体" value={params.headingLevel1Font} onChange={(value) => onUpdateParam("headingLevel1Font", value)} />
          <NumberField label="一级标题字号 pt" value={params.headingLevel1SizePt} onChange={(value) => onUpdateParam("headingLevel1SizePt", value)} />
          <TextField label="二级标题字体" value={params.headingLevel2Font} onChange={(value) => onUpdateParam("headingLevel2Font", value)} />
          <NumberField label="二级标题字号 pt" value={params.headingLevel2SizePt} onChange={(value) => onUpdateParam("headingLevel2SizePt", value)} />
          <TextField label="三级标题字体" value={params.headingLevel3Font} onChange={(value) => onUpdateParam("headingLevel3Font", value)} />
          <NumberField label="三级标题字号 pt" value={params.headingLevel3SizePt} onChange={(value) => onUpdateParam("headingLevel3SizePt", value)} />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="audit-config-modal" role="dialog" aria-modal="true" aria-label="格式审查配置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>格式审查配置</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="audit-config-body">
          {sections.map((section) => (
            <section className="audit-config-section" key={section.group}>
              <h3>{section.group}</h3>
              <div className="audit-config-items">
                {section.items.map((itemId) => {
                  const item = itemById.get(itemId);
                  if (!item) return null;
                  return (
                    <div className="audit-config-item" key={item.id}>
                      <label className="audit-config-check">
                        <input type="checkbox" checked={config.enabled.includes(item.id)} onChange={() => onToggleItem(item.id)} />
                        <strong>{item.name}</strong>
                      </label>
                      {renderItemParams(item.id)}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button className="tool-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="tool-button primary" type="button" onClick={onApply}>
            应用配置
          </button>
        </div>
      </section>
    </div>
  );
}

function NumberField({ label, value, step = "1", onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function AnnotateWorkspace({
  templateFile,
  fields,
  selectedField,
  selectedFieldId,
  brushActive,
  saveState,
  currentPage,
  onUploadTemplate,
  onSaveTemplate,
  onPreviewPageChange,
  onSlotClick,
  onSelectField,
  onUpdateField,
  onRemoveField,
  onAddInputPoint,
  onInputPointCaptured,
  onOfficeDocumentReady,
}) {
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const [templateCategory, setTemplateCategory] = useState(() => normalizeTemplateCategory(inferTemplateCategory(templateFile?.name)));
  const currentPageFields = fields.filter((field) => (field.page || 1) === currentPage);
  const invalidFieldCount = fields.filter((field) => !getTemplateFieldSourceText(field) || !(field.category || field.type || "").trim()).length;
  const saveStatusCopy = {
    idle: "待上传",
    uploaded: "待标注",
    dirty: "未保存",
    saving: "保存中",
    saved: "已保存",
    incomplete: fields.length === 0 ? "未标注" : invalidFieldCount > 0 ? `${invalidFieldCount}项未完善` : "待确认",
    "no-file": "未上传",
    unsupported: "不支持",
    "storage-error": "保存失败",
  };
  const saveStatusTone =
    saveState === "saved" ? "green" : saveState === "incomplete" || saveState === "no-file" || saveState === "storage-error" ? "amber" : "blue";

  useEffect(() => {
    setTemplateCategory(normalizeTemplateCategory(inferTemplateCategory(templateFile?.name)));
  }, [templateFile?.name]);

  useGSAP(
    () => {
      const rows = gsap.utils.toArray(".annotation-field-row");
      if (rows.length > 0) {
        gsap.fromTo(
          rows,
          { y: 10, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.28, stagger: 0.04, ease: "power2.out" },
        );
      }
    },
    { dependencies: [fields.length], scope: panelRef },
  );

  function handleFileChange(event) {
    onUploadTemplate(event.target.files?.[0]);
    event.target.value = "";
  }

  return (
    <div className="work-grid annotate-grid">
      <section className="document-card">
        <input className="visually-hidden" type="file" accept=".docx" ref={fileInputRef} onChange={handleFileChange} />

        <DocumentFrame
          mode="annotate"
          templateFile={templateFile}
          annotationFields={fields}
          selectedTemplateFieldId={selectedFieldId}
          brushActive={brushActive}
          onSlotClick={onSlotClick}
          onSelectField={onSelectField}
          currentPage={currentPage}
          onPageChange={onPreviewPageChange}
          onUploadClick={() => fileInputRef.current?.click()}
          onInputPointCaptured={onInputPointCaptured}
          onOfficeDocumentReady={onOfficeDocumentReady}
        />
      </section>

      <aside className="right-panel field-panel" ref={panelRef}>
        <div className="panel-section">
          <div className="panel-title">
            <h2>字段属性</h2>
            <div className="panel-actions">
              <span className={`soft-badge ${saveStatusTone}`}>{saveStatusCopy[saveState] ?? saveStatusCopy.idle}</span>
              <div className="template-save-actions">
                <select value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)} disabled={saveState === "saving"}>
                  {templateCategories.filter((category) => category !== "全部").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <button className="text-button" type="button" onClick={() => onSaveTemplate?.(templateCategory)} disabled={saveState === "saving"}>
                  {saveState === "saving" ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  {saveState === "saving" ? "保存中" : "保存模板"}
                </button>
              </div>
              <span className={selectedField ? "soft-badge blue" : "soft-badge"}>{selectedField ? "当前选中" : "未选择"}</span>
            </div>
          </div>
          <FieldForm
            field={selectedField}
            onChange={onUpdateField}
            onAddInputPoint={() => selectedField && onAddInputPoint?.(selectedField.id)}
          />
        </div>
        <div className="panel-section grow-section">
          <div className="panel-title">
            <h2>字段列表</h2>
            <div className="panel-actions">
              <span className="soft-count">总计 {fields.length} 项</span>
              <span className="soft-count">当前页 {currentPageFields.length} 项</span>
            </div>
          </div>
          <div className="annotated-list">
            {currentPageFields.length === 0 ? (
              <div className="empty-state">
                <Highlighter size={18} />
                <span>当前页暂无标注字段</span>
              </div>
            ) : (
              currentPageFields.map((field, index) => {
                const sourceText = getTemplateFieldSourceText(field);
                const category = normalizeFieldCategory(field.category || field.type || "未分类");
                const fillModeLabel = getFillModeLabel(normalizeFillMode(field.fillMode, field));
                return (
                  <div
                    className={[
                      "annotated-row",
                      "annotation-field-row",
                      field.status === "已标注" ? "marked" : "",
                      field.id === selectedFieldId ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={field.id}
                    onClick={() => onSelectField(field.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectField(field.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="row-index">{index + 1}</span>
                    <div>
                      <strong>{sourceText || "未记录选区原文"}</strong>
                      <span>{category} · {fillModeLabel}</span>
                    </div>
                    <StatusPill status={field.status} />
                    <button
                      className="icon-button quiet"
                      aria-label={`删除${sourceText || field.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveField(field.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function MultiKnowledgeSelect({ label, emptyLabel, bases, selectedIds, onChange, disabled }) {
  const selectedBases = bases.filter((base) => selectedIds.includes(base.id));
  const text = selectedBases.length
    ? `${label}：${selectedBases.length === 1 ? selectedBases[0].name : `${selectedBases.length}个已选`}`
    : emptyLabel;

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return (
    <details className="knowledge-multi-select">
      <summary aria-disabled={disabled} onClick={(event) => disabled && event.preventDefault()}>
        <FolderOpen size={14} />
        <span>{text}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="knowledge-multi-menu">
        {bases.length === 0 ? (
          <em>暂无可选知识库</em>
        ) : (
          bases.map((base) => (
            <label key={base.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(base.id)}
                onChange={() => toggle(base.id)}
              />
              <span title={base.name}>{base.name}</span>
              <small>{base.documentCount || 0}资料</small>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

function FillWorkspace({
  fields,
  templateFile,
  sourceTemplateFile,
  selectedFieldId,
  materialFiles,
  currentPage,
  fieldPageMap = {},
  officeDocId,
  onPreviewPageChange,
  onFieldPagesChange,
  onSelectField,
  onUploadMaterials,
  onRemoveMaterial,
  onOfficeDocumentReady,
  onGenerate,
  onGenerateAll,
  generatingAll,
  knowledgeBases,
  selectedProjectKnowledgeBaseIds,
  selectedGlobalKnowledgeBaseIds,
  knowledgeTopK,
  onSelectedProjectKnowledgeBaseChange,
  onSelectedGlobalKnowledgeBaseChange,
  onKnowledgeTopKChange,
  onUpdateValue,
  onConfirm,
}) {
  const materialInputRef = useRef(null);
  const materialUploadModeRef = useRef("temporary");
  const [exportState, setExportState] = useState("idle");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [uploadState, setUploadState] = useState("idle");
  const baseTemplateFile = sourceTemplateFile || templateFile;
  const counts = useMemo(
    () =>
      fields.reduce(
        (acc, field) => {
          acc.all += 1;
          acc[field.status] = (acc[field.status] ?? 0) + 1;
          return acc;
        },
        { all: 0 },
      ),
    [fields],
  );

  const hasDynamicFieldPages = Object.keys(fieldPageMap || {}).length > 0;
  const pageFields = fields.filter((field) => getFillFieldDisplayPage(field, fieldPageMap, hasDynamicFieldPages) === currentPage);
  const activeTemplateName = baseTemplateFile?.name ?? "未选择模板";
  const fillableCount = fields.filter((field) => field.status !== "已确认" && field.status !== "生成中").length;
  const projectKnowledgeBases = knowledgeBases.filter((base) => base.scope !== "global");
  const globalKnowledgeBases = knowledgeBases.filter((base) => base.scope === "global" && (base.documentCount || 0) > 0);
  const knowledgeSelected = selectedProjectKnowledgeBaseIds.length > 0;

  async function handleMaterialChange(event) {
    const files = event.target.files || [];
    const persistToKnowledge = materialUploadModeRef.current === "knowledge";
    event.target.value = "";
    if (files.length === 0) return;
    setUploadState(persistToKnowledge ? "indexing" : "uploading");
    try {
      await onUploadMaterials(files, { persistToKnowledge });
      setUploadState(persistToKnowledge ? "indexed" : "uploaded");
      if (persistToKnowledge) setMaterialsOpen(true);
    } catch {
      setUploadState("error");
    }
  }

  function openMaterialPicker(mode) {
    materialUploadModeRef.current = mode;
    materialInputRef.current?.click();
  }

  async function handleExportDocx() {
    if (!baseTemplateFile?.buffer) {
      setExportState("no-file");
      return;
    }
    setExportState("exporting");
    try {
      if (officeDocId) {
        const response = await fetch(`/api/office/documents/${officeDocId}/file?t=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          downloadDocxBuffer(await response.arrayBuffer(), buildExportFileName(baseTemplateFile.name));
          setExportState("done");
          return;
        }
      }
      await exportFilledDocx(baseTemplateFile, fields);
      setExportState("done");
    } catch {
      setExportState("error");
    }
  }

  return (
    <div className="work-grid fill-grid">
      <section className="document-card">
        <DocumentFrame
          mode="fill"
          templateFile={templateFile}
          fillFields={fields}
          selectedFieldId={selectedFieldId}
          currentPage={currentPage}
          onPageChange={onPreviewPageChange}
          onFieldPagesChange={onFieldPagesChange}
          onOfficeDocumentReady={onOfficeDocumentReady}
        />
      </section>

      <aside className="right-panel fill-panel">
        <div className="panel-section">
          <input
            className="visually-hidden"
            type="file"
            accept=".docx,.txt,.md,.json,.csv"
            multiple
            ref={materialInputRef}
            onChange={handleMaterialChange}
          />
          <div className="panel-title align-top">
            <div>
              <h2>填充项</h2>
              <p>{activeTemplateName}</p>
            </div>
            <span className="soft-count">当前页 {pageFields.length} 项</span>
          </div>
          <div className="fill-control-bar">
            <div className="material-upload-menu">
              <div className="split-upload">
                <button className="tool-button" onClick={() => openMaterialPicker("temporary")} disabled={uploadState === "indexing"}>
                  <Upload size={17} />
                  上传资料{materialFiles.length > 0 ? ` ${materialFiles.length}` : ""}
                </button>
                <button
                  className={materialsOpen ? "icon-button quiet is-active" : "icon-button quiet"}
                  type="button"
                  aria-label="查看已上传资料"
                  onClick={() => setMaterialsOpen((open) => !open)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              {materialsOpen ? (
                <div className="material-dropdown">
                  <div className="material-dropdown-head">
                    <strong>已上传资料</strong>
                    <span>{uploadState === "indexing" ? "入库中" : `${materialFiles.length} 个`}</span>
                  </div>
                  <div className="material-actions">
                    <button type="button" onClick={() => openMaterialPicker("temporary")} disabled={uploadState === "indexing"}>
                      <Upload size={15} />
                      仅本次使用
                    </button>
                    <button type="button" onClick={() => openMaterialPicker("knowledge")} disabled={uploadState === "indexing"}>
                      <Database size={15} />
                      上传并入当前项目知识库
                    </button>
                  </div>
                  {uploadState === "error" ? <div className="material-upload-error">资料入库失败，请检查知识库或 embedding 服务。</div> : null}
                  <div className="material-list">
                    {materialFiles.length === 0 ? (
                      <div className="material-empty">暂无资料</div>
                    ) : (
                      materialFiles.map((file) => (
                        <div className="material-row" key={file.id}>
                          <FileText size={15} />
                          <div>
                            <strong title={file.name}>{file.name}</strong>
                            <span>
                              {file.size} · {file.storage === "knowledge" ? `已入库：${file.knowledgeBaseName || "当前项目知识库"}` : "临时资料"}
                            </span>
                          </div>
                          <button
                            className="icon-button quiet"
                            type="button"
                            aria-label={`删除${file.name}`}
                            onClick={() => onRemoveMaterial(file.id)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button className="tool-button blue-action" onClick={onGenerateAll} disabled={generatingAll || fillableCount === 0}>
              {generatingAll ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} />}
              {generatingAll ? "填充中" : `一键填充${fillableCount > 0 ? ` ${fillableCount}` : ""}`}
            </button>
            <button className="tool-button solid" onClick={handleExportDocx} disabled={!baseTemplateFile?.buffer || exportState === "exporting"}>
              <Download size={17} />
              {exportState === "exporting" ? "导出中" : "导出DOCX"}
            </button>
            {exportState !== "idle" ? <span className={`export-status ${exportState}`}>{getExportStatusText(exportState)}</span> : null}
          </div>
          <div className="knowledge-fill-options">
            <MultiKnowledgeSelect
              label="项目库"
              emptyLabel="不使用知识库"
              bases={projectKnowledgeBases}
              selectedIds={selectedProjectKnowledgeBaseIds}
              onChange={onSelectedProjectKnowledgeBaseChange}
            />
            <MultiKnowledgeSelect
              label="全局库"
              emptyLabel="不引用全局库"
              bases={globalKnowledgeBases}
              selectedIds={selectedGlobalKnowledgeBaseIds}
              onChange={onSelectedGlobalKnowledgeBaseChange}
              disabled={!knowledgeSelected}
            />
            <select
              value={knowledgeTopK}
              onChange={(event) => onKnowledgeTopKChange(Number(event.target.value))}
              disabled={!knowledgeSelected}
              aria-label="知识库召回数量"
            >
              <option value={3}>召回3段</option>
              <option value={6}>召回6段</option>
              <option value={10}>召回10段</option>
            </select>
          </div>
          <div className="status-filters">
            <span className="filter active">当前页 {pageFields.length}</span>
            <span className="filter">全部 {counts.all}</span>
            <span className="filter">未填充 {counts["未填充"] ?? 0}</span>
            <span className="filter">待确认 {counts["待确认"] ?? 0}</span>
            <span className="filter">已确认 {counts["已确认"] ?? 0}</span>
            <span className="filter warning">需补充资料 {counts["需补充资料"] ?? 0}</span>
          </div>
          <div className="field-table">
            {pageFields.length === 0 ? (
              <div className="empty-state compact">
                <Info size={17} />
                <span>当前页暂无填充字段</span>
              </div>
            ) : (
              pageFields.map((field, index) => (
                <FillFieldRow
                  field={field}
                  index={index}
                  selected={field.id === selectedFieldId}
                  key={field.id}
                  onSelect={() => onSelectField(field.id)}
                  onGenerate={() => onGenerate(field.id)}
                  generateDisabled={generatingAll}
                  onUpdateValue={(value) => onUpdateValue(field.id, value)}
                  onConfirm={() => onConfirm(field.id)}
                />
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function getFillFieldDisplayPage(field, fieldPageMap = {}, hasDynamicFieldPages = false) {
  const mappedPage = hasDynamicFieldPages ? Number(fieldPageMap[field.id]) : 0;
  return Number.isFinite(mappedPage) && mappedPage > 0 ? mappedPage : field.inputPoint?.page || field.page || 1;
}

function DocumentFrame({
  mode,
  templateFile,
  annotationFields = [],
  fillFields = [],
  selectedTemplateFieldId,
  selectedFieldId,
  brushActive,
  currentPage = 1,
  onSlotClick,
  onSelectField,
  onPageChange,
  onFieldPagesChange,
  onUploadClick,
  onInputPointCaptured,
  onOfficeDocumentReady,
}) {
  const title = templateFile?.name ?? "未加载模板";
  const bodyRef = useRef(null);
  const canvasRef = useRef(null);
  const styleRef = useRef(null);
  const pdfUrlRef = useRef("");
  const auditPreviewRequestRef = useRef(0);
  const auditPdfPageTextsRef = useRef([]);
  const auditPdfOutlineRef = useRef([]);
  const auditPdfSearchHitsRef = useRef([]);
  const lastBrushAtRef = useRef(0);
  const [officePreview, setOfficePreview] = useState(null);
  const [localPage, setLocalPage] = useState(currentPage);
  const [renderState, setRenderState] = useState(templateFile?.buffer ? "loading" : "empty");
  const [pdfUrl, setPdfUrl] = useState("");
  const [outlineItems, setOutlineItems] = useState([]);
  const [outlineWidth, setOutlineWidth] = useState(170);
  const [pageCount, setPageCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [zoomPercent, setZoomPercent] = useState(100);
  const isAuditPdfMode = mode === "audit";
  const isOfficeMode = mode === "audit" || mode === "annotate" || mode === "fill";
  const canRenderDocx = Boolean(templateFile?.buffer);
  const isReady = renderState === "ready";
  const activePage = onPageChange ? currentPage : localPage;
  const activePageRef = useRef(activePage);
  const previewIdentity = useMemo(
    () =>
      [
        mode,
        templateFile?.previewId || "",
        templateFile?.name || "",
        templateFile?.size || "",
        templateFile?.uploadedAt || "",
        templateFile?.buffer?.byteLength || 0,
        templateFile?.supported === false ? "unsupported" : "supported",
      ].join("|"),
    [mode, templateFile?.previewId, templateFile?.name, templateFile?.size, templateFile?.uploadedAt, templateFile?.buffer, templateFile?.supported],
  );
  const activeOfficePreview = officePreview?.previewIdentity === previewIdentity ? officePreview : null;
  const visibleAnnotationFields = annotationFields.filter((field) => (field.page || 1) === activePage);
  const confirmedFillFields = fillFields.filter((field) => field.value);

  function releasePdfUrlLater(url) {
    if (!url) return;
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  function setActivePage(pageNumber) {
    if (onPageChange) {
      onPageChange(pageNumber);
    } else {
      setLocalPage(pageNumber);
    }
  }

  useEffect(() => {
    if (!isOfficeMode) return;

    if (pdfUrlRef.current) {
      releasePdfUrlLater(pdfUrlRef.current);
      pdfUrlRef.current = "";
    }
    setOfficePreview(null);
    setPdfUrl("");
    setOutlineItems([]);
    setPageCount(0);
    setPageInput("1");
    setActivePage(1);
    auditPdfPageTextsRef.current = [];
    auditPdfOutlineRef.current = [];
    auditPdfSearchHitsRef.current = [];
    setSearchCount(0);
    setSearchIndex(0);

    if (!templateFile?.buffer) {
      setRenderState(templateFile && templateFile.supported === false ? "unsupported" : "empty");
      onOfficeDocumentReady?.("");
      return;
    }

    let cancelled = false;
    const requestId = auditPreviewRequestRef.current + 1;
    auditPreviewRequestRef.current = requestId;
    const sourceBuffer = templateFile.buffer.slice(0);
    const officeBufferPromise = Promise.resolve(sourceBuffer.slice(0));
    setRenderState("loading");

    const officeParams = new URLSearchParams({
      title: templateFile.name || "document.docx",
      previewId: templateFile.previewId || "",
    });
    officeBufferPromise
      .then((officeBuffer) =>
        fetch(`/api/office/documents?${officeParams.toString()}`, {
          method: "POST",
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          body: officeBuffer,
        }),
      )
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "OnlyOffice 文档初始化失败");
        return data;
      })
      .then((data) => {
        if (cancelled || requestId !== auditPreviewRequestRef.current) return;
        if (data.available && data.config && data.serverUrl) {
          setOfficePreview({ previewIdentity, config: data.config, serverUrl: data.serverUrl, id: data.id });
          onOfficeDocumentReady?.(data.id || "");
          return;
        }
        throw new Error("OnlyOffice 服务不可用");
      })
      .catch(() => {
        if (!cancelled && requestId === auditPreviewRequestRef.current) setRenderState("error");
      });

    return () => {
      cancelled = true;
      if (pdfUrlRef.current) {
        releasePdfUrlLater(pdfUrlRef.current);
        pdfUrlRef.current = "";
      }
    };
  }, [isOfficeMode, mode, onOfficeDocumentReady, previewIdentity, templateFile?.buffer, templateFile?.supported]);

  function refreshAuditPdfOutlinePages() {
    if (!isAuditPdfMode) return;
    setOutlineItems(auditPdfOutlineRef.current);
  }

  useEffect(() => {
    if (isOfficeMode) return;
    if (!bodyRef.current || !styleRef.current) return;
    bodyRef.current.innerHTML = "";
    styleRef.current.innerHTML = "";

    if (!templateFile?.buffer) {
      setRenderState(templateFile && templateFile.supported === false ? "unsupported" : "empty");
      setOutlineItems([]);
      setPageCount(0);
      setSearchCount(0);
      setSearchIndex(0);
      setPageInput("1");
      setActivePage(1);
      return;
    }

    let cancelled = false;
    const sourceBuffer = templateFile.buffer.slice(0);
    const previewBufferPromise = Promise.resolve(sourceBuffer.slice(0));
    const outlinePromise = readDocxOutlineItems(sourceBuffer.slice(0)).catch(() => []);
    setRenderState("loading");
    previewBufferPromise
      .then((previewBuffer) =>
        renderAsync(previewBuffer, bodyRef.current, styleRef.current, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
        }),
      )
      .then(() => {
        if (cancelled) return;
        setRenderState("ready");
        requestAnimationFrame(() => {
          (document.fonts?.ready ?? Promise.resolve()).finally(() => {
            requestAnimationFrame(() => {
              if (cancelled) return;
              outlinePromise.then((docxOutline) => {
                if (cancelled) return;
                syncRenderedTocEntries(bodyRef.current, docxOutline);
                normalizePreviewPageLayout(bodyRef.current);
                preparePreviewPages(bodyRef.current);
                const nextPageCount = Math.max(1, getRenderedPageCount(bodyRef.current));
                const nextPage = clampNumber(activePageRef.current || 1, 1, nextPageCount);
                setPageCount(nextPageCount);
                setPageInput(String(nextPage));
                setOutlineItems(extractOutlineItems(bodyRef.current, docxOutline));
                scrollPreviewToPage(canvasRef.current, nextPage, "auto");
                gsap.fromTo(
                  bodyRef.current?.querySelector(`.docx-wrapper > section[data-preview-page="${nextPage}"]`) ??
                    bodyRef.current?.querySelector(".docx-wrapper > section") ??
                    bodyRef.current,
                  { y: 12, autoAlpha: 0 },
                  { y: 0, autoAlpha: 1, duration: 0.35, ease: "power2.out" },
                );
              });
            });
          });
        });
      })
      .catch(() => {
        if (!cancelled) setRenderState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isOfficeMode, templateFile?.buffer, templateFile?.name, templateFile?.supported]);

  useEffect(() => {
    if (isOfficeMode) return;
    if (renderState !== "ready" || !bodyRef.current) return;
    const result = highlightSearchMatches(bodyRef.current, searchTerm);
    setSearchCount(result.count);
    const nextIndex = result.count > 0 ? 0 : 0;
    setSearchIndex(nextIndex);
    if (result.count > 0) {
      jumpToSearchHit(nextIndex, "auto", result.count);
    }
  }, [isOfficeMode, searchTerm, renderState]);

  useEffect(() => {
    if (!isAuditPdfMode) return;
    if (renderState !== "ready") {
      auditPdfSearchHitsRef.current = [];
      setSearchCount(0);
      setSearchIndex(0);
      return;
    }
    updateAuditPdfSearch(searchTerm);
  }, [isAuditPdfMode, searchTerm, renderState]);

  useEffect(() => {
    if (isOfficeMode) return;
    if (renderState !== "ready") return;
    const nextPage = clampNumber(activePage, 1, pageCount || 1);
    setPageInput(String(nextPage));
    if (bodyRef.current) preparePreviewPages(bodyRef.current);
    const visiblePage = getPreviewPageElement(bodyRef.current, nextPage);
    if (visiblePage && !isPreviewPageMostlyVisible(canvasRef.current, visiblePage)) {
      scrollPreviewToPage(canvasRef.current, nextPage, "smooth");
      gsap.fromTo(visiblePage, { autoAlpha: 0.82 }, { autoAlpha: 1, duration: 0.18, ease: "power1.out" });
    } else if (visiblePage) {
      gsap.fromTo(visiblePage, { autoAlpha: 0.82 }, { autoAlpha: 1, duration: 0.18, ease: "power1.out" });
    }
  }, [isAuditPdfMode, activePage, pageCount, renderState, mode, zoomPercent]);

  useEffect(() => {
    if (renderState !== "ready" || mode !== "fill" || !bodyRef.current) return;
    applyFillPreviewValues(bodyRef.current, confirmedFillFields);
  }, [confirmedFillFields, mode, renderState]);

  useEffect(() => {
    if (renderState !== "ready" || mode !== "annotate" || !bodyRef.current) return;
    restoreAnnotationPreviewMarkers(bodyRef.current, annotationFields, selectedTemplateFieldId, activePage);
  }, [activePage, annotationFields, mode, renderState, selectedTemplateFieldId]);

  useEffect(() => {
    if (mode !== "annotate" && mode !== "fill") return;
    function handleOfficeAnnotation(event) {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom") return;
      if (data.action === "onlyoffice-page-change") {
        const nextPage = readOnlyOfficePageNumber(data.page);
        if (nextPage > 0 && nextPage !== activePageRef.current) setActivePage(nextPage);
        return;
      }
      if (data.action === "onlyoffice-field-pages") {
        onFieldPagesChange?.(data.fieldPages?.pages || {});
        return;
      }
      if (data.action === "annotation-restore") {
        console.log("[annotate] annotation-restore", data.restore);
        return;
      }
      if (data.action === "input-point") {
        console.log("[onlyoffice-input-point]", data.result);
        onInputPointCaptured?.(data.result);
        return;
      }
      if (data.action === "field-bookmark" || data.action === "field-fill") {
        console.log("[onlyoffice-field]", data.action, data.result);
        return;
      }
      if (mode !== "annotate") return;
      if (data.action !== "annotate-selection") return;
      console.log("[annotate] onlyoffice-selection", data.selection);
      const selectedText = String(data.selection?.text || "").replace(/\s+/g, " ").trim();
      if (!selectedText) {
        window.alert(data.selection?.error || "请先在 zl办公 中选中文字，再点击标注字段。");
        return;
      }
      if (data.selection?.highlight && data.selection.highlight.ok === false) {
        window.alert(data.selection.highlight.error || "字段已记录，但 zl办公 高亮失败。");
      }
      const selectionPage = Number(data.selection?.page || activePageRef.current || 1);
      if (selectionPage > 0 && selectionPage !== activePageRef.current) setActivePage(selectionPage);
      onSlotClick?.({
        text: selectedText,
        page: selectionPage || 1,
        officeDocId: activeOfficePreview?.id || "",
        path: "zl办公选区",
        marker: {
          kind: "office-selection",
          text: selectedText.slice(0, 500),
          source: data.selection?.source || "onlyoffice",
          selectionState: data.selection?.selectionState || null,
        },
      });
    }
    window.addEventListener("message", handleOfficeAnnotation);
    return () => window.removeEventListener("message", handleOfficeAnnotation);
  }, [activeOfficePreview?.id, mode, onFieldPagesChange, onInputPointCaptured, onSlotClick]);

  function jumpToPage(pageNumber) {
    if (!isReady) return;
    const nextPage = clampNumber(pageNumber, 1, pageCount || 1);
    setActivePage(nextPage);
    setPageInput(String(nextPage));
    if (isAuditPdfMode) {
      requestAnimationFrame(() => scrollAuditPdfToPage(canvasRef.current, nextPage));
    }
  }

  function jumpToOutline(item) {
    if (!isReady) return;
    if (isAuditPdfMode) {
      jumpToPage(item.page || 1);
      requestAnimationFrame(() => flashAuditPdfPage(canvasRef.current, item.page || 1));
      return;
    }
    if (!bodyRef.current) return;
    const target = bodyRef.current.querySelector(`[data-outline-id="${item.id}"]`);
    const page = target ? resolvePreviewPage(target, bodyRef.current) : item.page;
    jumpToPage(page);
    if (!target) return;
    requestAnimationFrame(() => {
      scrollPreviewToElement(canvasRef.current, target, "auto");
      gsap.fromTo(target, { backgroundColor: "rgba(15, 99, 233, 0.14)" }, { backgroundColor: "transparent", duration: 0.65 });
    });
  }

  function handlePageSubmit(event) {
    event.preventDefault();
    jumpToPage(Number(pageInput));
  }

  function changePage(delta) {
    jumpToPage(activePage + delta);
  }

  function jumpToSearchHit(nextIndex, behavior = "smooth", countOverride = searchCount) {
    if (isAuditPdfMode) {
      if (!isReady || countOverride <= 0) return;
      const hits = auditPdfSearchHitsRef.current;
      if (hits.length === 0) return;
      const normalizedIndex = ((nextIndex % hits.length) + hits.length) % hits.length;
      const target = hits[normalizedIndex];
      setSearchIndex(normalizedIndex);
      setActivePage(target.page);
      setPageInput(String(target.page));
      requestAnimationFrame(() => {
        scrollAuditPdfToPage(canvasRef.current, target.page, behavior);
        flashAuditPdfPage(canvasRef.current, target.page);
      });
      return;
    }
    if (!isReady || !bodyRef.current || countOverride <= 0) return;
    const hits = getSearchHits(bodyRef.current);
    if (hits.length === 0) return;
    const normalizedIndex = ((nextIndex % hits.length) + hits.length) % hits.length;
    const target = setActiveSearchHit(bodyRef.current, normalizedIndex);
    if (!target) return;
    const page = resolvePreviewPage(target, bodyRef.current);
    setSearchIndex(normalizedIndex);
    setActivePage(page);
    setPageInput(String(page));
    requestAnimationFrame(() => {
      scrollPreviewToElement(canvasRef.current, target, behavior);
    });
  }

  function changeSearchHit(delta) {
    jumpToSearchHit(searchIndex + delta);
  }

  function updateAuditPdfSearch(term) {
    const hits = getAuditPdfSearchHits(auditPdfPageTextsRef.current, term);
    auditPdfSearchHitsRef.current = hits;
    setSearchCount(hits.length);
    setSearchIndex(0);
    if (hits.length > 0) {
      const firstHit = hits[0];
      setActivePage(firstHit.page);
      setPageInput(String(firstHit.page));
      requestAnimationFrame(() => {
        scrollAuditPdfToPage(canvasRef.current, firstHit.page, "auto");
        flashAuditPdfPage(canvasRef.current, firstHit.page);
      });
    }
  }

  function syncPageFromScroll() {
    if (!isReady || !canvasRef.current) return;
    const page = isAuditPdfMode
      ? resolveVisibleAuditPdfPage(canvasRef.current)
      : resolveVisiblePreviewPage(canvasRef.current, bodyRef.current);
    if (!page || page === activePageRef.current) return;
    setActivePage(page);
    setPageInput(String(page));
  }

  function startOutlineResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = outlineWidth;

    function handleMove(moveEvent) {
      const nextWidth = clampNumber(startWidth + moveEvent.clientX - startX, 150, 360);
      setOutlineWidth(nextWidth);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("is-resizing-outline");
    }

    document.body.classList.add("is-resizing-outline");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function resizeOutlineByKeyboard(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 12;
    setOutlineWidth((width) => clampNumber(width + (event.key === "ArrowRight" ? step : -step), 150, 360));
  }

  function markFromPreview(event) {
    if (!canRenderDocx || !brushActive || mode !== "annotate") return;
    if (event?.target?.closest?.(".preview-mark-list, button")) return;
    const now = Date.now();
    if (now - lastBrushAtRef.current < 250) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    const eventTarget = event?.target;
    const anchorNode =
      selectedText && selection?.anchorNode
        ? selection.anchorNode
        : eventTarget?.nodeType === 1
          ? eventTarget
          : eventTarget?.parentElement;
    const container = bodyRef.current;
    const insidePreview = anchorNode && container?.contains(anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement);
    if (!insidePreview) return;

    const fallbackText =
      selectedText ||
      (insidePreview
        ? anchorNode?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)
        : "");
    const marker = createAnnotationMarkerData({
      container,
      selection,
      anchorNode,
      text: fallbackText,
      page: resolvePreviewPage(anchorNode, container),
    });

    const fieldId = onSlotClick?.({
      text: fallbackText,
      page: marker?.page ?? resolvePreviewPage(anchorNode, container),
      path: selectedText ? "文档选区" : "文档点击位置",
      marker,
    });
    if (fieldId) {
      lastBrushAtRef.current = now;
      applyPreviewMarker({
        fieldId,
        container,
        selection,
        anchorNode,
        text: fallbackText,
      });
    }
  }

  function markSelectionOnMouseUp(event) {
    if (!brushActive || mode !== "annotate") return;
    const selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
    if (selectedText) markFromPreview(event);
  }

  if (isOfficeMode) {
    return (
      <div className={`document-frame audit-office-frame ${activeOfficePreview ? "" : "empty-preview-frame"}`}>
        {activeOfficePreview ? (
          <OnlyOfficePreview
            key={`${activeOfficePreview.previewIdentity}|office|${activeOfficePreview.config?.document?.key || ""}`}
            config={activeOfficePreview.config}
            annotationFields={annotationFields}
            fillFields={fillFields}
            mode={mode}
            serverUrl={activeOfficePreview.serverUrl}
            onReady={() => setRenderState("ready")}
            onError={() => setRenderState("error")}
          />
        ) : (
          <PreviewState state={renderState} onUploadClick={onUploadClick} />
        )}
      </div>
    );
  }

  return (
    <div className={mode === "annotate" ? "document-frame annotate-frame" : "document-frame fill-frame"}>
      <div className="document-toolbar">
        <div className="doc-file">
          <FileCheck2 size={18} />
          {title}
        </div>
        <div className="doc-search">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                changeSearchHit(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="搜索文档"
            disabled={!isReady}
          />
          {searchTerm ? <em>{searchCount > 0 ? `${searchIndex + 1}/${searchCount}` : "0"}</em> : null}
          {searchTerm ? (
            <div className="search-nav">
              <button
                className="icon-button quiet"
                type="button"
                aria-label="上一处搜索结果"
                onClick={() => changeSearchHit(-1)}
                disabled={!isReady || searchCount === 0}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button quiet"
                type="button"
                aria-label="下一处搜索结果"
                onClick={() => changeSearchHit(1)}
                disabled={!isReady || searchCount === 0}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}
        </div>
        <form className="page-pager" onSubmit={handlePageSubmit}>
          <button
            className="icon-button quiet"
            type="button"
            aria-label="上一页"
            onClick={() => changePage(-1)}
            disabled={!isReady || activePage <= 1}
          >
            <ChevronLeft size={17} />
          </button>
          <span>页</span>
          <input
            value={pageInput}
            onChange={(event) => {
              const nextValue = event.target.value.replace(/\D/g, "");
              setPageInput(nextValue);
              if (nextValue) {
                jumpToPage(Number(nextValue));
              }
            }}
            disabled={!isReady}
            aria-label="页码"
          />
          <span>/ {pageCount || "--"}</span>
          <button
            className="icon-button quiet"
            type="button"
            aria-label="下一页"
            onClick={() => changePage(1)}
            disabled={!isReady || activePage >= pageCount}
          >
            <ChevronRight size={17} />
          </button>
        </form>
        <select
          className="zoom"
          value={zoomPercent}
          onChange={(event) => setZoomPercent(Number(event.target.value))}
          disabled={!isReady}
          aria-label="缩放比例"
        >
          {[50, 75, 90, 100, 110, 125, 150, 200].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
        <button className="ghost-button compact">
          <Eye size={16} />
          标注显示
        </button>
      </div>

      <div className="preview-layout" style={{ "--outline-width": `${outlineWidth}px` }}>
        <aside className="outline-panel">
          <div className="outline-head">
            <strong>大纲</strong>
            <span>{outlineItems.length} 项</span>
          </div>
          <div className="outline-list">
            {outlineItems.length === 0 ? (
              <div className="outline-empty">暂无大纲</div>
            ) : (
              outlineItems.map((item) => (
                <button key={item.id} onClick={() => jumpToOutline(item)} style={{ "--outline-depth": Math.min(item.level || 0, 6) }}>
                  <span>{item.title}</span>
                  <em>P{item.page}</em>
                </button>
              ))
            )}
          </div>
          <div
            className="outline-resizer"
            onPointerDown={startOutlineResize}
            onKeyDown={resizeOutlineByKeyboard}
            role="separator"
            aria-label="调整大纲宽度"
            aria-orientation="vertical"
            tabIndex={0}
            title="拖动调整大纲宽度"
          />
        </aside>
        <div
          className={`page-canvas ${renderState !== "ready" && !officePreview && !pdfUrl ? "empty-preview-canvas" : ""}`}
          ref={canvasRef}
          onScroll={syncPageFromScroll}
        >
        {isAuditPdfMode ? (
          officePreview ? (
            <OnlyOfficePreview
              key={`${previewIdentity}|office|${officePreview.config?.document?.key || ""}`}
              config={officePreview.config}
              serverUrl={officePreview.serverUrl}
              onReady={() => {
                setPageCount(1);
                setPageInput("1");
                setRenderState("ready");
              }}
              onError={() => {
                setOfficePreview(null);
                setRenderState("error");
              }}
            />
          ) : pdfUrl ? (
            <AuditPdfPreview
              key={`${previewIdentity}|${pdfUrl}`}
              pdfUrl={pdfUrl}
              previewIdentity={previewIdentity}
              zoomPercent={zoomPercent}
              onScrollChange={syncPageFromScroll}
              onTextReady={(pageTexts) => {
                auditPdfPageTextsRef.current = pageTexts;
                updateAuditPdfSearch(searchTerm);
                refreshAuditPdfOutlinePages();
              }}
              onOutlineReady={(pdfOutline) => {
                auditPdfOutlineRef.current = pdfOutline;
                setOutlineItems(pdfOutline);
              }}
              onReady={(nextPageCount) => {
                setPageCount(nextPageCount);
                const nextPage = clampNumber(activePageRef.current || 1, 1, nextPageCount || 1);
                setPageInput(String(nextPage));
                setRenderState("ready");
                requestAnimationFrame(() => {
                  scrollAuditPdfToPage(canvasRef.current, nextPage, "auto");
                  refreshAuditPdfOutlinePages();
                  window.setTimeout(refreshAuditPdfOutlinePages, 500);
                  window.setTimeout(refreshAuditPdfOutlinePages, 1400);
                });
              }}
              onError={() => setRenderState("error")}
            />
          ) : (
            <PreviewState state={renderState} onUploadClick={onUploadClick} />
          )
        ) : (
          <>
            <div className="docx-style-host" ref={styleRef} />
            {renderState !== "ready" ? <PreviewState state={renderState} onUploadClick={onUploadClick} /> : null}
            <div
              className={[
                "docx-preview-host",
                renderState === "ready" ? "ready" : "",
                brushActive && mode === "annotate" && renderState === "ready" ? "brush-mode" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--preview-zoom": `${zoomPercent}%` }}
              data-testid="docx-preview-host"
              onClick={markFromPreview}
              onMouseUp={markSelectionOnMouseUp}
              ref={bodyRef}
            />
            {mode === "annotate" && visibleAnnotationFields.length > 0 ? (
              <div className="preview-mark-list">
                {visibleAnnotationFields.map((field) => (
                  <button
                    className={[
                      "preview-chip",
                      field.id === selectedTemplateFieldId ? "active" : "",
                      field.status !== "已标注" ? "pending" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={field.id}
                    onClick={() => onSelectField?.(field.id)}
                  >
                    {getTemplateFieldSourceText(field) || field.name}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function OnlyOfficePreview({ config, annotationFields = [], fillFields = [], mode, serverUrl, onReady, onError }) {
  const containerRef = useRef(null);
  const holderIdRef = useRef(`onlyoffice-${Math.random().toString(36).slice(2)}`);
  const annotationFieldPayloadRef = useRef([]);
  const fillFieldPayloadRef = useRef([]);

  useEffect(() => {
    annotationFieldPayloadRef.current = buildOnlyOfficeAnnotationFieldPayload(annotationFields);
  }, [annotationFields, mode]);

  useEffect(() => {
    fillFieldPayloadRef.current = buildOnlyOfficeFillFieldPayload(fillFields);
    if (mode === "fill") {
      postOnlyOfficeCommand(containerRef.current, {
        source: "guangfa-parent",
        action: "sync-fill-fields",
        fields: fillFieldPayloadRef.current,
      }, 2);
    }
  }, [fillFields, mode]);

  useEffect(() => {
    let cancelled = false;
    let editor = null;
    const container = containerRef.current;
    if (!container) return undefined;

    container.replaceChildren();
    const holder = document.createElement("div");
    holder.id = holderIdRef.current;
    holder.style.width = "100%";
    holder.style.height = "100%";
    container.append(holder);

    loadOnlyOfficeApi(serverUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI?.DocEditor) return;
        editor = new window.DocsAPI.DocEditor(holderIdRef.current, {
          ...config,
          width: "100%",
          height: "100%",
          events: {
            ...(config.events || {}),
            onAppReady: () => {
              config.events?.onAppReady?.();
              onReady?.();
              if (mode === "fill") {
                window.setTimeout(() => {
                  postOnlyOfficeCommand(container, { source: "guangfa-parent", action: "enable-track-revisions" });
                  postOnlyOfficeCommand(container, {
                    source: "guangfa-parent",
                    action: "sync-fill-fields",
                    fields: fillFieldPayloadRef.current,
                  });
                }, 350);
              }
            },
            onDocumentReady: () => {
              config.events?.onDocumentReady?.();
            },
            onDownloadAs: (event) => {
              config.events?.onDownloadAs?.(event);
              window.dispatchEvent(new CustomEvent("guangfa-onlyoffice-download-as", { detail: event?.data || {} }));
            },
            onError: () => onError?.(),
          },
        });
        window.__guangfaActiveOnlyOfficeEditor = editor;
      })
      .catch(() => onError?.());

    return () => {
      cancelled = true;
      if (window.__guangfaActiveOnlyOfficeEditor === editor) window.__guangfaActiveOnlyOfficeEditor = null;
      try {
        editor?.destroyEditor?.();
      } catch {}
      if (container.contains(holder)) container.removeChild(holder);
    };
  }, [config, serverUrl]);

  return <div className="onlyoffice-preview-host" ref={containerRef} />;
}

function buildOnlyOfficeAnnotationFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    name: getTemplateFieldSourceText(field) || field.name,
    page: field.page,
    marker: field.marker
      ? {
          text: field.marker.text || "",
        }
      : null,
  }));
}

function buildOnlyOfficeFillFieldPayload(fields = []) {
  return fields.map((field) => ({
    id: field.id,
    bookmarkName: getFillTargetBookmarkName(field),
    name: getFieldDisplayText(field),
    category: normalizeFieldCategory(field.category || field.type),
    sourceText: getTemplateFieldSourceText(field),
    requiresInputPoint: requiresInputPoint(field),
    hasInputPoint: hasInputPoint(field),
    page: field.page,
    marker: field.marker?.text ? { text: field.marker.text } : null,
    answerFormat: field.answerFormat,
    question: field.question,
    value: field.value || "",
    amountValue: field.amountValue || "",
    choiceValue: field.choiceValue || "",
    fillMode: normalizeFillMode(field.fillMode, field),
    fillText: buildOnlyOfficeLiveFillText(field),
  }));
}

function postOnlyOfficeCommand(container, message, attempts = 8) {
  const frames = [...(container?.querySelectorAll?.("iframe") || [])];
  frames.forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
    } catch {}
  });
  if (attempts > 0) {
    window.setTimeout(() => postOnlyOfficeCommand(container, message, attempts - 1), 250);
  }
}

function requestOnlyOfficeDocumentSave(trigger = "manual") {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage({ source: "guangfa-parent", action: "save-document", trigger }, "*");
    } catch {}
  });
}

function requestOnlyOfficeAddFieldBookmark(field) {
  if (!field?.marker?.selectionState) return;
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "add-field-bookmark",
    field: {
      id: field.id,
      bookmarkName: getFillBookmarkName(field),
      selectionState: field.marker.selectionState,
    },
  });
}

function requestOnlyOfficeAddInputPoint(field) {
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "add-input-point",
    field: {
      id: field.id,
      bookmarkName: field.inputPoint?.bookmarkName || getInputPointBookmarkName(field),
    },
  });
}

function requestOnlyOfficeFillField(field) {
  if (!field?.value && !field?.choiceValue) return;
  if (requiresInputPoint(field) && !hasInputPoint(field)) {
    console.warn("[fill] skip write without input point", { id: field.id, sourceText: getTemplateFieldSourceText(field) });
    return;
  }
  postAllOnlyOfficeFrames({
    source: "guangfa-parent",
    action: "fill-field-value",
    field: {
      id: field.id,
      bookmarkName: getFillTargetBookmarkName(field),
      page: field.page,
      marker: field.marker?.text ? { text: field.marker.text } : null,
      name: getFieldDisplayText(field),
      category: normalizeFieldCategory(field.category || field.type),
      sourceText: getTemplateFieldSourceText(field),
      value: field.value,
      amountValue: field.amountValue || "",
      choiceValue: field.choiceValue || "",
      fillMode: normalizeFillMode(field.fillMode, field),
      fillText: buildOnlyOfficeLiveFillText(field),
    },
  }, 0);
}

function postAllOnlyOfficeFrames(message, attempts = 8) {
  [...document.querySelectorAll("iframe")].forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
    } catch {}
  });
  if (attempts > 0) window.setTimeout(() => postAllOnlyOfficeFrames(message, attempts - 1), 250);
}

function requestOnlyOfficeDocumentDownloadAs(fileType = "docx", timeoutMs = 20000) {
  const editor = window.__guangfaActiveOnlyOfficeEditor;
  if (!editor || typeof editor.downloadAs !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (buffer) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("guangfa-onlyoffice-download-as", handleDownloadAs);
      resolve(buffer || null);
    };
    const handleDownloadAs = async (event) => {
      const url = event.detail?.url;
      if (!url) return finish(null);
      try {
        finish(await fetchOnlyOfficeDownloadAsBuffer(url));
      } catch {
        finish(null);
      }
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("guangfa-onlyoffice-download-as", handleDownloadAs);
    try {
      editor.downloadAs(fileType);
    } catch {
      finish(null);
    }
  });
}

async function fetchOnlyOfficeDownloadAsBuffer(url) {
  const response = await fetch("/api/office/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return response.ok ? response.arrayBuffer() : null;
}

function buildOnlyOfficeLiveFillText(field = {}) {
  const value = getFieldAmountValue(field);
  if (!value) return "";
  if (hasInputPoint(field) && !isReplacementField(field)) return value;
  const source = getTemplateFieldSourceText(field);
  if (!source) return value;
  if (/[□☐○〇▢☑✓✔]/.test(source)) return buildOnlyOfficeChoiceFillText(source, getFieldChoiceValue(field) || value);
  if (/[_＿—-]{2,}|\s{2,}/.test(source)) return source.replace(/_{2,}|＿+|—+|-{2,}|\s{2,}/, value);
  const colonBlank = source.match(/^(.*?[：:])\s+(.*)$/);
  if (colonBlank) return `${colonBlank[1]}${value}${colonBlank[2]}`;
  if (/[：:]\s*$/.test(source)) return `${source}${value}`;
  return value;
}

function getFieldAmountValue(field = {}) {
  return String(field.amountValue || field.value || "").trim();
}

function getFieldChoiceValue(field = {}) {
  if (normalizeFillMode(field.fillMode, field) === "amount-choice") return String(field.choiceValue || "").trim();
  return String(field.choiceValue || field.value || "").trim();
}

function buildOnlyOfficeChoiceFillText(source, value) {
  const cleanValue = normalizeChoiceText(value);
  const base = source.replace(/[☑✓✔]/g, "□");
  const match = [...base.matchAll(/[□☐○〇▢]\s*([^□☐○〇▢☑✓✔]{1,80})/g)]
    .map((item) => ({ item, score: scoreChoiceOptionMatch(item[1], cleanValue) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || normalizeChoiceText(b.item[1]).length - normalizeChoiceText(a.item[1]).length)[0]?.item;
  return match ? `${base.slice(0, match.index)}☑${base.slice(match.index + 1)}` : value;
}

function scoreChoiceOptionMatch(optionText, normalizedValue) {
  const option = normalizeChoiceText(optionText);
  if (!option || !normalizedValue) return 0;
  if (option === normalizedValue) return 100;
  if (option.includes(normalizedValue)) return 90;
  if (normalizedValue.includes(option)) return 70;
  return 0;
}

function readOnlyOfficePageNumber(payload) {
  const value =
    typeof payload === "number" || typeof payload === "string"
      ? payload
      : payload?.page ?? payload?.currentPage ?? payload?.visiblePage ?? payload?.value;
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function loadOnlyOfficeApi(serverUrl) {
  const scriptUrl = `${String(serverUrl || "").replace(/\/$/, "")}/web-apps/apps/api/documents/api.js?gf=5`;
  const existing = [...document.scripts].find((script) => script.src === scriptUrl);
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

function AuditPdfPreview({ pdfUrl, previewIdentity, zoomPercent, onReady, onError, onScrollChange, onTextReady, onOutlineReady }) {
  return (
    <div className="pdf-preview-host" data-testid="pdf-preview-host" data-preview-identity={previewIdentity}>
      <PdfLoader
        key={`${previewIdentity}|loader|${pdfUrl}`}
        url={pdfUrl}
        workerSrc={pdfWorkerUrl}
        beforeLoad={<PreviewState state="loading" />}
        errorMessage={<PreviewState state="error" />}
        onError={onError}
      >
        {(pdfDocument) => (
          <AuditPdfHighlighter
            key={`${previewIdentity}|highlighter|${pdfDocument?.fingerprints?.[0] || pdfDocument?.numPages || "pdf"}|${zoomPercent}`}
            pdfDocument={pdfDocument}
            previewIdentity={previewIdentity}
            zoomPercent={zoomPercent}
            onReady={onReady}
            onScrollChange={onScrollChange}
            onTextReady={onTextReady}
            onOutlineReady={onOutlineReady}
          />
        )}
      </PdfLoader>
    </div>
  );
}

function AuditPdfHighlighter({ pdfDocument, previewIdentity, zoomPercent, onReady, onScrollChange, onTextReady, onOutlineReady }) {
  const hostRef = useRef(null);
  const onTextReadyRef = useRef(onTextReady);
  const onOutlineReadyRef = useRef(onOutlineReady);
  const hasPdfOutlineRef = useRef(false);

  useEffect(() => {
    onTextReadyRef.current = onTextReady;
  }, [onTextReady]);

  useEffect(() => {
    onOutlineReadyRef.current = onOutlineReady;
  }, [onOutlineReady]);

  useEffect(() => {
    onReady?.(pdfDocument.numPages || 1);
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    flattenAuditPdfOutline(pdfDocument)
      .then((outline) => {
        if (!cancelled) {
          hasPdfOutlineRef.current = outline.length > 0;
          onOutlineReadyRef.current?.(outline);
        }
      })
      .catch(() => {
        if (!cancelled) {
          hasPdfOutlineRef.current = false;
          onOutlineReadyRef.current?.([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      collectPdfPageTexts(pdfDocument)
        .then((pageTexts) => {
          if (!cancelled) onTextReadyRef.current?.(pageTexts);
        })
        .catch(() => {
          if (!cancelled) onTextReadyRef.current?.([]);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pdfDocument]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    function attachScrollListener() {
      if (cancelled) return;
      const scrollContainer = getAuditPdfScrollContainer(hostRef.current);
      if (!scrollContainer || scrollContainer === hostRef.current) {
        requestAnimationFrame(attachScrollListener);
        return;
      }
      scrollContainer.addEventListener("scroll", onScrollChange, { passive: true });
      cleanup = () => scrollContainer.removeEventListener("scroll", onScrollChange);
    }

    requestAnimationFrame(attachScrollListener);
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [pdfDocument, onScrollChange]);

  return (
    <div ref={hostRef} className="audit-pdf-viewer" data-preview-identity={previewIdentity}>
      <PdfHighlighter
        key={`${previewIdentity}|pdf-viewer|${pdfDocument?.fingerprints?.[0] || pdfDocument?.numPages || "pdf"}|${zoomPercent}`}
        pdfDocument={pdfDocument}
        pdfScaleValue={zoomPercent === 100 ? "page-width" : String(zoomPercent / 100)}
        highlights={emptyPdfHighlights}
        onScrollChange={onScrollChange}
        scrollRef={() => {}}
        highlightTransform={() => null}
        onSelectionFinished={() => null}
        enableAreaSelection={() => false}
      />
    </div>
  );
}

function FieldLine({ slot, field, mode, active, brushActive, onClick }) {
  const isAnnotate = mode === "annotate";
  const isMarked = Boolean(field);
  const tag = isAnnotate ? (isMarked ? "已标注" : brushActive ? "点击标注" : "未标注") : field?.status;
  const value = isAnnotate ? (isMarked ? `{{${getTemplateFieldSourceText(field) || field.name || slot.suggestedName}}}` : "") : field?.value ?? "";

  return (
    <button
      className={[
        "field-line",
        "doc-slot",
        active ? "active" : "",
        isMarked ? "marked" : "",
        isAnnotate && brushActive && !isMarked ? "brush-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={!isAnnotate}
      onClick={onClick}
      type="button"
    >
      <span>{slot.label}</span>
      <div className="blank-line">
        <strong>{value}</strong>
      </div>
      {tag ? <em>{tag}</em> : null}
    </button>
  );
}

function PreviewState({ state, onUploadClick }) {
  const meta = {
    empty: {
      icon: Upload,
      title: "请先上传 DOCX 模板",
      desc: "上传后在 OnlyOffice 中选中文字，点击定制组件里的标注字段。",
    },
    loading: {
      icon: Loader2,
      title: "正在加载文档预览",
      desc: "正在解析上传的 DOCX 模板。",
    },
    unsupported: {
      icon: CircleAlert,
      title: "暂不支持该文件格式",
      desc: "浏览器预览阶段请上传 .docx 文件；.doc 文件后续由后端转换后再支持。",
    },
    error: {
      icon: CircleAlert,
      title: "文档预览加载失败",
      desc: "请确认文件没有损坏，或换一个 DOCX 模板重试。",
    },
  };
  const current = meta[state] ?? meta.empty;
  const Icon = current.icon;
  const canUpload = state === "empty" && onUploadClick;

  return (
    <div
      className={`preview-state ${state} ${canUpload ? "clickable" : ""}`}
      onClick={canUpload ? onUploadClick : undefined}
      onKeyDown={
        canUpload
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") onUploadClick();
            }
          : undefined
      }
      role={canUpload ? "button" : undefined}
      tabIndex={canUpload ? 0 : undefined}
    >
      <Icon size={24} className={state === "loading" ? "spin" : ""} />
      <strong>{current.title}</strong>
      <span>{current.desc}</span>
      {canUpload ? (
        <button
          className="mini-button blue"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUploadClick();
          }}
        >
          <Upload size={15} />
          上传文档
        </button>
      ) : null}
    </div>
  );
}

function FieldForm({ field, onChange, onAddInputPoint }) {
  if (!field) {
    return (
      <div className="field-form empty-form">
        <Info size={20} />
        <span>在文档中选中文字并点击标注字段，或选择字段编辑</span>
      </div>
    );
  }

  function updateType(type) {
    const category = normalizeFieldCategory(type);
    onChange({ type: category, category, fillMode: inferFillMode({ ...field, category, type: category }) });
  }
  function updateFillMode(fillMode) {
    onChange({ fillMode });
  }
  const sourceText = getTemplateFieldSourceText(field);
  const category = normalizeFieldCategory(field.category || field.type);
  const fillMode = normalizeFillMode(field.fillMode, field);
  const modeOptions = getFillModeOptions({ ...field, category, type: category });
  const modeLabel = category === "单选项" ? "单选细分" : "填空类型";
  const hasInput = hasInputPoint(field);

  return (
    <div className="field-form">
      <div className="field-context">
        <span>模板选区原文</span>
        <p>{sourceText || "暂无选区上下文"}</p>
      </div>
      <div className="field-context input-point-context">
        <span>填写输入点</span>
        <p>{hasInput ? `已设置，第 ${field.inputPoint?.page || field.page || 1} 页` : isReplacementField(field) ? "单选项将使用标注选区作为写入范围" : "未设置，请把光标放到实际填写位置后点击添加输入点"}</p>
      </div>
      <label>
        <span>自动填充类别</span>
        <select value={category} onChange={(event) => updateType(event.target.value)}>
          {fieldCategoryOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>{modeLabel}</span>
        <select value={fillMode} onChange={(event) => updateFillMode(event.target.value)}>
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="field-form-actions">
        <button className={hasInput ? "tool-button is-selected" : "tool-button"} type="button" onClick={onAddInputPoint}>
          <PenLine size={16} />
          {hasInput ? "重设输入点" : "添加输入点"}
        </button>
      </div>
    </div>
  );
}

function FillFieldRow({ field, index, selected, onSelect, onGenerate, generateDisabled, onUpdateValue, onConfirm }) {
  const rowRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(field.value || "");
  const choiceOptions = useMemo(() => getChoiceEditOptions(field), [field]);
  const isChoiceEditing = field.type === "单选项" && choiceOptions.length > 0;
  const isDateEditing = isDateField(field);

  useEffect(() => {
    if (!editing) setDraftValue(field.value || "");
  }, [editing, field.value]);

  useGSAP(
    () => {
      if (!selected) return;
      gsap.fromTo(
        rowRef.current,
        { backgroundColor: "#eef5ff" },
        { backgroundColor: "#ffffff", duration: 0.7, ease: "power1.out" },
      );
    },
    { dependencies: [selected], scope: rowRef },
  );

  return (
    <div
      className={selected ? "field-row selected" : "field-row"}
      data-testid={`fill-row-${field.id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      ref={rowRef}
      role="button"
      tabIndex={0}
    >
      <div className="field-card-head">
        <span className="row-index">{index + 1}</span>
        <strong title={getFieldDisplayText(field)}>{getFieldDisplayText(field)}</strong>
        <StatusPill status={field.status} />
      </div>
      {editing ? (
        isChoiceEditing ? (
          <div className="field-choice-editor" onClick={(event) => event.stopPropagation()}>
            {choiceOptions.map((option) => {
              const active = normalizeChoiceText(option) === normalizeChoiceText(draftValue);
              return (
                <button
                  className={active ? "choice-edit-option selected" : "choice-edit-option"}
                  key={option}
                  type="button"
                  onClick={() => setDraftValue(option)}
                >
                  {active ? "☑" : "□"}
                  <span>{option}</span>
                </button>
              );
            })}
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="选中项文本"
            />
          </div>
        ) : isDateEditing ? (
          <div className="field-date-editor" onClick={(event) => event.stopPropagation()}>
            <input
              className="field-value-editor compact"
              type="date"
              value={toDateInputValue(draftValue)}
              onChange={(event) => setDraftValue(formatChineseDateFromInput(event.target.value))}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="YYYY年MM月DD日"
            />
          </div>
        ) : (
          <textarea
            className="field-value-editor"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="输入填充内容"
            rows={4}
          />
        )
      ) : (
        <div className={field.value ? "field-value rich" : "field-value empty"}>
          {field.value || "暂未生成"}
        </div>
      )}
      {field.evidence && field.status !== "未填充" ? (
        <div className="field-evidence">
          <span>溯源</span>
          <p>{field.evidence}</p>
          <em>{field.source}</em>
        </div>
      ) : null}
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        {editing ? (
          <>
            <button
              className="mini-button blue"
              onClick={() => {
                onUpdateValue(draftValue);
                setEditing(false);
              }}
            >
              <Save size={15} />
              保存
            </button>
            <button
              className="mini-button"
              onClick={() => {
                setDraftValue(field.value || "");
                setEditing(false);
              }}
            >
              <X size={15} />
              取消
            </button>
          </>
        ) : (
          <>
            <button
              className="mini-button blue"
              data-testid={`generate-${field.id}`}
              onClick={onGenerate}
              disabled={generateDisabled || field.status === "生成中"}
            >
              {field.status === "生成中" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
              AI填充
            </button>
            <button
              className="mini-button"
              onClick={() => {
                setDraftValue(field.value || "");
                setEditing(true);
              }}
              disabled={field.status === "生成中"}
            >
              <PenLine size={15} />
              编辑
            </button>
            <button
              className="mini-button"
              data-testid={`confirm-${field.id}`}
              onClick={onConfirm}
              disabled={field.status === "已确认" || !field.value}
            >
              <Check size={15} />
              确认
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function getChoiceEditOptions(field) {
  const context = [field.answerFormat, field.question, getFieldChoiceValue(field)]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").trim())
    .filter(Boolean)
    .join("\n");
  const options = [];

  [...context.matchAll(/[□☐○〇▢☑✓✔]\s*([^□☐○〇▢☑✓✔\n\r]{2,80})/g)].forEach((match) => {
    options.push(cleanChoiceOptionText(match[1]));
  });

  if (options.length === 0) {
    const lineOptions = context
      .split(/\n+/)
      .map((line) => cleanChoiceOptionText(line))
      .filter((line) => /^[^\s].{1,80}$/.test(line) && /综合评估法|综合评分法|最低投标价法|含税|不含税/.test(line));
    options.push(...lineOptions);
  }

  if (options.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), options);
  }
  if (getFieldChoiceValue(field)) options.push(getFieldChoiceValue(field));

  return [...new Map(options
    .map((option) => cleanChoiceOptionText(option))
    .filter((option) => normalizeChoiceText(option).length >= 2)
    .map((option) => [normalizeChoiceText(option), option])).values()];
}

function cleanChoiceOptionText(value) {
  return String(value || "")
    .replace(/^模板上下文[：:]/, "")
    .replace(/^[□☐○〇▢☑✓✔]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toDateInputValue(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

function formatChineseDateFromInput(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}年${padDatePart(parts.month)}月${padDatePart(parts.day)}日`;
}

function StatusPill({ status }) {
  const meta = statusMeta[status] ?? statusMeta["未填充"];
  const Icon = meta.icon;
  return (
    <span className={`status-pill ${meta.tone}`}>
      <Icon size={14} className={status === "生成中" ? "spin" : ""} />
      {status}
    </span>
  );
}

function CitationDrawer({ field, onClose }) {
  const drawerRef = useRef(null);

  useGSAP(
    () => {
      gsap.fromTo(
        drawerRef.current,
        { x: 22, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out" },
      );
    },
    { dependencies: [field.id], scope: drawerRef },
  );

  return (
    <section className="citation-drawer" data-testid="citation-drawer" ref={drawerRef}>
      <div className="drawer-head">
        <div>
          <h2>溯源信息</h2>
          <p>{field.name}</p>
        </div>
        <button className="icon-button quiet" onClick={onClose} aria-label="关闭溯源">
          <X size={18} />
        </button>
      </div>
      <dl className="citation-meta">
        <div>
          <dt>填充内容</dt>
          <dd>{field.value || "暂未生成"}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{field.source}</dd>
        </div>
        <div>
          <dt>匹配置信度</dt>
          <dd>{field.confidence || 0}%</dd>
        </div>
      </dl>
      <div className="confidence-bar">
        <span style={{ width: `${Math.max(field.confidence, 8)}%` }} />
      </div>
      <div className="evidence-box">
        <strong>证据片段</strong>
        <p>{field.evidence}</p>
      </div>
      <button className="wide-button">
        <Sparkles size={16} />
        查看完整来源
      </button>
    </section>
  );
}

function SaveStateNotice({ state, fieldCount, invalidCount }) {
  const copy = {
    idle: "待上传模板",
    uploaded: "已上传，待标注",
    dirty: "有未保存修改",
    saving: "正在保存模板",
    saved: "模板已保存",
    incomplete: fieldCount === 0 ? "请先标注字段" : invalidCount > 0 ? `${invalidCount} 项属性未完善` : "有字段待确认",
    "no-file": "请先上传模板",
    unsupported: "仅支持DOCX预览",
    "storage-error": "模板存储失败",
  };
  const tone =
    state === "saved"
      ? "green"
      : state === "incomplete" || state === "no-file" || state === "unsupported" || state === "storage-error"
        ? "amber"
        : "blue";

  return <div className={`save-state ${tone}`}>{copy[state] ?? copy.idle}</div>;
}

function getNextFieldNumber(fields) {
  return (
    fields.reduce((max, field) => {
      const number = Number(field.id.replace(/\D/g, ""));
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0) + 1
  );
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "未知大小";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

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

async function enhanceAuditWithAiOutline(auditResult, file, config, onlyOfficeOutline, userInstruction = "") {
  const enabledSet = new Set(config.enabled || []);
  const aiOutlineEnabled = shouldRunAiOutlineAudit(config);
  const baseIssues = (auditResult.issues || []).filter((issue) => !aiOutlineSourceIssueIds.has(issue.id));
  if (!aiOutlineEnabled) return { ...auditResult, issues: baseIssues };
  if (!onlyOfficeOutline?.ok || !Array.isArray(onlyOfficeOutline.items) || onlyOfficeOutline.items.length === 0) {
    return { ...auditResult, aiError: "OnlyOffice 大纲未挂载，不能开始 AI 审查。", issues: baseIssues };
  }

  const structure = file.structure || (await readDocxStructure(file.buffer.slice(0)).catch(() => null));
  const candidates = buildAiOutlineCandidates(structure, onlyOfficeOutline);
  if (candidates.length === 0) return { ...auditResult, issues: baseIssues };

  let data = {};
  try {
    const response = await fetch("/api/ai/format-outline-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates,
        onlyOfficeOutline: normalizeOnlyOfficeOutlineForAi(onlyOfficeOutline),
        auditRules: getUniversalOutlineAuditRules(),
        userInstruction,
      }),
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AI 标题/大纲审查失败");
  } catch (error) {
    return {
      ...auditResult,
      aiError: error?.message || "AI 标题/大纲审查失败，请检查模型配置。",
      issues: baseIssues,
    };
  }
  const plannedTargets = mergeAiOutlineTargets(buildForcedOutlineTargets(candidates), data.targets || []);
  const aiIssues = createAiOutlineIssues(filterResolvedAiOutlineTargets(plannedTargets, candidates), enabledSet);
  return {
    ...auditResult,
    aiError: "",
    issues: [...baseIssues, ...aiIssues],
  };
}

function buildForcedOutlineTargets(candidates) {
  return candidates
    .filter((item) => item.sourceIssue === "onlyoffice-empty-outline")
    .map((item) => ({
      paragraphIndex: item.paragraphIndex,
      outlineIndex: item.outlineIndex,
      outlineLevel: item.outlineLevel,
      text: item.text,
      operation: "demote",
      level: null,
      reason: "空标题",
    }));
}

function mergeAiOutlineTargets(baseTargets, aiTargets) {
  const seen = new Set();
  return [...baseTargets, ...aiTargets].filter((target) => {
    const key = `${target.outlineIndex ?? target.paragraphIndex}-${target.operation}-${target.level ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getUniversalOutlineAuditRules() {
  return [
    "只判断样式和大纲层级，不修改正文文本。",
    "先根据当前文档 OnlyOffice 大纲中占多数的编号形态、样式名称、层级分布归纳本文档规则。",
    "不要假设所有文档都使用“第X章/一、/1.”对应固定层级。",
    "明显标题形态不应降为正文；只在层级异常时调整 displayLevel。",
    "正文长段、说明性句子、承诺正文、单位落款、空标题不应进入大纲。",
    "不确定的项目标记 manual，不强行修复。",
    "只输出脚本可安全执行的结构化修复计划。",
  ];
}

function normalizeOnlyOfficeOutlineForAi(outline) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  return outline.items.slice(0, 300).map((item) => ({
    index: Number(item.index) || 0,
    level: Number(item.level) || 0,
    title: item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim(),
    isEmptyItem: Boolean(item.isEmptyItem),
    isNotHeader: Boolean(item.isNotHeader),
  }));
}

function buildAiOutlineCandidates(structure, onlyOfficeOutline) {
  return buildOnlyOfficeOutlineCandidates(onlyOfficeOutline, structure);
}

function buildOnlyOfficeOutlineCandidates(outline, structure) {
  if (!outline?.ok || !Array.isArray(outline.items)) return [];
  const headingBlocks = (structure?.blocks || []).filter((block) => block.type === "paragraph" && block.isHeading);
  const byText = new Map();
  headingBlocks.forEach((block) => {
    const key = normalizeOutlineMatchText(block.text);
    const list = byText.get(key) || [];
    list.push(block);
    byText.set(key, list);
  });

  return outline.items.slice(0, 300).map((item, order) => {
    const title = item.isEmptyItem ? "空标题" : String(item.title || item.displayTitle || "").replace(/\s+/g, " ").trim();
    const textMatch = byText.get(normalizeOutlineMatchText(title))?.shift();
    const block = textMatch || headingBlocks[order] || null;
    return {
      paragraphIndex: block?.paragraphIndex || null,
      outlineIndex: Number(item.index) || 0,
      outlineLevel: Number(item.level) || 0,
      text: title,
      currentLevel: Number(item.level) || 0,
      isHeading: true,
      styleName: block?.styleName || "",
      sourceIssue: item.isEmptyItem ? "onlyoffice-empty-outline" : "onlyoffice-outline-table",
      isEmptyOutline: Boolean(item.isEmptyItem),
    };
  }).filter((item) => item.paragraphIndex);
}

function buildOnlyOfficeOutlineTextMap(outline) {
  const map = new Map();
  if (!outline?.ok || !Array.isArray(outline.items)) return map;
  outline.items.forEach((item) => {
    const key = normalizeOutlineMatchText(item.title || item.displayTitle || "");
    if (!key || item.isEmptyItem) return;
    const list = map.get(key) || [];
    list.push({ index: Number(item.index), level: Number(item.level) });
    map.set(key, list);
  });
  return map;
}

function normalizeOutlineMatchText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getAiOutlineBlockLevel(block) {
  if (!block?.isHeading || !Number.isInteger(block.level) || block.level <= 0) return null;
  return block.level - 1;
}

function filterResolvedAiOutlineTargets(targets, candidates) {
  const candidatesByParagraph = new Map(candidates.map((item) => [Number(item.paragraphIndex), item]));
  const candidatesByOutline = new Map(candidates.map((item) => [Number(item.outlineIndex), item]));
  return targets.map((target) => {
    const candidate = candidatesByOutline.get(Number(target.outlineIndex)) || candidatesByParagraph.get(Number(target.paragraphIndex));
    const operation = target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep";
    const targetLevel = Number(target.level);
    const valid = operation === "demote"
      ? Boolean(candidate?.isHeading || Number.isInteger(candidate?.currentLevel)) && isSafeOutlineDemoteTarget(candidate)
      : operation === "heading" && Number.isInteger(targetLevel)
        ? candidate?.currentLevel !== targetLevel
        : false;
    if (!valid) return null;
    return {
      ...target,
      text: target.text || candidate?.text || "",
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : candidate?.outlineIndex,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : candidate?.outlineLevel,
    };
  }).filter(Boolean);
}

function isSafeOutlineDemoteTarget(candidate) {
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "空标题" || candidate?.sourceIssue === "onlyoffice-empty-outline") return true;
  if (isProtectedOutlineHeading(text)) return false;
  if (/[。；;]$/.test(text)) return true;
  if (text.length > 42) return true;
  if (text.length > 24 && /[，,。；;：:]/.test(text)) return true;
  if (/供应商名称|盖章|公章|日期/.test(text)) return true;
  return false;
}

function isProtectedOutlineHeading(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || /[。；;：:]$/.test(value)) return false;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,60}$/.test(value)) return true;
  if (/^（[一二三四五六七八九十]+）\S{1,60}$/.test(value)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．]?\S{1,48}$/.test(value)) return true;
  return false;
}

function isAiOutlineCandidateBlock(block) {
  const text = String(block.text || "").replace(/\s+/g, " ").trim();
  if (!text || text === "目录" || text.length > 140) return false;
  if (block.isHeading || /标题|heading/i.test(block.styleName || "")) return true;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇]/.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\S{1,40}$/.test(text)) return true;
  if (/^\d+(?:[.．]\d+)*[、.．\s]\S{1,48}$/.test(text)) return true;
  return false;
}

function createAiOutlineIssues(targets, enabledSet) {
  const normalizedTargets = targets
    .map((target) => ({
      index: Number(target.paragraphIndex) - 1,
      outlineIndex: Number.isInteger(Number(target.outlineIndex)) ? Number(target.outlineIndex) : null,
      outlineLevel: Number.isInteger(Number(target.outlineLevel)) ? Number(target.outlineLevel) : null,
      text: String(target.text || "").slice(0, 120),
      operation: target.operation === "heading" ? "heading" : target.operation === "demote" ? "demote" : "keep",
      level: Number.isInteger(Number(target.level)) ? Number(target.level) : null,
      reason: String(target.reason || "").slice(0, 120),
    }))
    .filter((target) => target.index >= 0 && target.operation !== "keep");
  return normalizedTargets
    .map((target) => makeAiOutlineIssue(target))
    .filter((issue) => isAuditIssueEnabled(issue, enabledSet));
}

function makeAiOutlineIssue(target) {
  const isHeading = target.operation === "heading";
  const auditConfigKey = isHeading ? "missing-heading-style" : "body-outline";
  const title = isHeading ? "标题未入大纲" : "正文误入标题";
  const description = isHeading ? "AI 判断该段应进入标题层级，修复时由脚本套用对应 Word 标题样式。" : "AI 判断该段应为正文，修复时由脚本移出 Word 大纲。";
  return {
    id: `ai-outline-${target.operation}-${target.outlineIndex ?? target.index}-${target.level ?? "body"}`,
    title,
    category: "标题体系",
    description,
    severity: "medium",
    layer: "safe",
    fixable: true,
    auditConfigKey,
    action: "applyAiOutlinePlan",
    count: 1,
    targets: [target],
    samples: [`${target.text || target.reason || "AI 审查项"}${target.reason ? `（${target.reason}）` : ""}`],
  };
}

function getOutlineRevisionReason(target) {
  const text = String(target?.text || "").trim();
  const reason = String(target?.reason || "").trim();
  if (!text) return "空标题";
  if (/空标题/.test(reason)) return "空标题";
  if (target?.operation === "demote") return "正文误入";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return "层级异常";
  return reason.slice(0, 4) || "大纲异常";
}

function getOutlineRevisionAction(target) {
  if (target?.operation === "demote") return "改正文";
  if (target?.operation === "heading" && Number.isInteger(target?.level)) return `改L${target.level + 1}`;
  return "人工确认";
}

async function readMaterialFile(file) {
  const isDocx = /\.docx$/i.test(file.name);
  const text = isDocx ? await readDocxText(file) : await file.text();
  return {
    id: `MAT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: formatFileSize(file.size),
    storage: "temporary",
    text: text.replace(/\s+/g, " ").trim().slice(0, 16000),
  };
}

async function readKnowledgeDocumentFile(file) {
  const isDocx = /\.docx$/i.test(file.name);
  const text = isDocx ? await readDocxText(file) : await file.text();
  return {
    id: `KDOC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: formatFileSize(file.size),
    text: text.replace(/\s+/g, " ").trim().slice(0, 250000),
  };
}

async function readDocxText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return "";
  return documentXml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function summarizeFieldTypes(fields = []) {
  const counts = fields.reduce((acc, field) => {
    const type = normalizeFieldCategory(field.type || field.category || "未分类");
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

function inferTemplateCategory(value = "") {
  const text = String(value || "");
  if (/合同|协议|采购合同|施工合同|服务合同/.test(text)) return "合同类";
  if (/方案|技术方案|响应文件|施工组织|实施方案/.test(text)) return "方案类";
  return "招标类";
}

function normalizeTemplateCategory(category) {
  return templateCategories.includes(category) && category !== "全部" ? category : "招标类";
}

function getContractFolder(template = {}) {
  if (template.level1 && template.level2) return `${template.level1}/${template.level2}`;
  if (template.folder) return template.folder;
  if (template.subCategory) return `未分组/${template.subCategory}`;
  return "未分组/未分组";
}

function buildContractFolders(templates) {
  const folders = new Map();
  templates
    .filter((template) => template.category === "合同类")
    .forEach((template) => {
      const key = template.contractFolder || getContractFolder(template);
      const [level1 = "未分组", level2 = "未分组"] = key.split("/");
      const current = folders.get(key) || { key, level1, level2, count: 0 };
      current.count += 1;
      folders.set(key, current);
    });
  return [...folders.values()].sort((a, b) => a.level1.localeCompare(b.level1, "zh-CN") || a.level2.localeCompare(b.level2, "zh-CN"));
}

function groupContractFolders(folders) {
  const groups = new Map();
  folders.forEach((folder) => {
    const group = groups.get(folder.level1) || { level1: folder.level1, folders: [], count: 0 };
    group.folders.push(folder);
    group.count += folder.count;
    groups.set(folder.level1, group);
  });
  return [...groups.values()];
}

function getTemplateCategoryTone(category) {
  if (category === "合同类") return "green";
  if (category === "方案类") return "amber";
  return "blue";
}

function guessFieldName(text, order) {
  if (!text) return `字段${order}`;
  if (/□|☐|○|〇|▢/.test(text)) {
    const optionTexts = text
      .split(/□|☐|○|〇|▢/)
      .map((item) => item.replace(/[（）()]/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const commonName = inferChoiceFieldName(optionTexts);
    if (commonName) return commonName;
  }
  const beforeColon = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]+)\s*[：:]/)?.[1];
  if (beforeColon) return beforeColon.slice(0, 18);
  const placeholder = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]{2,18})(?:_{2,}|-{2,}|□+)/)?.[1];
  if (placeholder) return placeholder;
  return text.replace(/[：:：_＿\-—\s]+/g, "").slice(0, 12) || `字段${order}`;
}

function guessFieldType(text) {
  if (/□|☐|○|〇|▢/.test(text) || /二选一|单选|选择/.test(text)) return "单选项";
  return "填空";
}

function inferChoiceFieldName(options) {
  const joined = options.join(" ");
  if (joined.includes("评审办法") || joined.includes("评审方法")) return "评审办法";
  if (joined.includes("报价") || joined.includes("标价")) return "报价方式";
  if (joined.includes("资格") || joined.includes("资质")) return "资格要求";
  if (joined.includes("交付") || joined.includes("服务期") || joined.includes("工期")) return "期限要求";
  const normalized = options
    .map((item) => item.replace(/^第[一二三四五六七八九十\d]+章/, "").replace(/[，,。；;：:].*$/, "").trim())
    .filter(Boolean);
  if (normalized.length === 0) return "";
  return normalized[0].slice(0, 12) || "";
}

function applyPreviewMarker({ fieldId, container, selection, anchorNode }) {
  if (!container) return;
  const selectedText = selection?.toString().trim();
  try {
    if (selection && selectedText && selection.rangeCount > 0 && container.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
        const marked = markRangeTextNodes(range, fieldId, container);
      if (!marked) {
        const marker = document.createElement("span");
        marker.className = "docx-field-marker";
        marker.dataset.fieldId = fieldId;
        range.surroundContents(marker);
      }
      selection.removeAllRanges();
      return;
    }
  } catch {
    // Some DOCX fragments split text across nodes; paragraph marking still gives visible feedback.
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const paragraph = element?.closest?.("p, table, li, div");
  if (paragraph && container.contains(paragraph)) {
    paragraph.classList.add("docx-field-marker-block");
    paragraph.dataset.fieldId = fieldId;
  }
}

function markRangeTextNodes(range, fieldId, container, extraClasses = [], restored = false) {
  const textNodes = collectTextNodesInRange(range, container);
  if (textNodes.length === 0) return false;

  textNodes.forEach((node) => {
    let start = node === range.startContainer ? range.startOffset : 0;
    let end = node === range.endContainer ? range.endOffset : node.textContent.length;
    if (start > end) [start, end] = [end, start];
    if (start === end) return;

    const nodeRange = document.createRange();
    nodeRange.setStart(node, start);
    nodeRange.setEnd(node, end);
    const marker = document.createElement("span");
    marker.className = ["docx-field-marker", ...extraClasses].filter(Boolean).join(" ");
    marker.dataset.fieldId = fieldId;
    if (restored) marker.dataset.restoredFieldId = fieldId;
    try {
      nodeRange.surroundContents(marker);
    } catch {
      const parent = node.parentElement?.closest?.("p, table, li, div");
      parent?.classList.add("docx-field-marker-block", ...extraClasses);
      if (parent) {
        parent.dataset.fieldId = fieldId;
        if (restored) parent.dataset.restoredFieldId = fieldId;
      }
    }
  });

  return true;
}

function collectTextNodesInRange(range, container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function createAnnotationMarkerData({ container, selection, anchorNode, text, page }) {
  if (!container) return null;
  const pageElement = getPreviewPageElement(container, page) || getClosestPreviewSection(anchorNode);
  if (!pageElement) return null;
  const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";

  if (selection && selectedText && selection.rangeCount > 0 && pageElement.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    return {
      kind: "range",
      page,
      text: selectedText.slice(0, 500),
      startPath: getNodePath(pageElement, range.startContainer),
      startOffset: range.startOffset,
      endPath: getNodePath(pageElement, range.endContainer),
      endOffset: range.endOffset,
    };
  }

  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  const target = element?.closest?.("p, table, li, td, div");
  if (target && pageElement.contains(target)) {
    return {
      kind: "block",
      page,
      text: String(text || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
      elementPath: getNodePath(pageElement, target),
    };
  }

  return null;
}

function getClosestPreviewSection(anchorNode) {
  const element = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
  return element?.closest?.(".docx-wrapper > section") ?? null;
}

function getNodePath(root, node) {
  if (!root || !node || !root.contains(node)) return [];
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return [];
    path.unshift([...parent.childNodes].indexOf(current));
    current = parent;
  }
  return path;
}

function resolveNodePath(root, path = []) {
  if (!root || !Array.isArray(path)) return null;
  return path.reduce((node, index) => node?.childNodes?.[index] ?? null, root);
}

function removePreviewMarker(fieldId) {
  document.querySelectorAll(`[data-field-id="${fieldId}"]`).forEach((node) => {
    node.classList.remove("docx-field-marker-block");
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
    } else {
      delete node.dataset.fieldId;
    }
  });
}

function clearPreviewMarkers() {
  [...document.querySelectorAll("[data-field-id]")].forEach((node) => {
    const fieldId = node.dataset.fieldId;
    if (fieldId) removePreviewMarker(fieldId);
  });
}

function restoreAnnotationPreviewMarkers(container, fields, selectedFieldId, activePage) {
  clearRestoredAnnotationMarkers(container);
  if (!selectedFieldId) return;
  const page = getPreviewPageElement(container, activePage);
  if (!page) return;

  const field = fields.find((item) => item.id === selectedFieldId && (item.page || 1) === activePage);
  if (!field) return;

  if (restoreAnnotationMarkerByData(page, field)) return;

  const target = findAnnotationFieldTarget(page, field);
  if (!target) return;
  target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
  target.dataset.fieldId = field.id;
  target.dataset.restoredFieldId = field.id;
}

function clearRestoredAnnotationMarkers(container) {
  container?.querySelectorAll("[data-restored-field-id]").forEach((node) => {
    if (node.classList.contains("docx-field-marker")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      parent?.normalize?.();
      return;
    }
    node.classList.remove("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    delete node.dataset.fieldId;
    delete node.dataset.restoredFieldId;
  });
}

function restoreAnnotationMarkerByData(page, field) {
  const marker = field.marker;
  if (!marker) return false;

  if (marker.kind === "range" && marker.startPath && marker.endPath) {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    if (!startNode || !endNode) return false;
    try {
      const range = document.createRange();
      range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
      range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
      return markRangeTextNodes(range, field.id, page, ["docx-field-marker-restored", "docx-field-marker-active"], true);
    } catch {
      return false;
    }
  }

  if (marker.kind === "block" && marker.elementPath) {
    const target = resolveNodePath(page, marker.elementPath);
    if (!target?.classList) return false;
    target.classList.add("docx-field-marker-block", "docx-field-marker-restored", "docx-field-marker-active");
    target.dataset.fieldId = field.id;
    target.dataset.restoredFieldId = field.id;
    return true;
  }

  return false;
}

function findAnnotationFieldTarget(page, field) {
  const candidates = [...page.querySelectorAll("span, p, td, li, table")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!text || text.length > 360) return null;
      const score = scoreAnnotationTarget(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length || getAnnotationNodeRank(a.node) - getAnnotationNodeRank(b.node));
  return candidates[0]?.node || null;
}

function scoreAnnotationTarget(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const tokens = createAnnotationTargetTokens(field, false);
  let score = 0;
  tokens.forEach((token, index) => {
    if (normalizedText.includes(token)) {
      score += Math.max(6, 28 - index * 3);
    }
  });

  if (score === 0) {
    createAnnotationTargetTokens(field, true).forEach((token) => {
      if (normalizedText.includes(token)) score += 4;
    });
  }
  return score;
}

function createAnnotationTargetTokens(field, includeFallbackName = false) {
  const rawTokens = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, "")];
  if (includeFallbackName) rawTokens.push(field.name);

  return [...new Set(rawTokens.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function splitAnnotationContextTokens(value) {
  return String(value || "")
    .split(/[□☐○〇▢_＿—\-]+/)
    .map((item) => item.replace(/[{}]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeAnnotationText(value) {
  return String(value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/[{}（）()：:，,。；;、\s]/g, "")
    .trim();
}

function getAnnotationNodeRank(node) {
  const tag = node?.tagName?.toLowerCase();
  if (tag === "span") return 0;
  if (tag === "p") return 1;
  if (tag === "td" || tag === "li") return 2;
  if (tag === "table") return 3;
  return 4;
}

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

function syncRenderedTocEntries(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return;
  const tocNodes = [...container.querySelectorAll(".docx-wrapper p")].filter(isRenderedTocNode);
  tocNodes.forEach((node) => {
    const level = getRenderedTocLevel(node);
    const match = findRenderedTocOutlineMatch(node.textContent, level, docxOutlineItems);
    if (!match) return;
    if (normalizeOutlineTitle(node.textContent) === normalizeOutlineTitle(match.title)) return;
    node.textContent = match.title;
  });
}

function getRenderedTocLevel(node) {
  const className = [...(node?.classList || [])].find((name) => /^docx_toc\d*$/i.test(name));
  const match = className?.match(/toc(\d*)$/i);
  const level = Number(match?.[1]);
  return Number.isInteger(level) && level > 0 ? level - 1 : null;
}

function findRenderedTocOutlineMatch(text, level, outlineItems) {
  const normalizedText = normalizeOutlineTitle(text);
  const candidates = outlineItems.filter((item) => level === null || item.level === level);
  const direct = candidates.find((item) => {
    const title = normalizeOutlineTitle(item.title);
    return title === normalizedText || title.endsWith(normalizedText) || normalizedText.endsWith(title);
  });
  if (direct) return direct;

  const chapter = getChapterKey(normalizedText);
  if (!chapter) return null;
  const chapterMatches = candidates.filter((item) => getChapterKey(normalizeOutlineTitle(item.title)) === chapter);
  return chapterMatches.length === 1 ? chapterMatches[0] : null;
}

function getChapterKey(value) {
  return String(value || "").match(/第[一二三四五六七八九十百千万0-9]+章/)?.[0] || "";
}

function extractOutlineItems(container, docxOutlineItems = []) {
  if (!container || docxOutlineItems.length === 0) return [];

  const paragraphNodes = getRenderedDocumentParagraphNodes(container);
  const nodes = paragraphNodes
    .map((node) => ({
      node,
      text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      normalized: normalizeOutlineTitle(node.textContent),
    }))
    .filter((item) => item.normalized && !isRenderedTocNode(item.node));

  let searchStart = 0;
  return docxOutlineItems.map((item) => {
    const normalizedTitle = normalizeOutlineTitle(item.title);
    const directNode = getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle);
    const matchIndex = directNode
      ? -1
      : nodes.findIndex((candidate, index) => {
          if (index < searchStart) return false;
          return isOutlineTitleMatch(candidate.normalized, normalizedTitle);
        });
    const matched = directNode ? { node: directNode } : matchIndex >= 0 ? nodes[matchIndex] : null;
    if (matched) {
      if (matchIndex >= 0) searchStart = matchIndex + 1;
      matched.node.dataset.outlineId = item.id;
    }
    return {
      ...item,
      page: matched ? resolvePreviewPage(matched.node, container) : 1,
    };
  });
}

function getRenderedDocumentParagraphNodes(container) {
  return [...(container?.querySelectorAll(".docx-wrapper > section > article p") ?? [])];
}

function getOutlineNodeBySourceParagraphIndex(paragraphNodes, item, normalizedTitle) {
  const node = paragraphNodes[item.index];
  if (!node || isRenderedTocNode(node)) return null;
  const normalizedNodeText = normalizeOutlineTitle(node.textContent);
  return isOutlineTitleMatch(normalizedNodeText, normalizedTitle) ? node : null;
}

function normalizeOutlineTitle(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isRenderedTocNode(node) {
  return [...(node?.classList || [])].some((className) => /^docx_toc\d*$/i.test(className));
}

function isOutlineTitleMatch(candidate, title) {
  if (!candidate || !title) return false;
  if (candidate === title) return true;
  return title.endsWith(candidate);
}

function highlightSearchMatches(container, term) {
  clearSearchHighlights(container);
  const keyword = term.trim();
  if (!container || !keyword) return { count: 0, firstPage: null };

  const nodes = collectSearchTextNodes(container);
  let count = 0;
  let firstPage = null;
  nodes.forEach((node) => {
    const text = node.textContent || "";
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const matches = [];
    let startIndex = 0;
    while (startIndex <= lowerText.length - lowerKeyword.length) {
      const index = lowerText.indexOf(lowerKeyword, startIndex);
      if (index < 0) break;
      matches.push(index);
      startIndex = index + Math.max(1, lowerKeyword.length);
    }

    matches.reverse().forEach((index) => {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + keyword.length);
      const marker = document.createElement("mark");
      marker.className = "doc-search-hit";
      try {
        range.surroundContents(marker);
        count += 1;
        if (!firstPage) {
          firstPage = resolvePreviewPage(marker, container);
        }
      } catch {
        // Search highlighting is best effort; document rendering should stay stable.
      }
    });
  });

  setActiveSearchHit(container, 0);
  return { count, firstPage };
}

function getSearchHits(container) {
  return [...(container?.querySelectorAll(".doc-search-hit") ?? [])];
}

function setActiveSearchHit(container, index) {
  const hits = getSearchHits(container);
  hits.forEach((hit) => hit.classList.remove("active"));
  const target = hits[index] || null;
  target?.classList.add("active");
  return target;
}

function collectSearchTextNodes(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest?.(".doc-search-hit, .preview-mark-list")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function clearSearchHighlights(container) {
  if (!container) return;
  [...container.querySelectorAll(".doc-search-hit")].forEach((node) => {
    const parent = node.parentNode;
    while (node.firstChild) parent?.insertBefore(node.firstChild, node);
    parent?.removeChild(node);
    parent?.normalize?.();
  });
}

function applyFillPreviewValues(container, fields) {
  if (!container) return;
  container.querySelectorAll("[data-fill-original-html]").forEach((node) => {
    node.innerHTML = node.dataset.fillOriginalHtml || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalHtml;
  });
  container.querySelectorAll("[data-fill-original-text]").forEach((node) => {
    node.textContent = node.dataset.fillOriginalText || "";
    node.classList.remove("docx-fill-mutated", "docx-section-fill-lead");
    delete node.dataset.fillOriginalText;
  });
  container.querySelectorAll(".docx-replaced-source").forEach((node) => {
    node.classList.remove("docx-replaced-source");
    delete node.dataset.replacedByField;
  });
  container.querySelectorAll(".docx-choice-selected").forEach((node) => {
    node.classList.remove("docx-choice-selected");
    collectTextNodes(node).forEach((textNode) => {
      textNode.textContent = (textNode.textContent || "").replace(/[☑✓✔]/g, "□");
    });
  });
  container.normalize?.();

  fields.forEach((field) => {
    if (!field.name || !field.value) return;
    if (field.type === "单选项" && applySectionLeadFillValue(container, field)) return;

    if (field.type === "单选项") {
      const choiceScope = getPreviewPageElement(container, field.page || 1) || container;
      const choiceTarget = findChoiceTarget(choiceScope, field);
      if (choiceTarget) {
        markChoiceTarget(choiceTarget);
        if (!shouldContinueFillAfterChoice(field)) return;
        if (applyAmountUnitFillValue(choiceTarget.element ?? choiceTarget, field)) return;
      }
    }

    if (isDateField(field) && applyDateSegmentFillValue(container, field)) return;
    if (applyAmountUnitFillValue(container, field)) return;
    if (applyMarkerFillValue(container, field)) return;
    if (applyContextualFillValue(container, field)) return;
    if (applyTemplateContextBlankFillValue(container, field)) return;

    const target = findFillTarget(container, field.name);
    if (!target) return;
    applyLabelFillValue(target, field);
  });
}

function applyDateSegmentFillValue(container, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const scope = getPreviewPageElement(container, field.marker?.page || field.page || 1) || container;
  const markerTarget = field.marker ? findMarkerFillTarget(scope, field.marker) : null;
  if (markerTarget && replaceDateSegmentInTarget(markerTarget, field, parts)) return true;

  const candidates = getScopedCandidateNodes(scope, "p, td, li, div")
    .map((node) => {
      const text = node.textContent || "";
      if (text.length > 260 || !hasDateSegmentBlank(text)) return null;
      return { node, score: scoreDateSegmentCandidate(text, field), length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (replaceDateSegmentInTarget(candidate.node, field, parts)) return true;
  }
  return false;
}

function replaceDateSegmentInTarget(target, field, parts) {
  const text = target.textContent || "";
  const match = getDateSegmentBlankPattern().exec(text);
  if (!match) return false;

  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(text.slice(0, match.index)));
  appendDateFillPart(target, field, parts.year);
  target.append(document.createTextNode("年"));
  appendDateFillPart(target, field, parts.month);
  target.append(document.createTextNode("月"));
  appendDateFillPart(target, field, parts.day);
  target.append(document.createTextNode(`日${text.slice(match.index + match[0].length)}`));
  target.classList.add("docx-fill-mutated");
  return true;
}

function appendDateFillPart(target, field, value) {
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value date-piece";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = value;
  target.append(valueNode);
}

function hasDateSegmentBlank(text) {
  return getDateSegmentBlankPattern().test(text || "");
}

function getDateSegmentBlankPattern() {
  return /[_＿—\-\s]{1,12}年[_＿—\-\s]{1,8}月[_＿—\-\s]{1,8}日/;
}

function scoreDateSegmentCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const context = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 5;
  if (normalizedText.includes("日期") || normalizedText.includes("年月日")) score += 8;
  if (context.includes("日期") || context.includes("年月日")) score += 6;
  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 5;
  });
  return score;
}

function applyAmountUnitFillValue(container, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return false;

  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = getScopedCandidateNodes(scope, "td, p, li, div")
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length > 1200 || !/(金额|限价|报价|费用)[^。；;]{0,80}[：:]\s*(元|万元)/.test(text)) return null;
      const score = scoreAmountUnitCandidate(text, field);
      return { node, score, length: text.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function getScopedCandidateNodes(scope, selector) {
  if (!scope) return [];
  const nodes = [...scope.querySelectorAll(selector)];
  if (scope.matches?.(selector)) nodes.unshift(scope);
  return nodes;
}

function scoreAmountUnitCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const normalizedContext = normalizeAnnotationText(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`);
  let score = 0;

  ["询比保证金", "投标保证金", "最高限价", "采购控制价", "安全文明施工费", "规费", "专业工程暂估价", "暂列金额"].forEach((label) => {
    const normalizedLabel = normalizeAnnotationText(label);
    if (normalizedContext.includes(normalizedLabel) && normalizedText.includes(normalizedLabel)) score += 50;
  });

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  if (/金额[^。；;]{0,20}[：:]\s*(元|万元)/.test(text)) score += 8;
  return score;
}

function applyMarkerFillValue(container, field) {
  const marker = field.marker;
  if (!container || !marker) return false;
  const page = getPreviewPageElement(container, marker.page || field.page || 1) || container;
  const target = findMarkerFillTarget(page, marker);
  if (!target) return false;

  if (field.type === "单选项") {
    const choiceTarget = findChoiceTarget(target, field);
    if (choiceTarget) {
      markChoiceTarget(choiceTarget);
      if (!shouldContinueFillAfterChoice(field)) return true;
    }
  }

  if (applyFirstBlankFillValue(target, field)) return true;
  if (marker.kind === "range") return applyMarkerRangeFillValue(page, marker, field);
  return false;
}

function shouldContinueFillAfterChoice(field) {
  const context = `${field.answerFormat || ""} ${field.question || ""}`;
  const value = getFieldAmountValue(field);
  return hasFillBlank(context) || /金额|限价|费用|报价|%|％|元|万元/.test(context) || /[0-9]/.test(value);
}

function findMarkerFillTarget(page, marker) {
  if (marker.kind === "range") {
    const startNode = resolveNodePath(page, marker.startPath);
    const endNode = resolveNodePath(page, marker.endPath);
    const startTarget = startNode?.parentElement?.closest?.("p, td, li, div");
    const endTarget = endNode?.parentElement?.closest?.("p, td, li, div");
    if (startTarget && startTarget === endTarget) return startTarget;
    return startTarget?.closest?.("td") || startTarget || endTarget;
  }

  if (marker.kind === "block") {
    const target = resolveNodePath(page, marker.elementPath);
    return target?.closest?.("p, td, li, div") || target;
  }

  return null;
}

function applyTemplateContextBlankFillValue(container, field) {
  const scope = getPreviewPageElement(container, field.page || 1) || container;
  const candidates = [...scope.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!hasFillBlank(text) || text.length > 1800) return null;
      if (!isBlankCandidateCompatible(text, field)) return null;
      const score = scoreBlankFillCandidate(text, field);
      return score > 0 ? { node, score, length: text.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.length - b.length);

  for (const candidate of candidates) {
    if (applyFirstBlankFillValue(candidate.node, field)) return true;
  }
  return false;
}

function isBlankCandidateCompatible(text, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (expectsAmountBlank(context, getFieldAmountValue(field))) {
    return /(?:金额|限价|报价|费用)[^。；;]{0,30}[：:]\s*(?:元|万元)/.test(text);
  }
  return true;
}

function scoreBlankFillCandidate(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  const contexts = [field.answerFormat, field.question?.replace(/^模板上下文[：:]/, ""), field.name].filter(Boolean);
  let score = 0;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 12;
  });

  const contextTokens = [...new Set(contexts.flatMap(splitAnnotationContextTokens))]
    .map(normalizeAnnotationText)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  contextTokens.forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(10, token.length);
  });

  if (score > 0 && hasFillBlank(text)) score += 5;
  return score;
}

function applyFirstBlankFillValue(target, field) {
  const text = target.textContent || "";
  const matches = collectBlankMatches(target).filter((item) => isUsefulFillBlank(text, item.match));
  if (matches.length === 0) return false;

  const bestMatch = chooseBestBlankMatch(text, matches, field);
  if (!bestMatch) return false;
  return replaceBlankMatchWithValue(target, bestMatch, field);
}

function hasFillBlank(text) {
  return /[_＿—-]{2,}|\s{2,}|(?<=[：:])\s+(?=元|万元|%|％|日历天|分钟|天)|(?<=的)\s+(?=%|％)/.test(text || "");
}

function applyMarkerRangeFillValue(page, marker, field) {
  const startNode = resolveNodePath(page, marker.startPath);
  const endNode = resolveNodePath(page, marker.endPath);
  if (!startNode || !endNode) return false;
  const target = startNode.parentElement?.closest?.("p, td, li, div");
  if (!target) return false;

  try {
    storeOriginalText(target);
    const range = document.createRange();
    range.setStart(startNode, clampNumber(marker.startOffset ?? 0, 0, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, clampNumber(marker.endOffset ?? 0, 0, endNode.textContent?.length ?? 0));
    range.deleteContents();
    const valueNode = document.createElement("span");
    valueNode.className = "docx-fill-value";
    valueNode.dataset.fieldId = field.id;
    valueNode.textContent = field.value;
    range.insertNode(valueNode);
    target.classList.add("docx-fill-mutated");
    return true;
  } catch {
    return false;
  }
}

function isUsefulFillBlank(text, match) {
  const index = match.index ?? 0;
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + match[0].length, index + match[0].length + 18);
  return /[：:（(，,、\u4e00-\u9fa5A-Za-z0-9□☐○〇▢]/.test(before) && /[\u4e00-\u9fa5A-Za-z0-9□☐○〇▢）),，,。；;]/.test(after);
}

function chooseBestBlankMatch(text, matches, field) {
  const compatibleMatches = filterCompatibleBlankMatches(text, matches, field);
  if (compatibleMatches.length === 0) return null;
  if (expectsAmountBlank(`${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`, getFieldAmountValue(field))) {
    return compatibleMatches[0];
  }
  const tokens = getFieldNameTokens(field.name);
  if (tokens.length === 0) return compatibleMatches[0];

  const ranked = compatibleMatches
    .map((item) => {
      const index = item.match.index ?? 0;
      const tokenDistances = tokens.map((token) => {
        const tokenIndex = text.lastIndexOf(token, index);
        return tokenIndex >= 0 ? index - tokenIndex : Number.POSITIVE_INFINITY;
      });
      const distance = Math.min(...tokenDistances);
      const labelScore = scoreBlankLocalLabel(text, index, field);
      return { item, distance, labelScore };
    })
    .sort((a, b) => b.labelScore - a.labelScore || a.distance - b.distance);

  const best = ranked[0];
  if (!best || (best.labelScore === 0 && !Number.isFinite(best.distance))) return null;
  return best.item;
}

function filterCompatibleBlankMatches(text, matches, field) {
  const context = `${field.name || ""} ${field.answerFormat || ""} ${field.question || ""}`;
  if (!expectsAmountBlank(context, getFieldAmountValue(field))) return matches;

  return matches.filter((item) => {
    const index = item.match.index ?? 0;
    const before = text.slice(Math.max(0, index - 42), index);
    const after = text.slice(index + item.match[0].length, index + item.match[0].length + 12);
    return /金额|限价|报价|费用/.test(before) && /元|万元/.test(after);
  });
}

function expectsAmountBlank(context, value) {
  return /金额|报价|费用|元|万元/.test(`${context || ""} ${value || ""}`) && /[0-9]/.test(String(value || ""));
}

function collectBlankMatches(target) {
  const items = [];
  let baseIndex = 0;
  collectTextNodes(target).forEach((node) => {
    const text = node.textContent || "";
    [...text.matchAll(/[_＿—-]{2,}|\s{2,}|(?<=[：:])\s+(?=元|万元|%|％|日历天|分钟|天)|(?<=的)\s+(?=%|％)/g)].forEach((match) => {
      items.push({
        node,
        localIndex: match.index ?? 0,
        match: {
          ...match,
          index: baseIndex + (match.index ?? 0),
          0: match[0],
        },
      });
    });
    baseIndex += text.length;
  });
  return items;
}

function replaceBlankMatchWithValue(target, item, field) {
  const { node, localIndex, match } = item;
  const text = node.textContent || "";
  if (!text || localIndex < 0) return false;
  storeOriginalHtml(target);
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = getBlankPreviewValue(field, target.textContent || "", match.index ?? 0);

  const afterNode = node.splitText(localIndex);
  afterNode.textContent = afterNode.textContent.slice(match[0].length);
  afterNode.parentNode?.insertBefore(valueNode, afterNode);
  target.classList.add("docx-fill-mutated");
  return true;
}

function getBlankPreviewValue(field, fullText, blankIndex) {
  const value = getFieldAmountValue(field);
  const before = fullText.slice(Math.max(0, blankIndex - 42), blankIndex);
  const label = before.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]+)\s*[：:]?\s*$/)?.[1] || "";
  if (!label || !value) return value;

  const normalizedLabel = normalizeAnnotationText(label);
  if (normalizedLabel.includes("金额") || normalizedLabel.includes("报价") || normalizedLabel.includes("费用") || normalizedLabel.includes("限价")) {
    const labelledAmount = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]?\\s*([^，,；;。\\s元]+)`));
    if (labelledAmount?.[1]) return labelledAmount[1].trim();
    const amount = value.match(/(?:人民币)?\s*([0-9][0-9,，.]*)\s*(?:万?元)?/);
    if (amount?.[1]) return amount[1].replace(/，/g, ",");
  }

  const labelledValue = value.match(new RegExp(`${escapeRegExp(label)}\\s*[：:]\\s*([^，,；;。]+)`));
  if (labelledValue?.[1]) return labelledValue[1].trim();
  return value;
}

function scoreBlankLocalLabel(text, index, field) {
  const before = text.slice(Math.max(0, index - 36), index);
  const normalizedBefore = normalizeAnnotationText(before);
  return getFieldNameTokens(field.name).reduce((score, token) => {
    return normalizedBefore.includes(normalizeAnnotationText(token)) ? score + token.length : score;
  }, 0);
}

function getFieldNameTokens(name = "") {
  return String(name)
    .split(/[\s/／|｜,，、:：()（）]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(-4);
}

function applyLabelFillValue(target, field) {
  const text = target.textContent || "";
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const match = pattern.exec(text);
  if (!match) return false;

  replaceTargetTextWithValue({
    target,
    field,
    beforeValue: text.slice(0, match.index) + match[1],
    afterValue: text.slice(match.index + match[0].length),
  });
  return true;
}

function applyContextualFillValue(container, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const target = findContextualFillTarget(container, descriptor);
    if (!target) continue;
    const match = descriptor.pattern.exec(target.textContent || "");
    if (!match) continue;
    replaceTargetTextWithValue({
      target,
      field,
      beforeValue: target.textContent.slice(0, match.index) + match[1],
      afterValue: target.textContent.slice(match.index + match[0].length),
    });
    return true;
  }
  return false;
}

function applySectionLeadFillValue(container, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadDomTarget(container, sectionLabel, field);
  if (!target) return false;

  storeOriginalText(target);
  replaceTargetTextWithValue({
    target,
    field: { ...field, value: getSectionAnswerValue(field, sectionLabel) },
    beforeValue: `${sectionLabel}：`,
    afterValue: "",
    lead: true,
  });

  getSectionReplacementSourceNodes(target, sectionLabel).forEach((node) => {
    node.classList.add("docx-replaced-source");
    node.dataset.replacedByField = field.id;
  });
  return true;
}

function getSectionReplacementSourceNodes(target, sectionLabel) {
  const nodes = [];
  let current = target.nextElementSibling;
  while (current) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text) {
      current = current.nextElementSibling;
      continue;
    }
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      nodes.push(current);
    }
    current = current.nextElementSibling;
  }
  return nodes;
}

function findSectionLeadDomTarget(container, sectionLabel, field) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => isSectionLeadParagraph(node.textContent || "", sectionLabel))
    .map((node) => ({
      node,
      score: scoreSectionLeadCandidate(
        [node.textContent || "", ...getSectionFollowingDomTexts(node, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || (a.node.textContent?.length || 0) - (b.node.textContent?.length || 0))[0]?.node || null;
}

function getSectionFollowingDomTexts(target, sectionLabel) {
  const texts = [];
  let current = target.nextElementSibling;
  while (current && texts.length < 4) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
    current = current.nextElementSibling;
  }
  return texts;
}

function isNextSectionLead(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  if (!/^\d+[.、]/.test(text.trim())) return false;
  return !normalizedText.startsWith(normalizedLabel);
}

function isSectionNoRequirementOption(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return /^无.{0,12}要求/.test(normalizedText) && normalizedLabel.includes("要求");
}

function isSectionTemplateOptionParagraph(text, sectionLabel) {
  const trimmedText = String(text || "").trim();
  return /^[□☐○〇▢]/.test(trimmedText) || isSectionNoRequirementOption(trimmedText, sectionLabel);
}

function isSectionReplacementChoiceField(field) {
  return field.type === "单选项" && normalizeFillMode(field.fillMode, field) === "choice-replace" && Boolean(resolveSectionLeadLabel(field)) && shouldReplaceSectionWithAnswer(field);
}

function getSectionAnswerValue(field, sectionLabel) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  const label = normalizeChoiceText(sectionLabel).replace(/^\d+/, "");
  return value.replace(new RegExp(`^\\s*(?:\\d+[.、]\\s*)?${escapeRegExp(label)}\\s*[：:]?\\s*`), "").trim() || value;
}

function shouldReplaceSectionWithAnswer(field) {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  if (/^无.{0,12}要求/.test(normalizeChoiceText(value))) return false;
  if (normalizeFillMode(field.fillMode, field) === "choice-replace") return true;
  if (value.length < 60) return false;
  return /[。；;，,]/.test(value) || value.length >= 90;
}

function scoreSectionLeadCandidate(candidateText, field, sectionLabel) {
  const candidate = normalizeChoiceText(candidateText);
  const format = normalizeChoiceText(field.answerFormat || "");
  const name = normalizeChoiceText(field.name || "");
  let score = 0;

  if (candidate.includes(normalizeChoiceText(sectionLabel))) score += 10;
  if (name && candidate.includes(name)) score += 6;
  if (!format) return score;

  const tokens = createSectionMatchTokens(format);
  tokens.forEach((token) => {
    if (candidate.includes(token)) score += Math.min(12, token.length);
  });
  return score;
}

function createSectionMatchTokens(text) {
  return [...new Set(String(text || "").split(/[□☐○〇▢_＿—\-]+/))]
    .map((item) => normalizeChoiceText(item))
    .filter((item) => item.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function getContextualFillDescriptors(field) {
  const contexts = [field.answerFormat, field.question, field.name]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return contexts
    .map((context) => {
      const quoteMatch = context.match(/^(.*?[“"])\s*([”"].*)$/);
      if (quoteMatch) return createContextualFillDescriptor(quoteMatch[1], quoteMatch[2]);

      const blankMatch = context.match(/^(.*?)(_{2,}|＿+|—+|-{2,}|\s{2,})(.*)$/);
      if (blankMatch) return createContextualFillDescriptor(blankMatch[1], blankMatch[3]);

      const punctBlankMatch = context.match(/^(.*?[：:][^。；;，,）)]*?)\s+([。；;，,）)].*)$/);
      if (punctBlankMatch) return createContextualFillDescriptor(punctBlankMatch[1], punctBlankMatch[2]);

      return null;
    })
    .filter(Boolean);
}

function createContextualFillDescriptor(prefix, suffix) {
  const cleanPrefix = prefix.trimEnd();
  const cleanSuffix = suffix.trimStart();
  if (!cleanPrefix || !cleanSuffix) return null;
  return {
    pattern: new RegExp(`(${escapeFlexibleContext(cleanPrefix)})([_＿—\\-\\s]*)(?=${escapeFlexibleContext(cleanSuffix)})`),
  };
}

function findContextualFillTarget(container, descriptor) {
  return [...container.querySelectorAll("p, td, li, div")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.length <= 240 && descriptor.pattern.test(node.textContent || "");
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))[0] || null;
}

function replaceTargetTextWithValue({ target, field, beforeValue, afterValue }) {
  storeOriginalText(target);
  target.innerHTML = "";
  target.append(document.createTextNode(beforeValue));
  const valueNode = document.createElement("span");
  valueNode.className = "docx-fill-value";
  valueNode.dataset.fieldId = field.id;
  valueNode.textContent = field.value;
  target.append(valueNode);
  target.append(document.createTextNode(afterValue));
  target.classList.add("docx-fill-mutated");
  if (arguments[0]?.lead) {
    target.classList.add("docx-section-fill-lead");
  }
}

function storeOriginalText(target) {
  if (!target.dataset.fillOriginalText) {
    target.dataset.fillOriginalText = target.textContent || "";
  }
}

function storeOriginalHtml(target) {
  if (!target.dataset.fillOriginalHtml && !target.dataset.fillOriginalText) {
    target.dataset.fillOriginalHtml = target.innerHTML || "";
  }
}

async function buildFilledDocxBuffer(templateFile, fields) {
  const filledFields = fields.filter((field) => field.value);
  fillBookmarkId = 50000;
  fillBookmarkNames = new Set();
  const zip = await JSZip.loadAsync(templateFile.buffer.slice(0));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX 缺少 word/document.xml");

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const xmlText = await documentFile.async("text");
  const doc = parser.parseFromString(xmlText, "application/xml");
  const paragraphs = [...doc.getElementsByTagName("w:p")];

  filledFields.forEach((field) => {
    if (applySectionLeadFillToDocxXml(paragraphs, field)) return;
    if (field.type === "单选项") {
      const choiceApplied = applyChoiceToDocxXml(paragraphs, field);
      if (choiceApplied && !shouldContinueFillAfterChoice(field)) return;
    }
    if (isDateField(field) && applyDateSegmentFillToDocxXml(paragraphs, field)) return;
    if (applyContextualFillToDocxXml(paragraphs, field)) return;
    applyLabelFillToDocxXml(paragraphs, field);
  });

  zip.file("word/document.xml", serializer.serializeToString(doc));
  await enableDocxTrackRevisions(zip, parser, serializer);
  return zip.generateAsync({
    type: "arraybuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function exportFilledDocx(templateFile, fields) {
  downloadDocxBuffer(await buildFilledDocxBuffer(templateFile, fields), buildExportFileName(templateFile.name));
}

async function enableDocxTrackRevisions(zip, parser, serializer) {
  const settingsFile = zip.file("word/settings.xml");
  if (!settingsFile) return;
  const settingsDoc = parser.parseFromString(await settingsFile.async("text"), "application/xml");
  const root = settingsDoc.documentElement;
  if (!root || root.getElementsByTagName("w:trackRevisions").length > 0) return;
  root.appendChild(settingsDoc.createElementNS(WORD_NS, "w:trackRevisions"));
  zip.file("word/settings.xml", serializer.serializeToString(settingsDoc));
}

function setXmlParagraphWithFill(paragraph, beforeValue, fillValue, afterValue, field, options = {}) {
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlRun(paragraph, beforeValue);
  appendXmlInsertedRun(paragraph, fillValue, field, options);
  appendXmlRun(paragraph, afterValue);
}

function appendXmlRun(parent, text, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const run = doc.createElementNS(WORD_NS, "w:r");
  const rPr = createXmlRunProperties(doc, options);
  if (rPr) run.appendChild(rPr);
  const textNode = doc.createElementNS(WORD_NS, "w:t");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  parent.appendChild(run);
}

function appendXmlInsertedRun(parent, text, field, options = {}) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const bookmarkName = getFillBookmarkName(field);
  const shouldBookmark = bookmarkName && !fillBookmarkNames.has(bookmarkName);
  const bookmarkId = shouldBookmark ? fillBookmarkId++ : 0;
  if (shouldBookmark) {
    fillBookmarkNames.add(bookmarkName);
    const start = doc.createElementNS(WORD_NS, "w:bookmarkStart");
    start.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    start.setAttributeNS(WORD_NS, "w:name", bookmarkName);
    parent.appendChild(start);
  }
  const inserted = doc.createElementNS(WORD_NS, "w:ins");
  inserted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  inserted.setAttributeNS(WORD_NS, "w:author", getFillRevisionAuthor(field));
  inserted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  appendXmlRun(inserted, text, options);
  parent.appendChild(inserted);
  if (shouldBookmark) {
    const end = doc.createElementNS(WORD_NS, "w:bookmarkEnd");
    end.setAttributeNS(WORD_NS, "w:id", String(bookmarkId));
    parent.appendChild(end);
  }
}

function getFillBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_FIELD_${id}` : "";
}

function getInputPointBookmarkName(field) {
  const id = String(field?.id || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 30);
  return id ? `GF_INPUT_${id}` : "";
}

function getFillTargetBookmarkName(field) {
  return !isReplacementField(field) && field?.inputPoint?.bookmarkName ? field.inputPoint.bookmarkName : getFillBookmarkName(field);
}

function setXmlParagraphDeleted(paragraph) {
  const text = getXmlParagraphText(paragraph);
  if (!text.trim()) return;
  const pPr = [...paragraph.childNodes].find((node) => node.namespaceURI === WORD_NS && node.localName === "pPr");
  [...paragraph.childNodes].forEach((node) => {
    if (node !== pPr) paragraph.removeChild(node);
  });
  appendXmlDeletedRun(paragraph, text);
}

function appendXmlDeletedRun(parent, text) {
  if (!text) return;
  const doc = parent.ownerDocument;
  const deleted = doc.createElementNS(WORD_NS, "w:del");
  deleted.setAttributeNS(WORD_NS, "w:id", String(aiRevisionId++));
  deleted.setAttributeNS(WORD_NS, "w:author", "AI填充");
  deleted.setAttributeNS(WORD_NS, "w:date", new Date().toISOString());
  const run = doc.createElementNS(WORD_NS, "w:r");
  const textNode = doc.createElementNS(WORD_NS, "w:delText");
  if (/^\s|\s$/.test(text)) textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  textNode.textContent = text;
  run.appendChild(textNode);
  deleted.appendChild(run);
  parent.appendChild(deleted);
}

function createXmlRunProperties(doc, options = {}) {
  if (!options.underline) return null;
  const rPr = doc.createElementNS(WORD_NS, "w:rPr");
  const underline = doc.createElementNS(WORD_NS, "w:u");
  underline.setAttributeNS(WORD_NS, "w:val", "single");
  rPr.appendChild(underline);
  return rPr;
}

function getFillRevisionAuthor(field) {
  return String(field?.source || "").includes("人工") ? "人工填写" : "AI填充";
}

function shouldUnderlineFilledValue(blankText) {
  return /[_＿—\-\s]{2,}/.test(blankText || "");
}

function applyDateSegmentFillToDocxXml(paragraphs, field) {
  const parts = parseDateParts(field.value);
  if (!parts) return false;

  const candidates = paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => text.length <= 260 && hasDateSegmentBlank(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreDateSegmentCandidate(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  const target = candidates[0];
  if (!target) return false;

  const match = getDateSegmentBlankPattern().exec(target.text);
  if (!match) return false;

  setXmlParagraphWithFill(
    target.item,
    target.text.slice(0, match.index),
    `${parts.year}年${parts.month}月${parts.day}日`,
    target.text.slice(match.index + match[0].length),
    field,
    { underline: shouldUnderlineFilledValue(match[0]) },
  );
  return true;
}

function applyChoiceToDocxXml(paragraphs, field) {
  const keywords = getChoiceKeywords(getFieldChoiceValue(field), `${field.name || ""} ${field.question || ""} ${field.answerFormat || ""}`);
  if (keywords.length === 0) return false;

  const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => {
    return /[□☐○〇▢☑✓✔]/.test(text) && Boolean(findMatchedChoiceKeyword(text, keywords));
  });
  if (!paragraph) return false;

  const textNodes = getXmlTextNodes(paragraph);
  textNodes.forEach((node) => {
    node.textContent = (node.textContent || "").replace(/[☑✓✔]/g, "□");
  });

  const keyword = findMatchedChoiceKeyword(getXmlParagraphText(paragraph), keywords);
  const keywordPosition = findXmlKeywordPosition(textNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestXmlChoiceMarkerBefore(textNodes, keywordPosition)
    : findFirstXmlChoiceMarker(textNodes);

  if (!markerPosition) return false;
  const markerIndex = getXmlTextNodeOffset(textNodes, markerPosition.node, markerPosition.index);
  const paragraphText = getXmlParagraphText(paragraph);
  if (markerIndex < 0) return false;
  setXmlParagraphWithFill(paragraph, paragraphText.slice(0, markerIndex), "☑", paragraphText.slice(markerIndex + 1), field);
  return true;
}

function getXmlTextNodeOffset(nodes, targetNode, localIndex) {
  let offset = 0;
  for (const node of nodes) {
    if (node === targetNode) return offset + localIndex;
    offset += (node.textContent || "").length;
  }
  return -1;
}

function applyContextualFillToDocxXml(paragraphs, field) {
  const descriptors = getContextualFillDescriptors(field);
  for (const descriptor of descriptors) {
    const paragraph = findBestXmlParagraphForField(paragraphs, field, (text) => descriptor.pattern.test(text));
    if (!paragraph) continue;
    const text = getXmlParagraphText(paragraph);
    const match = descriptor.pattern.exec(text);
    if (!match) continue;
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }
  return false;
}

function applySectionLeadFillToDocxXml(paragraphs, field) {
  if (!isSectionReplacementChoiceField(field)) return false;
  const sectionLabel = resolveSectionLeadLabel(field);

  const target = findSectionLeadXmlTarget(paragraphs, sectionLabel, field);
  const paragraph = target?.item;
  if (!paragraph) return false;

  setXmlParagraphWithFill(paragraph, `${sectionLabel}：`, getSectionAnswerValue(field, sectionLabel), "", field);
  removeSectionTemplateOptionParagraphs(paragraphs, target.index, sectionLabel);
  return true;
}

function findSectionLeadXmlTarget(paragraphs, sectionLabel, field) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => isSectionLeadParagraph(text, sectionLabel))
    .map((target) => ({
      ...target,
      score: scoreSectionLeadCandidate(
        [target.text, ...getSectionFollowingXmlTexts(paragraphs, target.index, sectionLabel)].join(" "),
        field,
        sectionLabel,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0];
}

function getSectionFollowingXmlTexts(paragraphs, startIndex, sectionLabel) {
  const texts = [];
  for (let index = startIndex + 1; index < paragraphs.length && texts.length < 4; index += 1) {
    const text = getXmlParagraphText(paragraphs[index]).replace(/\s+/g, " ").trim();
    if (text && isNextSectionLead(text, sectionLabel)) break;
    if (text) texts.push(text);
  }
  return texts;
}

function removeSectionTemplateOptionParagraphs(paragraphs, startIndex, sectionLabel) {
  for (let index = startIndex + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const text = getXmlParagraphText(paragraph);
    if (isNextSectionLead(text, sectionLabel)) break;
    if (isSectionTemplateOptionParagraph(text, sectionLabel)) {
      setXmlParagraphDeleted(paragraph);
    }
  }
}

function resolveSectionLeadLabel(field) {
  const source = getTemplateFieldSourceText(field) || field.name || "";
  const match = source.match(/^\s*(\d+[.、]\s*)?[□☐○〇▢☑✓✔]?\s*([^：:；;。]{2,24}要求)\s*[：:]/);
  if (match) return `${(match[1] || "").replace(/\s+/g, "")}${match[2].replace(/\s+/g, "")}`;
  return "";
}

function isSectionLeadParagraph(text, sectionLabel) {
  const normalizedText = normalizeChoiceText(text);
  const normalizedLabel = normalizeChoiceText(sectionLabel);
  return normalizedText.startsWith(normalizedLabel) && (normalizedText.length <= normalizedLabel.length + 8 || normalizedLabel.includes("要求"));
}

function applyLabelFillToDocxXml(paragraphs, field) {
  const pattern = new RegExp(`(${escapeRegExp(field.name)}\\s*[：:])([_＿—\\-\\s]*)(?=[。；;，,）)]|$)`);
  const paragraph = findBestXmlParagraphForField(
    paragraphs,
    field,
    (text) => text.includes(field.name) && /[：:]/.test(text),
  );
  if (!paragraph) return false;
  const text = getXmlParagraphText(paragraph);
  const match = pattern.exec(text);
  if (match) {
    setXmlParagraphWithFill(
      paragraph,
      text.slice(0, match.index) + match[1],
      field.value,
      text.slice(match.index + match[0].length),
      field,
      { underline: shouldUnderlineFilledValue(match[2]) },
    );
    return true;
  }

  return applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field);
}

function applyFirstBlankAfterFieldLabelToDocxXml(paragraph, text, field) {
  const labelIndex = findFieldLabelIndex(text, field.name);
  if (labelIndex < 0) return false;

  const colonIndex = findColonAfterIndex(text, labelIndex);
  const searchStart = colonIndex >= 0 ? colonIndex + 1 : labelIndex + field.name.length;
  const tail = text.slice(searchStart);
  const blankMatch = /[_＿—\-\s]{2,}/.exec(tail);
  if (!blankMatch) return false;

  const blankStart = searchStart + blankMatch.index;
  setXmlParagraphWithFill(
    paragraph,
    text.slice(0, blankStart),
    field.value,
    text.slice(blankStart + blankMatch[0].length),
    field,
    { underline: shouldUnderlineFilledValue(blankMatch[0]) },
  );
  return true;
}

function findBestXmlParagraphForField(paragraphs, field, predicate) {
  return paragraphs
    .map((item, index) => ({ item, index, text: getXmlParagraphText(item) }))
    .filter(({ text }) => predicate(text))
    .map((candidate) => ({
      ...candidate,
      score: scoreXmlParagraphForField(candidate.text, field),
    }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.index - b.index)[0]?.item || null;
}

function scoreXmlParagraphForField(text, field) {
  const normalizedText = normalizeAnnotationText(text);
  let score = 0;
  if (field.name && text.includes(field.name)) score += 12;

  getFieldNameTokens(field.name).forEach((token) => {
    if (normalizedText.includes(normalizeAnnotationText(token))) score += 6;
  });

  getFieldContextTokens(field).forEach((token) => {
    if (normalizedText.includes(token)) score += Math.min(24, token.length * 2);
  });

  getFieldContextTexts(field).forEach((context) => {
    const normalizedContext = normalizeAnnotationText(context);
    if (!normalizedContext) return;
    if (normalizedText.includes(normalizedContext)) score += 120;
    else if (normalizedContext.includes(normalizedText) && normalizedText.length >= 8) score += 60;
  });

  return score;
}

function getFieldContextTexts(field) {
  return [
    field.marker?.text,
    field.answerFormat,
    field.question?.replace(/^模板上下文[：:]/, ""),
  ]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2);
}

function getFieldContextTokens(field) {
  return [...new Set(getFieldContextTexts(field).flatMap((text) => {
    return text
      .split(/[□☐○〇▢_＿—\-\s,，。；;:：（）()、/／]+/)
      .map((item) => normalizeAnnotationText(item))
      .filter((item) => item.length >= 2);
  }))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function findFieldLabelIndex(text, fieldName) {
  const names = [
    fieldName,
    String(fieldName || "").replace(/^\s*\d+[.、]\s*/, ""),
    String(fieldName || "").replace(/[（）()]/g, ""),
  ]
    .map((name) => name.trim())
    .filter(Boolean);

  for (const name of [...new Set(names)]) {
    const index = text.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function findColonAfterIndex(text, startIndex) {
  const colonIndex = text.indexOf("：", startIndex);
  const halfColonIndex = text.indexOf(":", startIndex);
  if (colonIndex < 0) return halfColonIndex;
  if (halfColonIndex < 0) return colonIndex;
  return Math.min(colonIndex, halfColonIndex);
}

function getXmlTextNodes(paragraph) {
  return [...paragraph.getElementsByTagName("w:t")];
}

function getXmlParagraphText(paragraph) {
  return getXmlTextNodes(paragraph)
    .map((node) => node.textContent || "")
    .join("");
}

function setXmlParagraphText(paragraph, text) {
  const textNodes = getXmlTextNodes(paragraph);
  if (textNodes.length === 0) return;
  textNodes[0].textContent = text;
  for (let index = 1; index < textNodes.length; index += 1) {
    textNodes[index].textContent = "";
  }
}

function findXmlKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };
    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestXmlChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstXmlChoiceMarker(nodes);
}

function findFirstXmlChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadDocxBuffer(buffer, fileName) {
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);
}

function buildExportFileName(fileName = "招标文件模板.docx") {
  return fileName.replace(/\.(docx)$/i, "") + "-已填充.docx";
}

function buildFormatRevisionFileName(fileName = "待审文档.docx") {
  return fileName.replace(/-格式修订版(?=\.docx$)/i, "").replace(/\.(docx)$/i, "") + "-格式修订版.docx";
}

function getExportStatusText(state) {
  if (state === "exporting") return "正在生成文件";
  if (state === "done") return "已生成下载";
  if (state === "no-file") return "未加载模板";
  if (state === "error") return "导出失败";
  return "";
}

function findChoiceTarget(container, field) {
  const value = typeof field === "string" ? field : getFieldChoiceValue(field);
  const context = typeof field === "string" ? "" : `${field?.name || ""} ${field?.question || ""} ${field?.answerFormat || ""}`;
  const keywords = getChoiceKeywords(value, context);
  if (keywords.length === 0) return null;

  const splitNodeTarget = collectTextNodes(container)
    .map((node) => {
      const matchedKeyword = findMatchedChoiceKeyword(node.textContent || "", keywords);
      if (!matchedKeyword) return null;
      const paragraph = node.parentElement?.closest?.("p, td, li, div");
      if (!paragraph || !hasChoiceMarker(paragraph)) return null;
      return { element: paragraph, keyword: matchedKeyword };
    })
    .find(Boolean);
  if (splitNodeTarget) return splitNodeTarget;

  const candidates = [...container.querySelectorAll("p, td, li, div")]
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!/[□☐○〇▢☑✓✔]/.test(text)) return null;
      const matchedKeyword = findMatchedChoiceKeyword(text, keywords);
      return matchedKeyword ? { element: node, keyword: matchedKeyword } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.element.textContent?.length || 0) - (b.element.textContent?.length || 0));
  return candidates[0] || null;
}

function hasChoiceMarker(node) {
  return collectTextNodes(node).some((textNode) => /[□☐○〇▢☑✓✔]/.test(textNode.textContent || ""));
}

function markChoiceTarget(target) {
  const element = target?.element ?? target;
  const keyword = target?.keyword ?? "";
  if (!element) return;

  const nearbyNodes = collectTextNodes(element);
  const keywordPosition = findKeywordPosition(nearbyNodes, keyword);
  const markerPosition = keywordPosition
    ? findNearestChoiceMarkerBefore(nearbyNodes, keywordPosition)
    : findFirstChoiceMarker(nearbyNodes);

  if (!markerPosition) return;

  const { node, index } = markerPosition;
  const text = node.textContent || "";
  element.classList.add("docx-choice-selected");
  node.textContent = `${text.slice(0, index)}☑${text.slice(index + 1)}`;
}

function findKeywordPosition(nodes, keyword) {
  if (!keyword) return null;
  const normalizedKeyword = normalizeChoiceText(keyword);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const text = nodes[nodeIndex].textContent || "";
    const directIndex = text.indexOf(keyword);
    if (directIndex >= 0) return { nodeIndex, offset: directIndex };

    const normalizedText = normalizeChoiceText(text);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return { nodeIndex, offset: text.length };
    }
  }
  return null;
}

function findNearestChoiceMarkerBefore(nodes, keywordPosition) {
  for (let nodeIndex = keywordPosition.nodeIndex; nodeIndex >= 0; nodeIndex -= 1) {
    const text = nodes[nodeIndex].textContent || "";
    const searchEnd = nodeIndex === keywordPosition.nodeIndex ? keywordPosition.offset : text.length;
    const beforeKeyword = text.slice(0, searchEnd);
    const index = Math.max(
      beforeKeyword.lastIndexOf("□"),
      beforeKeyword.lastIndexOf("☐"),
      beforeKeyword.lastIndexOf("○"),
      beforeKeyword.lastIndexOf("〇"),
      beforeKeyword.lastIndexOf("▢"),
    );
    if (index >= 0) return { node: nodes[nodeIndex], index };
  }
  return findFirstChoiceMarker(nodes);
}

function findFirstChoiceMarker(nodes) {
  for (const node of nodes) {
    const text = node.textContent || "";
    const index = text.search(/[□☐○〇▢]/);
    if (index >= 0) return { node, index };
  }
  return null;
}

function findMatchedChoiceKeyword(text, keywords) {
  const normalizedText = normalizeChoiceText(text);
  return keywords.find((keyword) => {
    const normalizedKeyword = normalizeChoiceText(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword);
  });
}

function getChoiceKeywords(value, context = "") {
  const normalizedValue = normalizeChoiceText(value);
  const keywords = [];

  collectChoiceKeywordsFromText(normalizedValue, keywords);

  const bracketMatches = [...String(value || "").matchAll(/[（(]([^（）()]{2,24})[）)]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  keywords.push(...bracketMatches);

  if (normalizedValue && normalizedValue.length <= 18) {
    keywords.push(value);
  }

  if (keywords.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), keywords);
  }

  return [...new Set(keywords)]
    .map((item) => String(item || "").trim())
    .filter((item) => normalizeChoiceText(item).length >= 2)
    .sort((a, b) => normalizeChoiceText(b).length - normalizeChoiceText(a).length);
}

function collectChoiceKeywordsFromText(normalizedText, keywords) {
  if (normalizedText.includes("综合评估法")) {
    keywords.push("综合评估法", "综合评分法");
  }
  if (normalizedText.includes("最低投标价法")) {
    keywords.push("经评审的最低投标价法", "最低投标价法");
  }
  if (normalizedText.includes("不含税")) {
    keywords.push("不含税");
  } else if (normalizedText.includes("含税")) {
    keywords.push("含税");
  }
}

function normalizeChoiceText(value) {
  return (value || "")
    .replace(/[□☐○〇▢☑✓✔]/g, "")
    .replace(/^第[一二三四五六七八九十\d]+章\s*/, "")
    .replace(/[（）()：:，,。；;\s]/g, "")
    .replace(/综合评分法/g, "综合评估法")
    .trim();
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const chineseMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (chineseMatch) {
    return {
      year: chineseMatch[1],
      month: chineseMatch[2],
      day: chineseMatch[3],
    };
  }

  const numericMatch = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (numericMatch) {
    return {
      year: numericMatch[1],
      month: padDatePart(numericMatch[2]),
      day: padDatePart(numericMatch[3]),
    };
  }

  const spacedMatch = text.match(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})/);
  if (spacedMatch) {
    return {
      year: spacedMatch[1],
      month: padDatePart(spacedMatch[2]),
      day: padDatePart(spacedMatch[3]),
    };
  }

  return null;
}

function padDatePart(value) {
  return String(value || "").padStart(2, "0");
}

function isDateField(field) {
  return normalizeFillMode(field?.fillMode, field) === "date" || field?.type === "日期" || /日期|年月日|编制时间/.test(`${field?.name || ""} ${field?.answerFormat || ""} ${field?.question || ""}`);
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function findFillTarget(container, fieldName) {
  const candidates = [...container.querySelectorAll("p, td, div, span")]
    .filter((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      return text.includes(fieldName) && /[：:]/.test(text) && text.length <= 120;
    })
    .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
  return candidates[0] || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeFlexibleContext(value) {
  return escapeRegExp(value).replace(/\s+/g, "\\s*");
}

function getRenderedPageCount(container) {
  return container?.querySelectorAll(".docx-wrapper > section")?.length ?? 0;
}

function normalizePreviewPageLayout(container) {
  const wrapper = container?.querySelector(".docx-wrapper");
  if (!wrapper) return;
  [...wrapper.querySelectorAll(":scope > section")].forEach(splitOverlongPreviewPage);
}

function splitOverlongPreviewPage(page) {
  const targetHeight = getPreviewPageTargetHeight(page);
  if (!targetHeight) return;

  page.style.height = `${targetHeight}px`;
  page.style.minHeight = `${targetHeight}px`;
  const overflowLimit = getPreviewPageOverflowLimit(targetHeight);

  const articles = [...page.children].filter((child) => child.tagName?.toLowerCase() === "article");
  if (articles.length !== 1 || articles[0].children.length <= 1) return;

  const template = page.cloneNode(true);
  const sourceBlocks = [...articles[0].children];
  articles[0].replaceChildren();

  let currentPage = page;
  let currentArticle = articles[0];
  let insertAfter = page;

  for (const block of sourceBlocks) {
    currentArticle.append(block);
    const tableSplit = splitPreviewTableIfNeeded({
      block,
      currentPage,
      currentArticle,
      insertAfter,
      pageTemplate: template,
      targetHeight,
      overflowLimit,
    });
    if (tableSplit) {
      currentPage = tableSplit.currentPage;
      currentArticle = tableSplit.currentArticle;
      insertAfter = tableSplit.insertAfter;
      continue;
    }
    // ponytail: paragraph-level split; exact table/line pagination needs a real Word-compatible engine.
    if (currentArticle.children.length <= 1 || currentPage.scrollHeight <= overflowLimit) continue;
    block.remove();
    const nextPage = createPreviewPageClone(template, targetHeight);
    insertAfter.after(nextPage);
    insertAfter = nextPage;
    currentPage = nextPage;
    currentArticle = nextPage.querySelector(":scope > article");
    currentArticle.append(block);
  }
}

function splitPreviewTableIfNeeded({ block, currentPage, currentArticle, insertAfter, pageTemplate, targetHeight, overflowLimit }) {
  if (block.tagName?.toLowerCase() !== "table" || block.rows.length <= 1) return null;

  const rows = [...block.rows];
  const tableTemplate = block.cloneNode(true);
  let activePage = currentPage;
  let activeArticle = currentArticle;
  let activeInsertAfter = insertAfter;
  let activeTable = createEmptyPreviewTable(tableTemplate);
  block.replaceWith(activeTable);

  rows.forEach((row) => {
    getPreviewTableBody(activeTable).append(row);
    if (activeTable.rows.length <= 1 || activePage.scrollHeight <= overflowLimit) return;
    row.remove();
    const nextPage = createPreviewPageClone(pageTemplate, targetHeight);
    activeInsertAfter.after(nextPage);
    activeInsertAfter = nextPage;
    activePage = nextPage;
    activeArticle = nextPage.querySelector(":scope > article");
    activeTable = createEmptyPreviewTable(tableTemplate);
    activeArticle.append(activeTable);
    getPreviewTableBody(activeTable).append(row);
  });

  return { currentPage: activePage, currentArticle: activeArticle, insertAfter: activeInsertAfter };
}

function createEmptyPreviewTable(table) {
  const clone = table.cloneNode(true);
  clone.querySelectorAll("tr").forEach((row) => row.remove());
  if (clone.tBodies.length === 0) clone.append(document.createElement("tbody"));
  return clone;
}

function getPreviewTableBody(table) {
  return table.tBodies[0] || table.appendChild(document.createElement("tbody"));
}

function createPreviewPageClone(template, targetHeight) {
  const clone = template.cloneNode(true);
  clone.removeAttribute("data-preview-page");
  clone.style.height = `${targetHeight}px`;
  clone.style.minHeight = `${targetHeight}px`;
  clone.querySelectorAll(":scope > article").forEach((article, index) => {
    if (index === 0) article.replaceChildren();
    else article.remove();
  });
  return clone;
}

function getPreviewPageTargetHeight(page) {
  const style = getComputedStyle(page);
  const width = parseCssPixels(style.width);
  const minHeight = parseCssPixels(style.minHeight);
  const ratio = width > 0 && minHeight > 0 ? minHeight / width : 0;
  if (ratio >= 0.6 && ratio <= 1.8) return minHeight;
  return width > 0 ? width * (297 / 210) : minHeight;
}

function getPreviewPageOverflowLimit(targetHeight) {
  return targetHeight + Math.max(180, targetHeight * 0.12);
}

function parseCssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function preparePreviewPages(container) {
  const sections = [...(container?.querySelectorAll(".docx-wrapper > section") ?? [])];
  sections.forEach((section, index) => {
    const sectionPage = index + 1;
    section.dataset.previewPage = String(sectionPage);
    section.hidden = false;
  });
}

function getPreviewPageElement(container, pageNumber) {
  return container?.querySelector(`.docx-wrapper > section[data-preview-page="${pageNumber}"]`) ?? null;
}

function scrollPreviewToPage(scrollContainer, pageNumber, behavior = "smooth") {
  const page = getPreviewPageElement(scrollContainer, pageNumber);
  if (!scrollContainer || !page) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const top = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16;
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

function getAuditPdfScrollContainer(host) {
  const viewer = host?.querySelector(".pdfViewer");
  return viewer?.parentElement || host;
}

function getAuditPdfPageElement(host, pageNumber) {
  return (
    host?.querySelector(`.pdfViewer .page[data-page-number="${pageNumber}"]`) ??
    host?.querySelector(`.pdfViewer .page:nth-child(${pageNumber})`) ??
    null
  );
}

function scrollAuditPdfToPage(host, pageNumber, behavior = "auto") {
  const scrollContainer = getAuditPdfScrollContainer(host);
  const page = getAuditPdfPageElement(host, pageNumber);
  if (!scrollContainer || !page) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const top = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16;
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

async function collectPdfPageTexts(pdfDocument) {
  const pageCount = pdfDocument?.numPages || 0;
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageTexts.push({
      page: pageNumber,
      text: textContent.items.map((item) => item.str || "").join(" "),
    });
  }
  return pageTexts;
}

function getAuditPdfSearchHits(pageTexts = [], term = "") {
  const keyword = String(term || "").trim().toLowerCase();
  if (!keyword) return [];
  const hits = [];
  pageTexts.forEach((pageText) => {
    const text = String(pageText.text || "").toLowerCase();
    let startIndex = 0;
    while (startIndex <= text.length - keyword.length) {
      const index = text.indexOf(keyword, startIndex);
      if (index < 0) break;
      hits.push({ page: pageText.page || 1, index });
      startIndex = index + Math.max(1, keyword.length);
    }
  });
  return hits;
}

async function resolveAuditPdfOutlinePage(pdfDocument, dest) {
  try {
    const destination = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest;
    if (!Array.isArray(destination) || !destination[0]) return null;
    const pageIndex = await pdfDocument.getPageIndex(destination[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function flattenAuditPdfOutline(pdfDocument) {
  const outline = await pdfDocument.getOutline();
  if (!outline?.length) return [];
  const nodes = [];
  let order = 0;

  async function visit(items, level) {
    for (const item of items) {
      order += 1;
      nodes.push({
        id: `pdf-outline-${order}`,
        title: String(item.title || `第 ${order} 项`),
        page: await resolveAuditPdfOutlinePage(pdfDocument, item.dest),
        level: Math.max(0, level - 1),
        index: order,
      });
      if (item.items?.length) {
        await visit(item.items, level + 1);
      }
    }
  }

  await visit(outline, 1);
  return nodes.filter((item) => item.page);
}

function flashAuditPdfPage(host, pageNumber) {
  const page = getAuditPdfPageElement(host, pageNumber);
  if (!page) return;
  gsap.fromTo(page, { autoAlpha: 0.84 }, { autoAlpha: 1, duration: 0.22, ease: "power1.out" });
}

function scrollPreviewToElement(scrollContainer, element, behavior = "smooth") {
  if (!scrollContainer || !element) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = scrollContainer.scrollTop + elementRect.top - containerRect.top - Math.min(180, containerRect.height * 0.28);
  scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
}

function resolveVisiblePreviewPage(scrollContainer, previewHost) {
  const pages = [...(previewHost?.querySelectorAll(".docx-wrapper > section") ?? [])];
  if (!scrollContainer || pages.length === 0) return 1;

  const containerRect = scrollContainer.getBoundingClientRect();
  const anchorY = containerRect.top + Math.min(180, containerRect.height * 0.35);
  const best = pages
    .map((page, index) => {
      const rect = page.getBoundingClientRect();
      const distance = rect.top <= anchorY && rect.bottom >= anchorY ? 0 : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
      return { page: index + 1, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return best?.page || 1;
}

function resolveVisibleAuditPdfPage(host) {
  const scrollContainer = getAuditPdfScrollContainer(host);
  const pages = [...(host?.querySelectorAll(".pdfViewer .page") ?? [])];
  if (!scrollContainer || pages.length === 0) return 1;

  const containerRect = scrollContainer.getBoundingClientRect();
  const anchorY = containerRect.top + Math.min(180, containerRect.height * 0.35);
  const best = pages
    .map((page, index) => {
      const rect = page.getBoundingClientRect();
      const distance = rect.top <= anchorY && rect.bottom >= anchorY ? 0 : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
      return { page: Number(page.dataset.pageNumber) || index + 1, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return best?.page || 1;
}

function isPreviewPageMostlyVisible(scrollContainer, page) {
  if (!scrollContainer || !page) return false;
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  return pageRect.top >= containerRect.top + 8 && pageRect.top <= containerRect.top + Math.min(180, containerRect.height * 0.35);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolvePreviewPage(anchorNode, container) {
  if (!anchorNode || !container) return 1;
  const element = anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
  const page = element?.closest?.("section");
  if (!page) return 1;
  return [...container.querySelectorAll(".docx-wrapper > section")].indexOf(page) + 1 || 1;
}

const templateDbName = "tender-agent-template-db";
const templateStoreName = "templates";

async function openTemplateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(templateDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(templateStoreName)) {
        db.createObjectStore(templateStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredTemplates() {
  const serverTemplates = await readServerTemplates();
  if (serverTemplates.length > 0) return serverTemplates;

  try {
    const db = await openTemplateDb();
    const templates = await readAllFromTemplateDb(db);
    db.close();
    if (templates.length > 0) {
      return templates.sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
    }
    return migrateLegacyTemplates();
  } catch {
    return migrateLegacyTemplates();
  }
}

async function readStoredTemplate(templateId) {
  const serverTemplate = await readServerTemplate(templateId);
  if (serverTemplate) return serverTemplate;

  try {
    const db = await openTemplateDb();
    const template = await new Promise((resolve, reject) => {
      const transaction = db.transaction(templateStoreName, "readonly");
      const store = transaction.objectStore(templateStoreName);
      const request = store.get(templateId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return template;
  } catch {
    return null;
  }
}

async function storeTemplates(templates) {
  const cleanTemplates = templates.map(sanitizeTemplateForStorage);
  await storeServerTemplates(cleanTemplates);
  try {
    const db = await openTemplateDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(templateStoreName, "readwrite");
      const store = transaction.objectStore(templateStoreName);
      store.clear();
      cleanTemplates.forEach((template) => store.put(template));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  } catch {
    // The backend file library is authoritative; IndexedDB is only a browser cache.
  }
}

async function readKnowledgeBases() {
  try {
    const response = await fetch("/api/knowledge-bases");
    if (!response.ok) return [];
    const bases = await response.json();
    return Array.isArray(bases) ? bases : [];
  } catch {
    return [];
  }
}

async function postKnowledgeBase(payload) {
  const response = await fetch("/api/knowledge-bases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "知识库创建失败");
  return result;
}

async function postKnowledgeDocument(kbId, material) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: material.name,
      size: material.size,
      text: material.text,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "资料入库失败");
  return result;
}

async function removeKnowledgeDocument(kbId, documentId) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "资料删除失败");
  return result;
}

async function removeKnowledgeBase(kbId) {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "知识库删除失败");
  return result;
}

async function searchKnowledge(query, projectId) {
  const response = await fetch("/api/knowledge-bases/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      projectId,
      includeGlobal: true,
      topK: 8,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "知识库检索失败");
  return Array.isArray(result) ? result : [];
}

async function readServerTemplates() {
  try {
    const response = await fetch("/api/templates");
    if (!response.ok) return [];
    const templates = await response.json();
    return Array.isArray(templates) ? templates.map(deserializeTemplate).sort(sortTemplatesBySavedAt) : [];
  } catch {
    return [];
  }
}

async function readServerTemplate(templateId) {
  try {
    const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`);
    if (!response.ok) return null;
    const template = await response.json();
    return template ? deserializeTemplate(template) : null;
  } catch {
    return null;
  }
}

async function storeServerTemplates(templates) {
  const response = await fetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(templates.map(serializeTemplate)),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "后端模板库保存失败");
  }
}

async function readDraftState() {
  try {
    const response = await fetch("/api/draft");
    if (!response.ok) return null;
    const draft = await response.json();
    return deserializeDraft(draft);
  } catch {
    return null;
  }
}

async function saveDraftState(draft) {
  if (!draft.templateFile?.buffer) return;
  try {
    await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeDraft(draft)),
    });
  } catch {
    // Draft autosave should never block the workspace.
  }
}

async function clearDraftState() {
  try {
    await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Draft cleanup should never block creating a new template.
  }
}

function serializeDraft(draft) {
  const cleanDraft = {
    ...draft,
    templateFields: sanitizeTemplateFields(draft.templateFields),
    fillFields: sanitizeTemplateFields(draft.fillFields),
  };
  return {
    ...cleanDraft,
    templateFile: cleanDraft.templateFile
      ? {
          ...cleanDraft.templateFile,
          buffer: undefined,
          fileBase64: cleanDraft.templateFile.buffer ? arrayBufferToBase64(cleanDraft.templateFile.buffer) : null,
        }
      : null,
    filledTemplateFile: cleanDraft.filledTemplateFile
      ? {
          ...cleanDraft.filledTemplateFile,
          buffer: undefined,
          fileBase64: cleanDraft.filledTemplateFile.buffer ? arrayBufferToBase64(cleanDraft.filledTemplateFile.buffer) : null,
        }
      : null,
    savedAt: new Date().toISOString(),
  };
}

function deserializeDraft(draft) {
  if (!draft?.templateFile?.fileBase64) return null;
  return {
    ...draft,
    templateFields: sanitizeTemplateFields(draft.templateFields),
    fillFields: sanitizeTemplateFields(draft.fillFields),
    templateFile: {
      ...draft.templateFile,
      buffer: base64ToArrayBuffer(draft.templateFile.fileBase64),
    },
    filledTemplateFile: draft.filledTemplateFile?.fileBase64
      ? {
          ...draft.filledTemplateFile,
          buffer: base64ToArrayBuffer(draft.filledTemplateFile.fileBase64),
        }
      : null,
  };
}

function normalizeKnowledgeBaseIds(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function readAllFromTemplateDb(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(templateStoreName, "readonly");
    const store = transaction.objectStore(templateStoreName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

function serializeTemplate(template) {
  const cleanTemplate = sanitizeTemplateForStorage(template);
  return {
    ...cleanTemplate,
    fileBuffer: undefined,
    fileBase64: cleanTemplate.fileBuffer ? arrayBufferToBase64(cleanTemplate.fileBuffer) : cleanTemplate.fileBase64,
  };
}

function deserializeTemplate(template) {
  if (!template) return template;
  const cleanTemplate = sanitizeTemplateForStorage(template);
  return {
    ...cleanTemplate,
    fileBuffer: cleanTemplate.fileBuffer || (cleanTemplate.fileBase64 ? base64ToArrayBuffer(cleanTemplate.fileBase64) : null),
  };
}

function sanitizeTemplateForStorage(template) {
  if (!template) return template;
  return {
    ...template,
    fields: sanitizeTemplateFields(template.fields),
  };
}

function sanitizeTemplateFields(fields) {
  return Array.isArray(fields) ? fields.map(stripSelectionStateFromField) : fields;
}

function stripSelectionStateFromField(field) {
  if (!field?.marker?.selectionState) return field;
  const { selectionState, ...marker } = field.marker;
  return { ...field, marker };
}

async function waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer, options = {}) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const intervalMs = options.intervalMs ?? 700;
  const start = Date.now();
  await delay(options.initialDelayMs ?? 900);
  while (Date.now() - start < timeoutMs) {
    const buffer = await fetchOfficeDocumentBuffer(officeDocId);
    if (buffer && (!baselineBuffer || !arrayBuffersEqual(buffer, baselineBuffer))) return buffer;
    await delay(intervalMs);
  }
  return null;
}

async function fetchOfficeDocumentBuffer(officeDocId) {
  if (!officeDocId) return null;
  const response = await fetch(`/api/office/documents/${officeDocId}/file?t=${Date.now()}`, { cache: "no-store" });
  return response.ok ? response.arrayBuffer() : null;
}

function arrayBuffersEqual(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sortTemplatesBySavedAt(a, b) {
  return (b.savedAtMs || 0) - (a.savedAtMs || 0);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function migrateLegacyTemplates() {
  try {
    const raw = localStorage.getItem("tender-agent-template-library");
    const templates = raw ? JSON.parse(raw) : [];
    if (templates.length > 0) {
      await storeTemplates(templates);
    }
    return templates;
  } catch {
    return [];
  }
}

createRoot(document.getElementById("root")).render(<App />);

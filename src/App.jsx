import React, { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { auditDocxFormat } from "./lib/docx/formatAudit";
import { reviseDocxFormat } from "./lib/docx/formatRevise";
import SystemSettings from "./pages/SystemSettings.jsx";
import TemplateManagement from "./pages/TemplateManagement.jsx";
import {
  readStoredTemplates,
  readStoredTemplate,
  storeTemplates,
  readDraftState,
  saveDraftState,
  clearDraftState,
  normalizeKnowledgeBaseIds,
} from "./services/templates.js";
import {
  postKnowledgeBase,
  postKnowledgeDocument,
  readKnowledgeBases,
  removeKnowledgeBase,
  removeKnowledgeDocument,
} from "./services/knowledgeBase.js";
import KnowledgeBaseManagement from "./pages/KnowledgeBaseManagement.jsx";
import {
  currentProjectId,
  documentSlots,
  initialFillFields,
  initialTemplateFields,
  initialTemplateFile,
  templateCategories,
} from "./constants/templates.js";
import StatusPill from "./components/StatusPill.jsx";
import {
  DocumentFrame,
  FieldForm,
  FieldLine,
  FillFieldRow,
  PreviewState,
  auditConfigItems,
  auditConfigStorageKey,
  clearPreviewMarkers,
  createAnnotationMarkerData,
  createPreviewId,
  enhanceAuditWithAiOutline,
  exportFilledDocx,
  fetchOfficeDocumentBuffer,
  getFillFieldDisplayPage,
  getNextFieldNumber,
  getOutlineRevisionAction,
  getOutlineRevisionReason,
  isAuditIssueEnabled,
  readAuditConfig,
  readDocxStructure,
  removePreviewMarker,
  requestOnlyOfficeAddFieldBookmark,
  requestOnlyOfficeAddInputPoint,
  requestOnlyOfficeDocumentDownloadAs,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeFillField,
  waitForChangedOfficeDocumentBuffer,
  waitForNextFrame,
} from "./features/docx/runtime.jsx";
import {
  fillModeOptions,
  fieldCategoryOptions,
  createAnnotatedField,
  createFillFieldsFromTemplate,
  mergeFillFieldsWithTemplate,
  pickTemplateFillContext,
  normalizeTemplateFieldForRuntime,
  createDynamicSlot,
  getTemplateFieldSourceText,
  normalizeFieldCategory,
  isReplacementField,
  requiresInputPoint,
  getFieldWriteMode,
  hasInputPoint,
  canUseMarkedSelectionAsFillTarget,
  hasMarkedSelection,
  getFieldDisplayText,
  normalizeFillMode,
  getFillModeOptions,
  inferFillMode,
  getFillModeLabel,
  hasFillBlank,
} from "./utils/fields.js";
import {
  buildExportFileName,
  buildFormatRevisionFileName,
  downloadDocxBuffer,
  formatFileSize,
  getExportStatusText,
  readKnowledgeDocumentFile,
  readMaterialFile,
} from "./utils/files.js";
import {
  buildContractFolders,
  getContractFolder,
  getTemplateCategoryTone,
  groupContractFolders,
  inferTemplateCategory,
  normalizeTemplateCategory,
  summarizeFieldTypes,
} from "./utils/templates.js";
import SidebarItem from "./components/SidebarItem.jsx";
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

gsap.registerPlugin(useGSAP);

export default function App() {
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
  const [bulkFillProgress, setBulkFillProgress] = useState({ current: 0, total: 0 });
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [selectedProjectKnowledgeBaseIds, setSelectedProjectKnowledgeBaseIds] = useState([]);
  const [selectedGlobalKnowledgeBaseIds, setSelectedGlobalKnowledgeBaseIds] = useState([]);
  const [knowledgeTopK, setKnowledgeTopK] = useState(8);
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
  const onlyOfficeAiKnowledgeContext = useMemo(() => {
    const kbIds = [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds];
    return {
      enabled: kbIds.length > 0,
      apiBase: window.location.origin,
      projectId: currentProjectId,
      kbIds,
      topK: knowledgeTopK,
      bases: knowledgeBases
        .filter((base) => kbIds.includes(base.id))
        .map((base) => ({ id: base.id, name: base.name, scope: base.scope })),
    };
  }, [currentProjectId, knowledgeBases, knowledgeTopK, selectedGlobalKnowledgeBaseIds, selectedProjectKnowledgeBaseIds]);

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

  async function fillFieldWithAI(fieldId, fieldsSnapshot = enrichedFillFields, options = {}) {
    const syncDocument = options.syncDocument !== false;
    const targetField = fieldsSnapshot.find((field) => field.id === fieldId);
    const templateField = templateFields.find((field) => field.id === fieldId);
    if (!targetField) return fieldsSnapshot;
    const contractField = { ...targetField, ...templateField };

    if (requiresInputPoint(contractField) && !hasInputPoint(contractField)) {
      const nextFieldsSnapshot = fieldsSnapshot.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              status: "需补充资料",
              confidence: 0,
              source: "缺少输入点",
              evidence: "该字段是填空写入字段，请先在模板标注工作台把光标放到实际填写位置并添加输入点。",
              sourceSnippetText: "",
            }
          : field,
      );
      enrichedFillFieldsRef.current = nextFieldsSnapshot;
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
                sourceSnippetText: "",
              }
            : field,
        ),
      );
      return nextFieldsSnapshot;
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
            writeMode: getFieldWriteMode(contractField),
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
        sourceSnippetText: result.sourceSnippetText || "",
      };
      const nextFieldsSnapshot = enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? appliedField : field));
      enrichedFillFieldsRef.current = nextFieldsSnapshot;
      setFillFields((fields) =>
        fields.map((field) =>
          field.id === fieldId
            ? appliedField
            : field,
        ),
      );
      requestOnlyOfficeFillField(appliedField);
      if (syncDocument) queueFilledOfficeDocumentSync(nextFieldsSnapshot);
      return nextFieldsSnapshot;
    } catch (error) {
      const errorField = {
        ...targetField,
        status: "需补充资料",
        confidence: 0,
        source: "AI 填充失败",
        evidence: error.message || "请检查模型配置、网络或上传资料。",
        sourceSnippetText: "",
      };
      const nextFieldsSnapshot = enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? errorField : field));
      enrichedFillFieldsRef.current = nextFieldsSnapshot;
      setFillFields((fields) =>
        fields.map((field) =>
          field.id === fieldId
            ? errorField
            : field,
        ),
      );
      return nextFieldsSnapshot;
    }
  }

  async function generateField(fieldId) {
    window.clearTimeout(fillSyncTimerRef.current);
    await fillFieldWithAI(fieldId, enrichedFillFields, { syncDocument: false });
  }

  async function generateAllFields() {
    const pendingFields = enrichedFillFields.filter((field) => field.status !== "已确认" && field.status !== "生成中");
    if (pendingFields.length === 0 || generatingAll) return;

    setGeneratingAll(true);
    setBulkFillProgress({ current: 0, total: pendingFields.length });
    setShowCitations(false);
    window.clearTimeout(fillSyncTimerRef.current);
    let fieldsSnapshot = enrichedFillFields;
    try {
      for (let index = 0; index < pendingFields.length; index += 1) {
        const field = pendingFields[index];
        setBulkFillProgress({ current: index + 1, total: pendingFields.length });
        fieldsSnapshot = await fillFieldWithAI(field.id, fieldsSnapshot, { syncDocument: false }) || fieldsSnapshot;
      }
      queueFilledOfficeDocumentSync(fieldsSnapshot);
    } finally {
      setGeneratingAll(false);
      setBulkFillProgress({ current: 0, total: 0 });
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
          sourceSnippetText: "",
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
              sourceSnippetText: "",
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
                bulkFillProgress={bulkFillProgress}
                knowledgeBases={knowledgeBases}
                selectedProjectKnowledgeBaseIds={selectedProjectKnowledgeBaseIds}
                selectedGlobalKnowledgeBaseIds={selectedGlobalKnowledgeBaseIds}
                knowledgeTopK={knowledgeTopK}
                aiKnowledgeContext={onlyOfficeAiKnowledgeContext}
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
  bulkFillProgress,
  knowledgeBases,
  selectedProjectKnowledgeBaseIds,
  selectedGlobalKnowledgeBaseIds,
  knowledgeTopK,
  aiKnowledgeContext,
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
  const [panelCollapsed, setPanelCollapsed] = useState(false);
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
  const anyKnowledgeSelected = selectedProjectKnowledgeBaseIds.length > 0 || selectedGlobalKnowledgeBaseIds.length > 0;
  const bulkProgressText = generatingAll && bulkFillProgress?.total
    ? `${bulkFillProgress.current}/${bulkFillProgress.total}`
    : "";

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
    <div className={panelCollapsed ? "work-grid fill-grid fill-grid-panel-collapsed" : "work-grid fill-grid"}>
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
          aiKnowledgeContext={aiKnowledgeContext}
        />
      </section>

      <aside className={panelCollapsed ? "right-panel fill-panel is-collapsed" : "right-panel fill-panel"}>
        <button
          className="fill-panel-collapse-button"
          type="button"
          aria-label={panelCollapsed ? "展开填充项面板" : "收起填充项面板"}
          title={panelCollapsed ? "展开填充项面板" : "收起填充项面板"}
          onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
        >
          {panelCollapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
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
            <div className="fill-title-actions">
              <span className="soft-count">当前页 {pageFields.length} 项</span>
              <select
                className="knowledge-topk-select"
                value={knowledgeTopK}
                onChange={(event) => onKnowledgeTopKChange(Number(event.target.value))}
                disabled={!anyKnowledgeSelected}
                aria-label="知识库召回数量"
              >
                <option value={3}>召回3段</option>
                <option value={8}>召回8段</option>
                <option value={10}>召回10段</option>
              </select>
            </div>
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
              {generatingAll ? `一键填充 ${bulkProgressText}` : `一键填充${fillableCount > 0 ? ` ${fillableCount}` : ""}`}
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


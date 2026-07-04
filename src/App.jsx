import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "react-pdf-highlighter/dist/style.css";
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
import FormatAuditWorkspace from "./pages/FormatAuditWorkspace.jsx";
import AnnotateWorkspace from "./pages/AnnotateWorkspace.jsx";
import FillWorkspace from "./pages/FillWorkspace.jsx";
import {
  currentProjectId,
  documentSlots,
  initialFillFields,
  initialTemplateFields,
  initialTemplateFile,
} from "./constants/templates.js";
import {
  createPreviewId,
} from "./features/docx/runtime.jsx";
import {
  clearPreviewMarkers,
  removePreviewMarker,
} from "./features/docx/annotate/markers.js";
import {
  requestOnlyOfficeAddFieldBookmark,
  requestOnlyOfficeAddInputPoint,
  requestOnlyOfficeDocumentDownloadAs,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeFillField,
  requestOnlyOfficeGoToPage,
  requestOnlyOfficeInsertPlaceholderVariable,
} from "./features/docx/office/bridge.jsx";
import {
  fetchOfficeDocumentBuffer,
  waitForChangedOfficeDocumentBuffer,
} from "./features/docx/office/documentSync.js";
import { getNextFieldNumber } from "./features/docx/fill/FieldControls.jsx";
import {
  applyPlaceholderAnchors,
  buildPlaceholderToken,
  createPlaceholderVariable,
  getNextPlaceholderAnchorIndex,
  normalizePlaceholderName,
  normalizePlaceholderVariables,
} from "./features/placeholders/variables.js";
import {
  createAnnotatedField,
  createFillFieldsFromTemplate,
  mergeFillFieldsWithTemplate,
  normalizeTemplateFieldForRuntime,
  createDynamicSlot,
  getTemplateFieldSourceText,
  normalizeFieldCategory,
  getFieldWriteMode,
  hasInputPoint,
  normalizeFillMode,
  getFieldSetupIssue,
  sortFieldsByDocumentOrder,
} from "./utils/fields.js";
import {
  formatFileSize,
  readKnowledgeDocumentFile,
  readMaterialFile,
} from "./utils/files.js";
import {
  inferTemplateCategory,
  normalizeTemplateCategory,
  summarizeFieldTypes,
} from "./utils/templates.js";
import SidebarItem from "./components/SidebarItem.jsx";
import {
  Archive,
  BookOpenText,
  ChevronDown,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Settings,
  ShieldCheck,
} from "lucide-react";

gsap.registerPlugin(useGSAP);

export default function App() {
  const [activeModule, setActiveModule] = useState("workspace");
  const [activeWorkspace, setActiveWorkspace] = useState("annotate");
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(true);
  const [settingsNavOpen, setSettingsNavOpen] = useState(true);
  const [templateFile, setTemplateFile] = useState(initialTemplateFile);
  const [templateFields, setTemplateFields] = useState(initialTemplateFields);
  const [placeholderVariables, setPlaceholderVariables] = useState(() => normalizePlaceholderVariables());
  const [placeholderAnchors, setPlaceholderAnchors] = useState([]);
  const [annotateSidePanelMode, setAnnotateSidePanelMode] = useState("fields");
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
  const fillPreviewPageLockRef = useRef(null);
  const templateFileRef = useRef(templateFile);
  const placeholderVariablesRef = useRef(placeholderVariables);
  const placeholderAnchorsRef = useRef(placeholderAnchors);
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

  useEffect(() => {
    placeholderAnchorsRef.current = placeholderAnchors;
  }, [placeholderAnchors]);

  useEffect(() => {
    placeholderVariablesRef.current = placeholderVariables;
  }, [placeholderVariables]);

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
        setPlaceholderVariables(normalizePlaceholderVariables(draft.placeholderVariables));
        setPlaceholderAnchors(applyPlaceholderAnchors([], draft.placeholderAnchors || []));
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
        placeholderVariables,
        placeholderAnchors,
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
    placeholderVariables,
    placeholderAnchors,
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

  function syncAnnotatedOfficeDocument(
    fieldsSnapshot,
    sourceOfficeDocId = templateOfficeDocId,
    anchorsSnapshot = placeholderAnchorsRef.current,
    variablesSnapshot = placeholderVariablesRef.current,
  ) {
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
          placeholderVariables: variablesSnapshot,
          placeholderAnchors: anchorsSnapshot,
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
          placeholderVariables: placeholderVariablesRef.current,
          placeholderAnchors: placeholderAnchorsRef.current,
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

  function updateFillPreviewPage(pageNumber) {
    const lockedPage = fillPreviewPageLockRef.current;
    if (lockedPage) {
      setFillPreviewPage(lockedPage);
      return;
    }
    setFillPreviewPage(pageNumber);
  }

  function startNewAnnotatedTemplate() {
    clearDraftState();
    annotatedTemplateBufferRef.current = null;
    setTemplateFile(null);
    setTemplateFields([]);
    setPlaceholderVariables(normalizePlaceholderVariables());
    setPlaceholderAnchors([]);
    setAnnotateSidePanelMode("fields");
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
    setPlaceholderVariables(normalizePlaceholderVariables());
    setPlaceholderAnchors([]);
    setAnnotateSidePanelMode("fields");
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
    setAnnotateSidePanelMode("fields");
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

  function addPlaceholderVariable() {
    const nextVariables = [...placeholderVariables, createPlaceholderVariable(`字段${placeholderVariables.length + 1}`, placeholderVariables)];
    setPlaceholderVariables(nextVariables);
    setAnnotateSidePanelMode("placeholders");
    setSaveState("dirty");
  }

  function renamePlaceholderVariable(variableId, name) {
    const nextVariables = placeholderVariables.map((variable) =>
      variable.id === variableId
        ? {
            ...variable,
            name: normalizePlaceholderName(name),
            token: buildPlaceholderToken(name),
          }
        : variable,
    );
    setPlaceholderVariables(nextVariables);
    setSaveState("dirty");
  }

  function removePlaceholderVariable(variableId) {
    const anchorCount = placeholderAnchors.filter((anchor) => anchor.variableId === variableId).length;
    if (anchorCount > 0 && !window.confirm(`该字段已插入 ${anchorCount} 处。删除后不会删除 Word 中已有占位符文字，但模板元数据不再管理这些位置。确认删除？`)) {
      return;
    }
    const nextVariables = placeholderVariables.filter((variable) => variable.id !== variableId);
    const nextAnchors = placeholderAnchors.filter((anchor) => anchor.variableId !== variableId);
    setPlaceholderVariables(nextVariables);
    setPlaceholderAnchors(nextAnchors);
    setSaveState("dirty");
  }

  function insertPlaceholderVariable(variable) {
    const name = normalizePlaceholderName(variable?.name);
    const normalized = { ...variable, name, token: buildPlaceholderToken(name) };
    if (!normalized.name || !normalized.token) {
      window.alert("请先填写字段名称。");
      return;
    }
    const anchorIndex = getNextPlaceholderAnchorIndex(placeholderAnchorsRef.current, normalized.id);
    requestOnlyOfficeInsertPlaceholderVariable(normalized, anchorIndex).then((result) => {
      if (result?.timeout) window.alert(result.error || "OnlyOffice 未响应自动字段插入命令，请确认左侧文档已加载完成。");
    });
    setAnnotateSidePanelMode("placeholders");
  }

  function jumpToPlaceholderAnchor(anchor) {
    const page = Math.max(1, Number(anchor?.page) || 1);
    setAnnotatePreviewPage(page);
    requestOnlyOfficeGoToPage(page);
    setAnnotateSidePanelMode("placeholders");
  }

  function applyPlaceholderAnchorResult(result) {
    if (!result?.ok) {
      window.alert(result?.error || "占位符变量设置失败。");
      return;
    }
    const incomingAnchors = result.anchor ? [result.anchor] : result.anchors || [];
    const nextAnchors = applyPlaceholderAnchors(placeholderAnchorsRef.current, incomingAnchors);
    setPlaceholderAnchors(nextAnchors);
    setAnnotateSidePanelMode("placeholders");
    setSaveState("dirty");
    syncAnnotatedOfficeDocument(templateFields, templateOfficeDocId, nextAnchors, placeholderVariablesRef.current);
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
    setPlaceholderVariables(normalizePlaceholderVariables());
    setPlaceholderAnchors([]);
    setAnnotateSidePanelMode("fields");
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
    const setupIssues = templateFields
      .map((field) => ({ field, issue: getFieldSetupIssue(field) }))
      .filter((item) => item.issue);
    const hasPendingFields = templateFields.some((field) => field.status !== "已标注");
    const hasTemplateMarkers = templateFields.length > 0 || placeholderAnchors.length > 0;
    const isComplete = hasTemplateMarkers && invalidFields.length === 0 && setupIssues.length === 0 && !hasPendingFields;

    if (!isComplete) {
      setSaveState("incomplete");
      if (setupIssues.length > 0) {
        window.alert(`有 ${setupIssues.length} 个字段缺少稳定写入位置：\n${setupIssues.slice(0, 6).map(({ field, issue }) => `- ${getTemplateFieldSourceText(field) || field.name || field.id}：${issue}`).join("\n")}`);
      }
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
      placeholderCount: placeholderAnchors.length,
      confirmedCount: normalizedTemplateFields.filter((field) => field.status === "已标注").length,
      typeSummary: summarizeFieldTypes(normalizedTemplateFields),
      fields: normalizedTemplateFields,
      placeholderVariables,
      placeholderAnchors,
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
      placeholderVariables,
      placeholderAnchors,
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
    setPlaceholderVariables(normalizePlaceholderVariables(templateToUse.placeholderVariables));
    setPlaceholderAnchors(applyPlaceholderAnchors([], templateToUse.placeholderAnchors || []));
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
      setPlaceholderVariables(normalizePlaceholderVariables());
      setPlaceholderAnchors([]);
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
    setPlaceholderVariables(normalizePlaceholderVariables(templateToEdit.placeholderVariables));
    setPlaceholderAnchors(applyPlaceholderAnchors([], templateToEdit.placeholderAnchors || []));
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
      setPlaceholderVariables(normalizePlaceholderVariables());
      setPlaceholderAnchors([]);
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

  function isOnlyOfficeFillFailure(writeResult) {
    return writeResult && writeResult.ok === false && !writeResult.skipped && !writeResult.timeout;
  }

  function markOnlyOfficeFillFailure(field, writeResult) {
    return {
      ...field,
      status: "需补充资料",
      confidence: 0,
      source: "OnlyOffice 写入失败",
      evidence: writeResult?.error || "未收到 OnlyOffice 写入回执，请确认填充预览已打开并重新尝试。",
      sourceSnippetText: field.sourceSnippetText || "",
    };
  }

  async function fillFieldWithAI(fieldId, fieldsSnapshot = enrichedFillFields, options = {}) {
    const syncDocument = options.syncDocument !== false;
    const targetField = fieldsSnapshot.find((field) => field.id === fieldId);
    const templateField = templateFields.find((field) => field.id === fieldId);
    if (!targetField) return fieldsSnapshot;
    const contractField = { ...targetField, ...templateField };
    const setupIssue = getFieldSetupIssue(contractField);

    if (setupIssue) {
      const nextFieldsSnapshot = fieldsSnapshot.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              status: "需补充资料",
              confidence: 0,
              source: "字段定位校验",
              evidence: setupIssue,
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
                source: "字段定位校验",
                evidence: setupIssue,
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
      const writeResult = await requestOnlyOfficeFillField(appliedField, { suppressPageSync: Boolean(options.suppressPageSync) });
      if (isOnlyOfficeFillFailure(writeResult)) {
        const failedField = markOnlyOfficeFillFailure(appliedField, writeResult);
        const failedFieldsSnapshot = enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? failedField : field));
        enrichedFillFieldsRef.current = failedFieldsSnapshot;
        setFillFields((fields) => fields.map((field) => (field.id === fieldId ? failedField : field)));
        return failedFieldsSnapshot;
      }
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
    await fillFieldWithAI(fieldId, enrichedFillFields);
  }

  async function generateAllFields() {
    const pendingFields = sortFieldsByDocumentOrder(enrichedFillFields.filter((field) => field.status !== "已确认" && field.status !== "生成中"));
    if (pendingFields.length === 0 || generatingAll) return;
    const preservedFillPreviewPage = fillPreviewPage;
    const blockedFields = pendingFields
      .map((field) => {
        const templateField = templateFields.find((item) => item.id === field.id);
        return { field, issue: getFieldSetupIssue({ ...field, ...templateField }) };
      })
      .filter((item) => item.issue);
    const runnableFields = pendingFields.filter((field) => !blockedFields.some((item) => item.field.id === field.id));

    setGeneratingAll(true);
    fillPreviewPageLockRef.current = preservedFillPreviewPage;
    setBulkFillProgress({ current: 0, total: runnableFields.length });
    setShowCitations(false);
    window.clearTimeout(fillSyncTimerRef.current);
    let fieldsSnapshot = blockedFields.length
      ? enrichedFillFields.map((field) => {
          const blocked = blockedFields.find((item) => item.field.id === field.id);
          return blocked
            ? { ...field, status: "需补充资料", confidence: 0, source: "字段定位校验", evidence: blocked.issue, sourceSnippetText: "" }
            : field;
        })
      : enrichedFillFields;
    if (blockedFields.length > 0) {
      enrichedFillFieldsRef.current = fieldsSnapshot;
      setFillFields((fields) =>
        fields.map((field) => {
          const blocked = blockedFields.find((item) => item.field.id === field.id);
          return blocked
            ? { ...field, status: "需补充资料", confidence: 0, source: "字段定位校验", evidence: blocked.issue, sourceSnippetText: "" }
            : field;
        }),
      );
      window.alert(`有 ${blockedFields.length} 个字段缺少输入点或标注范围不完整，已跳过 AI 填充。`);
    }
    try {
      for (let index = 0; index < runnableFields.length; index += 1) {
        const field = runnableFields[index];
        setBulkFillProgress({ current: index + 1, total: runnableFields.length });
        fieldsSnapshot = await fillFieldWithAI(field.id, fieldsSnapshot, { syncDocument: false, suppressPageSync: true }) || fieldsSnapshot;
      }
      queueFilledOfficeDocumentSync(fieldsSnapshot);
    } finally {
      setFillPreviewPage(preservedFillPreviewPage);
      window.setTimeout(() => {
        if (fillPreviewPageLockRef.current === preservedFillPreviewPage) {
          fillPreviewPageLockRef.current = null;
        }
      }, 2200);
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

  async function updateFillFieldValue(fieldId, value) {
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
    let nextField = appliedField;
    if (appliedField && value.trim()) {
      const writeResult = await requestOnlyOfficeFillField(appliedField);
      nextField = isOnlyOfficeFillFailure(writeResult) ? markOnlyOfficeFillFailure(appliedField, writeResult) : appliedField;
      enrichedFillFieldsRef.current = enrichedFillFieldsRef.current.map((field) => (field.id === fieldId ? nextField : field));
      if (!isOnlyOfficeFillFailure(writeResult)) {
        queueFilledOfficeDocumentSync(enrichedFillFieldsRef.current);
      }
    }
    setFillFields((fields) =>
      fields.map((field) =>
        field.id === fieldId
          ? (nextField || {
              ...field,
              value,
              status: value.trim() ? "待确认" : "未填充",
              confidence: field.confidence || 100,
              source: "人工修改",
              evidence: value.trim() ? "用户对 AI 填充内容进行了人工修改。" : "用户清空了填充内容。",
              sourceSnippetText: "",
            })
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
                placeholderVariables={placeholderVariables}
                placeholderAnchors={placeholderAnchors}
                sidePanelMode={annotateSidePanelMode}
                selectedField={selectedTemplateField}
                selectedFieldId={selectedTemplateFieldId}
                brushActive={brushActive}
                saveState={saveState}
                currentPage={annotatePreviewPage}
                onUploadTemplate={uploadTemplate}
                onSaveTemplate={saveTemplate}
                onPreviewPageChange={setAnnotatePreviewPage}
                onSlotClick={markSlot}
                onSelectField={(fieldId) => {
                  setAnnotateSidePanelMode("fields");
                  setSelectedTemplateFieldId(fieldId);
                }}
                onSidePanelModeChange={setAnnotateSidePanelMode}
                onUpdateField={updateTemplateField}
                onRemoveField={removeTemplateField}
                onAddInputPoint={addInputPointForTemplateField}
                onInputPointCaptured={applyTemplateInputPoint}
                onAddPlaceholderVariable={addPlaceholderVariable}
                onRenamePlaceholderVariable={renamePlaceholderVariable}
                onDeletePlaceholderVariable={removePlaceholderVariable}
                onInsertPlaceholderVariable={insertPlaceholderVariable}
                onJumpPlaceholderAnchor={jumpToPlaceholderAnchor}
                onPlaceholderAnchorsDetected={applyPlaceholderAnchorResult}
                onPlaceholderAnchorInserted={applyPlaceholderAnchorResult}
                onOpenPlaceholderPanel={() => setAnnotateSidePanelMode("placeholders")}
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
                onPreviewPageChange={updateFillPreviewPage}
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


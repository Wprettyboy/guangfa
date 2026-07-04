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
  shouldRestoreDraftState,
  shouldSaveWorkspaceDraft,
  normalizeKnowledgeBaseIds,
} from "./services/templates.js";
import {
  readWorkspaceSession,
  saveWorkspaceSession,
} from "./services/workspaceSession.js";
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
  requestOnlyOfficeAddComplexFillAnchor,
  requestOnlyOfficeDeleteComplexFillAnchor,
  requestOnlyOfficeDeletePlaceholderAnchor,
  requestOnlyOfficeDocumentDownloadAs,
  requestOnlyOfficeDocumentSave,
  requestOnlyOfficeFillField,
  requestOnlyOfficeFillPlaceholderVariable,
  requestOnlyOfficeInsertPlaceholderVariable,
  requestOnlyOfficeSelectComplexFillAnchor,
  requestOnlyOfficeSelectPlaceholderAnchor,
} from "./features/docx/office/bridge.jsx";
import {
  fetchOfficeDocumentBuffer,
  resolveOfficeDocumentBuffer,
  waitForChangedOfficeDocumentBuffer,
} from "./features/docx/office/documentSync.js";
import { getNextFieldNumber } from "./features/docx/fill/FieldControls.jsx";
import {
  applyPlaceholderAnchors,
  buildPlaceholderToken,
  buildPlaceholderFillCards,
  createPlaceholderVariable,
  getNextPlaceholderAnchorIndex,
  normalizePlaceholderName,
  normalizePlaceholderVariables,
  updatePlaceholderAnchorPage,
} from "./features/placeholders/variables.js";
import {
  createEditedPlaceholderFill,
  createManualPlaceholderFill,
  createPlaceholderFillError,
  markPlaceholderFillFailure,
  requestPlaceholderAiFill,
} from "./features/placeholders/fill.js";
import {
  applyComplexFillAnchors,
  buildComplexFillStateFromTemplate,
  createComplexFillAnchorDraft,
  createComplexFillField,
  isComplexFillFieldComplete,
  normalizeComplexFillField,
  normalizeComplexFillFields,
  normalizeComplexFillAnchors,
  updateComplexFillAnchorPage,
} from "./features/complex-fill/anchors.js";
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

const DRAFT_AUTOSAVE_INTERVAL_MS = 6 * 60 * 1000;

export default function App() {
  const [initialSession] = useState(readWorkspaceSession);
  const [activeModule, setActiveModule] = useState(initialSession.activeModule || "workspace");
  const [activeWorkspace, setActiveWorkspace] = useState(initialSession.activeWorkspace || "annotate");
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(initialSession.workspaceNavOpen !== false);
  const [settingsNavOpen, setSettingsNavOpen] = useState(initialSession.settingsNavOpen !== false);
  const [templateFile, setTemplateFile] = useState(initialTemplateFile);
  const [templateFields, setTemplateFields] = useState(initialTemplateFields);
  const [placeholderVariables, setPlaceholderVariables] = useState(() => normalizePlaceholderVariables());
  const [placeholderAnchors, setPlaceholderAnchors] = useState([]);
  const [complexFillFields, setComplexFillFields] = useState([]);
  const [complexFillAnchors, setComplexFillAnchors] = useState([]);
  const [placeholderFills, setPlaceholderFills] = useState({});
  const [annotateSidePanelMode, setAnnotateSidePanelMode] = useState(initialSession.annotateSidePanelMode || "fields");
  const [templateOfficeDocId, setTemplateOfficeDocId] = useState("");
  const [selectedTemplateFieldId, setSelectedTemplateFieldId] = useState(initialSession.selectedTemplateFieldId || initialTemplateFields[0]?.id || "");
  const [brushActive, setBrushActive] = useState(false);
  const [brushType, setBrushType] = useState("填空");
  const [annotatePreviewPage, setAnnotatePreviewPage] = useState(initialSession.annotatePreviewPage || 1);
  const [fillPreviewPage, setFillPreviewPage] = useState(initialSession.fillPreviewPage || 1);
  const [fillOfficeDocId, setFillOfficeDocId] = useState("");
  const [filledTemplateFile, setFilledTemplateFile] = useState(null);
  const [fillFieldPageMap, setFillFieldPageMap] = useState({});
  const [saveState, setSaveState] = useState("idle");
  const [templateLibrary, setTemplateLibrary] = useState([]);
  const [fillFields, setFillFields] = useState(initialFillFields);
  const [materialFiles, setMaterialFiles] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(initialSession.selectedFieldId || "F-002");
  const [citationFieldId, setCitationFieldId] = useState(initialSession.citationFieldId || "F-002");
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
  const draftAutosaveSnapshotRef = useRef(null);
  const placeholderVariablesRef = useRef(placeholderVariables);
  const placeholderAnchorsRef = useRef(placeholderAnchors);
  const complexFillFieldsRef = useRef(complexFillFields);
  const complexFillAnchorsRef = useRef(complexFillAnchors);
  const placeholderFillsRef = useRef(placeholderFills);
  const enrichedFillFields = useMemo(
    () => mergeFillFieldsWithTemplate(fillFields, templateFields),
    [fillFields, templateFields],
  );
  const placeholderFillCards = useMemo(
    () => buildPlaceholderFillCards(placeholderVariables, placeholderAnchors, placeholderFills),
    [placeholderAnchors, placeholderFills, placeholderVariables],
  );
  const placeholderFillCardsRef = useRef(placeholderFillCards);
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
    complexFillFieldsRef.current = complexFillFields;
  }, [complexFillFields]);

  useEffect(() => {
    complexFillAnchorsRef.current = complexFillAnchors;
  }, [complexFillAnchors]);

  useEffect(() => {
    placeholderVariablesRef.current = placeholderVariables;
  }, [placeholderVariables]);

  useEffect(() => {
    placeholderFillsRef.current = placeholderFills;
  }, [placeholderFills]);

  useEffect(() => {
    placeholderFillCardsRef.current = placeholderFillCards;
  }, [placeholderFillCards]);

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
    Promise.all([readStoredTemplates(), readDraftState()]).then(async ([templates, draft]) => {
      const draftToRestore = shouldRestoreDraftState(draft, templates) ? draft : null;
      if (draft && !draftToRestore) await clearDraftState();
      if (cancelled) return;
      setTemplateLibrary(templates);
      if (draftToRestore?.templateFile?.buffer) {
        setTemplateFile(draftToRestore.templateFile);
        setFilledTemplateFile(draftToRestore.filledTemplateFile || null);
        filledTemplateBufferRef.current = draftToRestore.filledTemplateFile?.buffer ? draftToRestore.filledTemplateFile.buffer.slice(0) : null;
        filledTemplateDraftFileRef.current = draftToRestore.filledTemplateFile || null;
        const complexFillState = buildComplexFillStateFromTemplate(draftToRestore);
        setTemplateFields(draftToRestore.templateFields || []);
        setPlaceholderVariables(normalizePlaceholderVariables(draftToRestore.placeholderVariables));
        setPlaceholderAnchors(applyPlaceholderAnchors([], draftToRestore.placeholderAnchors || []));
        setComplexFillFields(complexFillState.fields);
        setComplexFillAnchors(complexFillState.anchors);
        setPlaceholderFills(draftToRestore.placeholderFills || {});
        setFillFields(draftToRestore.fillFields || []);
        setMaterialFiles(draftToRestore.materialFiles || []);
        setSelectedFieldId(draftToRestore.selectedFieldId || draftToRestore.fillFields?.[0]?.id || "");
        setCitationFieldId(draftToRestore.citationFieldId || draftToRestore.fillFields?.[0]?.id || "");
        setSelectedTemplateFieldId(draftToRestore.selectedTemplateFieldId || draftToRestore.templateFields?.[0]?.id || "");
        setAnnotatePreviewPage(draftToRestore.annotatePreviewPage || 1);
        setFillPreviewPage(draftToRestore.fillPreviewPage || 1);
        setAnnotateSidePanelMode(draftToRestore.annotateSidePanelMode || initialSession.annotateSidePanelMode || "fields");
        setSelectedProjectKnowledgeBaseIds(normalizeKnowledgeBaseIds(draftToRestore.selectedProjectKnowledgeBaseIds ?? draftToRestore.selectedProjectKnowledgeBaseId));
        setSelectedGlobalKnowledgeBaseIds(normalizeKnowledgeBaseIds(draftToRestore.selectedGlobalKnowledgeBaseIds ?? draftToRestore.selectedGlobalKnowledgeBaseId));
        setActiveWorkspace(draftToRestore.activeWorkspace || initialSession.activeWorkspace || "fill");
        setActiveModule(draftToRestore.activeModule || initialSession.activeModule || "workspace");
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
    saveWorkspaceSession({
      activeModule,
      activeWorkspace,
      annotateSidePanelMode,
      annotatePreviewPage,
      fillPreviewPage,
      selectedTemplateFieldId,
      selectedFieldId,
      citationFieldId,
      workspaceNavOpen,
      settingsNavOpen,
    });
  }, [
    activeModule,
    activeWorkspace,
    annotatePreviewPage,
    annotateSidePanelMode,
    citationFieldId,
    draftReady,
    fillPreviewPage,
    selectedFieldId,
    selectedTemplateFieldId,
    settingsNavOpen,
    workspaceNavOpen,
  ]);

  useEffect(() => {
    const nextDraftSnapshot = draftReady && templateFile?.buffer
      ? {
          activeWorkspace,
          activeModule,
          annotateSidePanelMode,
          templateFile: getDraftTemplateFile(),
          filledTemplateFile: getDraftFilledTemplateFile(),
          templateFields,
          placeholderVariables,
          placeholderAnchors,
          complexFillFields,
          complexFillAnchors,
          placeholderFills,
          fillFields,
          materialFiles,
          selectedTemplateFieldId,
          selectedFieldId,
          citationFieldId,
          annotatePreviewPage,
          fillPreviewPage,
          selectedProjectKnowledgeBaseIds,
          selectedGlobalKnowledgeBaseIds,
        }
      : null;
    draftAutosaveSnapshotRef.current = shouldSaveWorkspaceDraft(nextDraftSnapshot, templateLibrary) ? nextDraftSnapshot : null;
  }, [
    activeWorkspace,
    activeModule,
    annotateSidePanelMode,
    annotatePreviewPage,
    citationFieldId,
    draftReady,
    fillFields,
    fillPreviewPage,
    materialFiles,
    placeholderVariables,
    placeholderAnchors,
    complexFillFields,
    complexFillAnchors,
    placeholderFills,
    selectedProjectKnowledgeBaseIds,
    selectedGlobalKnowledgeBaseIds,
    selectedTemplateFieldId,
    selectedFieldId,
    templateFields,
    templateFile,
    templateLibrary,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (draftAutosaveSnapshotRef.current) {
        saveDraftState(draftAutosaveSnapshotRef.current);
      }
    }, DRAFT_AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

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
    complexFieldsSnapshot = complexFillFieldsRef.current,
    complexAnchorsSnapshot = complexFillAnchorsRef.current,
  ) {
    if (!sourceOfficeDocId || !templateFile?.buffer) return;
    const officeDocId = sourceOfficeDocId;
    const sourcePreviewId = templateFile.previewId;
    const baselineBuffer = annotatedTemplateBufferRef.current || templateFile.buffer;
    window.clearTimeout(annotateSyncTimerRef.current);
    annotateSyncTimerRef.current = window.setTimeout(async () => {
      try {
        const buffer = await resolveOfficeDocumentBuffer(officeDocId, baselineBuffer, {
          downloadAs: requestOnlyOfficeDocumentDownloadAs,
          requestSave: requestOnlyOfficeDocumentSave,
          saveTrigger: "annotate-sync",
        });
        if (!buffer) return;
        if (templateFileRef.current?.previewId !== sourcePreviewId) return;
        annotatedTemplateBufferRef.current = buffer.slice(0);
        setTemplateFile((file) =>
          file?.buffer && file.previewId === sourcePreviewId ? { ...file, buffer: buffer.slice(0), size: formatFileSize(buffer.byteLength) } : file,
        );
        console.log("[annotate] synced highlighted docx", { id: officeDocId, bytes: buffer.byteLength });
        const nextDraft = {
          activeModule,
          activeWorkspace: "annotate",
          annotateSidePanelMode,
          templateFile: getDraftTemplateFile({ ...templateFile, buffer }),
          templateFields: fieldsSnapshot,
          placeholderVariables: variablesSnapshot,
          placeholderAnchors: anchorsSnapshot,
          complexFillFields: complexFieldsSnapshot,
          complexFillAnchors: complexAnchorsSnapshot,
          placeholderFills: placeholderFillsRef.current,
          fillFields,
          materialFiles,
          selectedTemplateFieldId,
          selectedFieldId,
          citationFieldId,
          annotatePreviewPage,
          fillPreviewPage,
          selectedProjectKnowledgeBaseIds,
          selectedGlobalKnowledgeBaseIds,
        };
        if (shouldSaveWorkspaceDraft(nextDraft, templateLibrary)) {
          await saveDraftState(nextDraft);
        }
      } catch {
        // Annotation persistence is best effort; field creation should stay instant.
      }
    }, 600);
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
          activeModule,
          activeWorkspace: "fill",
          annotateSidePanelMode,
          templateFile: getDraftTemplateFile(),
          filledTemplateFile: filledFile,
          templateFields,
          placeholderVariables: placeholderVariablesRef.current,
          placeholderAnchors: placeholderAnchorsRef.current,
          complexFillFields: complexFillFieldsRef.current,
          complexFillAnchors: complexFillAnchorsRef.current,
          placeholderFills: placeholderFillsRef.current,
          fillFields: fieldsSnapshot,
          materialFiles,
          selectedTemplateFieldId,
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
    draftAutosaveSnapshotRef.current = null;
    annotatedTemplateBufferRef.current = null;
    setTemplateFile(null);
    setTemplateFields([]);
    setPlaceholderVariables(normalizePlaceholderVariables());
    setPlaceholderAnchors([]);
    setComplexFillFields([]);
    setComplexFillAnchors([]);
    setPlaceholderFills({});
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
    await clearDraftState();
    draftAutosaveSnapshotRef.current = null;
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
    setComplexFillFields([]);
    setComplexFillAnchors([]);
    setPlaceholderFills({});
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
    updatePlaceholderDraftSnapshot(nextVariables);
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
    updatePlaceholderDraftSnapshot(nextVariables);
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
    updatePlaceholderDraftSnapshot(nextVariables, nextAnchors);
    setSaveState("dirty");
  }

  function updatePlaceholderDraftSnapshot(nextVariables, nextAnchors = placeholderAnchorsRef.current) {
    placeholderVariablesRef.current = nextVariables;
    placeholderAnchorsRef.current = nextAnchors;
    if (!draftAutosaveSnapshotRef.current) return;
    draftAutosaveSnapshotRef.current = {
      ...draftAutosaveSnapshotRef.current,
      placeholderVariables: nextVariables,
      placeholderAnchors: nextAnchors,
    };
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
      if (result?.ok) {
        applyPlaceholderAnchorResult(result);
        return;
      }
      if (result?.timeout || result?.ok === false) window.alert(result.error || "OnlyOffice 未响应自动字段插入命令，请确认左侧文档已加载完成。");
    });
    setAnnotateSidePanelMode("placeholders");
  }

  function jumpToPlaceholderAnchor(anchor) {
    setAnnotateSidePanelMode("placeholders");
    requestOnlyOfficeSelectPlaceholderAnchor(anchor).then((result) => {
      if (result?.timeout || !result?.ok) {
        window.alert(result?.error || "OnlyOffice 未能定位该自动字段书签。");
        return;
      }
      const page = Math.max(1, Number(result.page || anchor?.page) || 1);
      setAnnotatePreviewPage(page);
      const nextAnchors = updatePlaceholderAnchorPage(placeholderAnchorsRef.current, result.bookmarkName || anchor.bookmarkName, page);
      if (nextAnchors !== placeholderAnchorsRef.current) {
        placeholderAnchorsRef.current = nextAnchors;
        setPlaceholderAnchors(nextAnchors);
        setSaveState("dirty");
      }
    });
  }

  function deletePlaceholderAnchor(anchor) {
    if (!anchor?.bookmarkName) return;
    const nextAnchors = placeholderAnchorsRef.current.filter((item) => item.bookmarkName !== anchor.bookmarkName);
    placeholderAnchorsRef.current = nextAnchors;
    setPlaceholderAnchors(nextAnchors);
    setAnnotateSidePanelMode("placeholders");
    setSaveState("dirty");
    requestOnlyOfficeDeletePlaceholderAnchor(anchor).catch(() => {});
  }

  function applyPlaceholderAnchorResult(result) {
    if (!result?.ok) {
      return;
    }
    const incomingAnchors = result.anchor ? [result.anchor] : result.anchors || [];
    const nextAnchors = applyPlaceholderAnchors(placeholderAnchorsRef.current, incomingAnchors);
    placeholderAnchorsRef.current = nextAnchors;
    setPlaceholderAnchors(nextAnchors);
    setAnnotateSidePanelMode("placeholders");
    setSaveState("dirty");
  }

  function updateComplexFillDraftSnapshot(nextFields = complexFillFieldsRef.current, nextAnchors = complexFillAnchorsRef.current) {
    complexFillFieldsRef.current = nextFields;
    complexFillAnchorsRef.current = nextAnchors;
    if (!draftAutosaveSnapshotRef.current) return;
    draftAutosaveSnapshotRef.current = {
      ...draftAutosaveSnapshotRef.current,
      complexFillFields: nextFields,
      complexFillAnchors: nextAnchors,
    };
  }

  function addComplexFillField() {
    const nextFields = [...complexFillFieldsRef.current, createComplexFillField(complexFillFieldsRef.current)];
    setComplexFillFields(nextFields);
    updateComplexFillDraftSnapshot(nextFields);
    setAnnotateSidePanelMode("complex-fill");
    setSaveState("dirty");
  }

  function updateComplexFillField(fieldId, patch) {
    const nextFields = complexFillFieldsRef.current.map((field, index) =>
      field.id === fieldId ? normalizeComplexFillField({ ...field, ...patch }, index + 1, field) : field,
    );
    setComplexFillFields(nextFields);
    updateComplexFillDraftSnapshot(nextFields);
    setAnnotateSidePanelMode("complex-fill");
    setSaveState("dirty");
  }

  function deleteComplexFillField(fieldId) {
    const anchorCount = complexFillAnchorsRef.current.filter((anchor) => anchor.fieldId === fieldId).length;
    if (anchorCount > 0 && !window.confirm(`该字段已建立 ${anchorCount} 处选区书签。删除后不会删除 Word 中原文，但模板元数据不再管理这些位置。确认删除？`)) {
      return;
    }
    const nextFields = complexFillFieldsRef.current.filter((field) => field.id !== fieldId);
    const nextAnchors = complexFillAnchorsRef.current.filter((anchor) => anchor.fieldId !== fieldId);
    setComplexFillFields(nextFields);
    setComplexFillAnchors(nextAnchors);
    updateComplexFillDraftSnapshot(nextFields, nextAnchors);
    setAnnotateSidePanelMode("complex-fill");
    setSaveState("dirty");
  }

  function createComplexFillAnchor(field) {
    if (!isComplexFillFieldComplete(field)) {
      window.alert("请先在维护字段里填写字段简述、格式要求、内容要求。");
      return;
    }
    const draftAnchor = createComplexFillAnchorDraft(field, complexFillAnchorsRef.current);
    setAnnotateSidePanelMode("complex-fill");
    requestOnlyOfficeAddComplexFillAnchor(draftAnchor).then((result) => {
      if (result?.ok) {
        const nextAnchors = applyComplexFillAnchors(complexFillAnchorsRef.current, [result.anchor || result.item]);
        setComplexFillAnchors(nextAnchors);
        updateComplexFillDraftSnapshot(complexFillFieldsRef.current, nextAnchors);
        setSaveState("dirty");
        return;
      }
      if (result?.timeout || result?.ok === false) window.alert(result.error || "OnlyOffice 未能建立复杂类填充书签，请确认左侧文档已加载并选中文字。");
    });
  }

  function jumpToComplexFillAnchor(anchor) {
    setAnnotateSidePanelMode("complex-fill");
    requestOnlyOfficeSelectComplexFillAnchor(anchor).then((result) => {
      if (result?.timeout || !result?.ok) {
        window.alert(result?.error || "OnlyOffice 未能定位该复杂类填充书签。");
        return;
      }
      const page = Math.max(1, Number(result.page || anchor?.page) || 1);
      setAnnotatePreviewPage(page);
      const nextAnchors = updateComplexFillAnchorPage(complexFillAnchorsRef.current, result.bookmarkName || anchor.bookmarkName, page);
      if (nextAnchors !== complexFillAnchorsRef.current) {
        setComplexFillAnchors(nextAnchors);
        updateComplexFillDraftSnapshot(complexFillFieldsRef.current, nextAnchors);
        setSaveState("dirty");
      }
    });
  }

  async function deleteComplexFillAnchor(anchor) {
    if (!anchor?.bookmarkName) return;
    setAnnotateSidePanelMode("complex-fill");
    const result = await requestOnlyOfficeDeleteComplexFillAnchor(anchor);
    if (result?.timeout || !result?.ok) {
      window.alert(result?.error || "OnlyOffice 未能删除该复杂类填充书签。");
      return;
    }
    const nextAnchors = complexFillAnchorsRef.current.filter((current) => current.bookmarkName !== anchor.bookmarkName);
    setComplexFillAnchors(nextAnchors);
    updateComplexFillDraftSnapshot(complexFillFieldsRef.current, nextAnchors);
    setSaveState("dirty");
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
    setComplexFillFields([]);
    setComplexFillAnchors([]);
    setPlaceholderFills({});
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
    const incompleteComplexFillFields = complexFillFields.filter((field) => !isComplexFillFieldComplete(field));
    const hasPendingFields = templateFields.some((field) => field.status !== "已标注");
    const hasTemplateMarkers = templateFields.length > 0 || placeholderAnchors.length > 0 || complexFillAnchors.length > 0;
    const isComplete = hasTemplateMarkers && invalidFields.length === 0 && setupIssues.length === 0 && incompleteComplexFillFields.length === 0 && !hasPendingFields;

    if (!isComplete) {
      setSaveState("incomplete");
      if (setupIssues.length > 0) {
        window.alert(`有 ${setupIssues.length} 个字段缺少稳定写入位置：\n${setupIssues.slice(0, 6).map(({ field, issue }) => `- ${getTemplateFieldSourceText(field) || field.name || field.id}：${issue}`).join("\n")}`);
      } else if (incompleteComplexFillFields.length > 0) {
        window.alert(`有 ${incompleteComplexFillFields.length} 个复杂类填充字段未完善：\n${incompleteComplexFillFields.slice(0, 6).map((field) => `- ${field.fieldSummary || field.id}：请填写字段简述、格式要求、内容要求`).join("\n")}`);
      }
      return;
    }

    setSaveState("saving");
    let fileBuffer = (annotatedTemplateBufferRef.current || templateFile.buffer).slice(0);
    if (templateOfficeDocId) {
      try {
        const officeBuffer = await resolveOfficeDocumentBuffer(templateOfficeDocId, fileBuffer, {
          downloadAs: requestOnlyOfficeDocumentDownloadAs,
          requestSave: requestOnlyOfficeDocumentSave,
          saveTrigger: "save-template",
        });
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
    const normalizedComplexFillFields = normalizeComplexFillFields(complexFillFields);
    const normalizedComplexFillAnchors = normalizeComplexFillAnchors(complexFillAnchors);

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
      complexFillFields: normalizedComplexFillFields,
      complexFillAnchors: normalizedComplexFillAnchors,
      fileBuffer,
    };

    try {
      const currentTemplates = await readStoredTemplates();
      const nextTemplates = [savedTemplate, ...currentTemplates.filter((item) => item.fileName !== templateFile.name)];
      await storeTemplates(nextTemplates);
      setTemplateLibrary(nextTemplates);
    } catch {
      setSaveState("storage-error");
      return;
    }

    setTemplateFields(normalizedTemplateFields);
    setComplexFillFields(normalizedComplexFillFields);
    setComplexFillAnchors(normalizedComplexFillAnchors);
    complexFillFieldsRef.current = normalizedComplexFillFields;
    complexFillAnchorsRef.current = normalizedComplexFillAnchors;
    setFillFields(createFillFieldsFromTemplate(normalizedTemplateFields, fillFields));
    setSelectedFieldId(normalizedTemplateFields[0]?.id ?? "");
    setCitationFieldId(normalizedTemplateFields[0]?.id ?? "");
    await saveDraftState({
      activeModule,
      activeWorkspace: "annotate",
      annotateSidePanelMode,
      templateFile: getDraftTemplateFile({ ...templateFile, buffer: fileBuffer, size: formatFileSize(fileBuffer.byteLength) }),
      templateFields: normalizedTemplateFields,
      placeholderVariables,
      placeholderAnchors,
      complexFillFields: normalizedComplexFillFields,
      complexFillAnchors: normalizedComplexFillAnchors,
      placeholderFills,
      fillFields,
      materialFiles,
      selectedTemplateFieldId,
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
    await clearDraftState();
    draftAutosaveSnapshotRef.current = null;
    const storedTemplate = await readStoredTemplate(template.id);
    const templateToUse = storedTemplate ?? template;
    const templateFieldsToUse = (templateToUse.fields || []).map(normalizeTemplateFieldForRuntime);
    const complexFillState = buildComplexFillStateFromTemplate(templateToUse);
    const mappedFields = createFillFieldsFromTemplate(templateFieldsToUse);
    setTemplateFields(templateFieldsToUse);
    setPlaceholderVariables(normalizePlaceholderVariables(templateToUse.placeholderVariables));
    setPlaceholderAnchors(applyPlaceholderAnchors([], templateToUse.placeholderAnchors || []));
    setComplexFillFields(complexFillState.fields);
    setComplexFillAnchors(complexFillState.anchors);
    setPlaceholderFills({});
    clearFilledTemplateDraft();
    if (templateToUse.fileBuffer) {
      annotatedTemplateBufferRef.current = null;
      setTemplateFile({
        previewId: createPreviewId("template"),
        sourceTemplateId: templateToUse.id,
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
      setComplexFillFields([]);
      setComplexFillAnchors([]);
      setPlaceholderFills({});
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
    await clearDraftState();
    draftAutosaveSnapshotRef.current = null;
    const storedTemplate = await readStoredTemplate(template.id);
    const templateToEdit = storedTemplate ?? template;
    const fields = (templateToEdit.fields || []).map(normalizeTemplateFieldForRuntime);
    const complexFillState = buildComplexFillStateFromTemplate(templateToEdit);
    setTemplateFields(fields);
    setPlaceholderVariables(normalizePlaceholderVariables(templateToEdit.placeholderVariables));
    setPlaceholderAnchors(applyPlaceholderAnchors([], templateToEdit.placeholderAnchors || []));
    setComplexFillFields(complexFillState.fields);
    setComplexFillAnchors(complexFillState.anchors);
    setPlaceholderFills({});
    clearFilledTemplateDraft();
    setFillFieldPageMap({});
    if (templateToEdit.fileBuffer) {
      annotatedTemplateBufferRef.current = null;
      setTemplateFile({
        previewId: createPreviewId("template"),
        sourceTemplateId: templateToEdit.id,
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
      setComplexFillFields([]);
      setComplexFillAnchors([]);
      setPlaceholderFills({});
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

  function setPlaceholderFill(variableId, fill) {
    setPlaceholderFills((fills) => {
      const nextFills = {
        ...fills,
        [variableId]: {
          ...(fills[variableId] || {}),
          ...fill,
        },
      };
      placeholderFillsRef.current = nextFills;
      return nextFills;
    });
  }

  async function fillPlaceholderWithAI(variableId) {
    const card = placeholderFillCardsRef.current.find((item) => item.id === variableId);
    if (!card) return;
    setPlaceholderFill(variableId, { status: "生成中" });
    try {
      const appliedFill = await requestPlaceholderAiFill(card, {
        materials: materialFiles,
        knowledgeOptions: {
          enabled: selectedProjectKnowledgeBaseIds.length > 0,
          projectId: currentProjectId,
          kbIds: [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds],
          topK: knowledgeTopK,
        },
      });
      let nextFill = appliedFill;
      if (appliedFill.value.trim()) {
        const writeResult = await requestOnlyOfficeFillPlaceholderVariable({
          ...card,
          value: appliedFill.value,
        });
        if (writeResult?.ok === false) nextFill = markPlaceholderFillFailure(appliedFill, writeResult);
      }
      setPlaceholderFill(variableId, nextFill);
    } catch (error) {
      setPlaceholderFill(variableId, createPlaceholderFillError(error, placeholderFillsRef.current[variableId]?.value || ""));
    }
  }

  async function applyPlaceholderFillValue(variableId) {
    const card = placeholderFillCardsRef.current.find((item) => item.id === variableId);
    const currentFill = placeholderFillsRef.current[variableId] || {};
    const value = String(currentFill.value || "").trim();
    if (!card || !value) return;
    setPlaceholderFill(variableId, { status: "生成中" });
    const writeResult = await requestOnlyOfficeFillPlaceholderVariable({ ...card, value });
    setPlaceholderFill(
      variableId,
      writeResult?.ok === false
        ? markPlaceholderFillFailure({ ...currentFill, value }, writeResult)
        : createManualPlaceholderFill(value, currentFill),
    );
  }

  function updatePlaceholderFillValue(variableId, value) {
    setPlaceholderFill(variableId, createEditedPlaceholderFill(value));
  }

  async function generateAllPlaceholderFills() {
    const pendingCards = placeholderFillCardsRef.current.filter((card) => card.status !== "已确认" && card.status !== "生成中");
    if (pendingCards.length === 0 || generatingAll) return;
    setGeneratingAll(true);
    setBulkFillProgress({ current: 0, total: pendingCards.length });
    try {
      for (let index = 0; index < pendingCards.length; index += 1) {
        setBulkFillProgress({ current: index + 1, total: pendingCards.length });
        await fillPlaceholderWithAI(pendingCards[index].id);
      }
    } finally {
      setGeneratingAll(false);
      setBulkFillProgress({ current: 0, total: 0 });
    }
  }

  function jumpToPlaceholderFillAnchor(anchor) {
    requestOnlyOfficeSelectPlaceholderAnchor(anchor).then((result) => {
      if (result?.timeout || !result?.ok) {
        window.alert(result?.error || "OnlyOffice 未能定位该自动字段书签。");
        return;
      }
      const page = Math.max(1, Number(result.page || anchor?.page) || 1);
      setFillPreviewPage(page);
      const nextAnchors = updatePlaceholderAnchorPage(placeholderAnchorsRef.current, result.bookmarkName || anchor.bookmarkName, page);
      if (nextAnchors !== placeholderAnchorsRef.current) {
        placeholderAnchorsRef.current = nextAnchors;
        setPlaceholderAnchors(nextAnchors);
      }
    });
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
                complexFillFields={complexFillFields}
                complexFillAnchors={complexFillAnchors}
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
                onUpdateField={updateTemplateField}
                onRemoveField={removeTemplateField}
                onAddInputPoint={addInputPointForTemplateField}
                onInputPointCaptured={applyTemplateInputPoint}
                onAddPlaceholderVariable={addPlaceholderVariable}
                onRenamePlaceholderVariable={renamePlaceholderVariable}
                onDeletePlaceholderVariable={removePlaceholderVariable}
                onInsertPlaceholderVariable={insertPlaceholderVariable}
                onJumpPlaceholderAnchor={jumpToPlaceholderAnchor}
                onDeletePlaceholderAnchor={deletePlaceholderAnchor}
                onOpenPlaceholderPanel={() => setAnnotateSidePanelMode("placeholders")}
                onOpenComplexFillPanel={() => setAnnotateSidePanelMode("complex-fill")}
                onAddComplexFillField={addComplexFillField}
                onUpdateComplexFillField={updateComplexFillField}
                onDeleteComplexFillField={deleteComplexFillField}
                onCreateComplexFillAnchor={createComplexFillAnchor}
                onJumpComplexFillAnchor={jumpToComplexFillAnchor}
                onDeleteComplexFillAnchor={deleteComplexFillAnchor}
                onOfficeDocumentReady={setTemplateOfficeDocId}
              />
            ) : (
              <FillWorkspace
                fields={enrichedFillFields}
                placeholderCards={placeholderFillCards}
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
                onGeneratePlaceholder={fillPlaceholderWithAI}
                onGenerateAllPlaceholders={generateAllPlaceholderFills}
                onUpdatePlaceholderValue={updatePlaceholderFillValue}
                onApplyPlaceholderValue={applyPlaceholderFillValue}
                onJumpPlaceholderAnchor={jumpToPlaceholderFillAnchor}
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


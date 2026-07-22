import React, { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FillCommonToolbar from "../features/docx/fill/FillCommonToolbar.jsx";
import OtherFieldFillPanel from "../features/docx/fill/OtherFieldFillPanel.jsx";
import { exportFilledDocx } from "../features/docx/fill/docxXmlFill.js";
import { requestOnlyOfficeDocumentDownloadAs } from "../features/docx/office/bridge.jsx";
import { fetchOfficeDocumentBuffer } from "../features/docx/office/documentSync.js";
import { DocumentFrame } from "../features/docx/runtime.jsx";
import ComplexFillCards from "../features/complex-fill/ComplexFillCards.jsx";
import PlaceholderFillCards from "../features/placeholders/PlaceholderFillCards.jsx";
import { FillWorkspaceProvider } from "../features/fill/FillWorkspaceContext.jsx";
import { useFillWorkspaceViewModel } from "../features/fill/useFillWorkspaceViewModel.js";
import { buildExportFileName, downloadDocxBuffer } from "../utils/files.js";

function FillWorkspace({
  fields,
  placeholderCards = [],
  complexFillCards = [],
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
  onGeneratePlaceholder,
  onGenerateAllPlaceholders,
  onUpdatePlaceholderValue,
  onApplyPlaceholderValue,
  onJumpPlaceholderAnchor,
  onGenerateComplexFill,
  onGenerateAllComplexFills,
  onUpdateComplexFillValue,
  onApplyComplexFillValue,
  onJumpComplexFillAnchor,
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
  onCancelGeneration,
}) {
  const materialInputRef = useRef(null);
  const materialUploadModeRef = useRef("temporary");
  const [exportState, setExportState] = useState("idle");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [trackRevisionsEnabled, setTrackRevisionsEnabled] = useState(false);
  const [uploadState, setUploadState] = useState("idle");
  const baseTemplateFile = sourceTemplateFile || templateFile;
  const activeTemplateName = baseTemplateFile?.name ?? "未选择模板";
  const editorReady = Boolean(officeDocId);
  const workspaceModel = useFillWorkspaceViewModel({ fields, placeholderCards, complexFillCards, currentPage, fieldPageMap, generatingAll, editorReady });
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
        const liveBuffer = await requestOnlyOfficeDocumentDownloadAs("docx", 15000);
        if (liveBuffer) {
          downloadDocxBuffer(liveBuffer, buildExportFileName(baseTemplateFile.name));
          setExportState("done");
          return;
        }
        const serverBuffer = await fetchOfficeDocumentBuffer(officeDocId);
        if (serverBuffer) {
          downloadDocxBuffer(serverBuffer, buildExportFileName(baseTemplateFile.name));
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

  function generateAllCurrentType() {
    if (workspaceModel.activeFillType === "auto") {
      onGenerateAllPlaceholders?.();
      return;
    }
    if (workspaceModel.activeFillType === "complex") {
      onGenerateAllComplexFills?.();
      return;
    }
    onGenerateAll?.();
  }

  const fillState = useMemo(() => ({
    fields,
    placeholderCards,
    complexFillCards,
    currentPage,
    fieldPageMap,
    selectedFieldId,
    generatingAll: generatingAll || !editorReady,
  }), [complexFillCards, currentPage, editorReady, fieldPageMap, fields, generatingAll, placeholderCards, selectedFieldId]);
  const fillActions = useMemo(() => ({
    onSelectField,
    onGenerate,
    onGeneratePlaceholder,
    onUpdatePlaceholderValue,
    onApplyPlaceholderValue,
    onJumpPlaceholderAnchor,
    onGenerateComplexFill,
    onUpdateComplexFillValue,
    onApplyComplexFillValue,
    onJumpComplexFillAnchor,
    onUpdateValue,
    onConfirm,
  }), [onApplyComplexFillValue, onApplyPlaceholderValue, onConfirm, onGenerate, onGenerateComplexFill, onGeneratePlaceholder, onJumpComplexFillAnchor, onJumpPlaceholderAnchor, onSelectField, onUpdateComplexFillValue, onUpdatePlaceholderValue, onUpdateValue]);

  return (
    <FillWorkspaceProvider state={fillState} actions={fillActions}>
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
          trackRevisionsEnabled={trackRevisionsEnabled}
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
          <FillCommonToolbar
            activeTemplateName={activeTemplateName}
            currentPageCount={workspaceModel.currentPageCount}
            materialFiles={materialFiles}
            materialsOpen={materialsOpen}
            uploadState={uploadState}
            onToggleMaterialsOpen={() => setMaterialsOpen((open) => !open)}
            onOpenMaterialPicker={openMaterialPicker}
            onRemoveMaterial={onRemoveMaterial}
            onGenerateAll={generateAllCurrentType}
            generateAllDisabled={workspaceModel.bulkDisabled}
            generateAllLabel={workspaceModel.generateAllLabel}
            generatingAll={generatingAll}
            bulkProgressText={bulkProgressText}
            onCancelGeneration={onCancelGeneration}
            onExportDocx={handleExportDocx}
            exportState={exportState}
            canExport={Boolean(baseTemplateFile?.buffer)}
            trackRevisionsEnabled={trackRevisionsEnabled}
            onToggleTrackRevisions={() => setTrackRevisionsEnabled((enabled) => !enabled)}
            knowledgeBases={knowledgeBases}
            selectedProjectKnowledgeBaseIds={selectedProjectKnowledgeBaseIds}
            selectedGlobalKnowledgeBaseIds={selectedGlobalKnowledgeBaseIds}
            knowledgeTopK={knowledgeTopK}
            onSelectedProjectKnowledgeBaseChange={onSelectedProjectKnowledgeBaseChange}
            onSelectedGlobalKnowledgeBaseChange={onSelectedGlobalKnowledgeBaseChange}
            onKnowledgeTopKChange={onKnowledgeTopKChange}
          />
          <div className="fill-type-tabs" role="tablist" aria-label="填充类型">
            {workspaceModel.tabItems.map((item) => (
              <button
                className={workspaceModel.activeFillType === item.id ? "fill-type-tab active" : "fill-type-tab"}
                type="button"
                role="tab"
                aria-selected={workspaceModel.activeFillType === item.id}
                key={item.id}
                onClick={() => workspaceModel.setActiveFillType(item.id)}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>
          <div className="fill-panel-content">
            {workspaceModel.activeFillType === "auto" ? (
              <PlaceholderFillCards />
            ) : workspaceModel.activeFillType === "complex" ? (
              <ComplexFillCards />
            ) : (
              <OtherFieldFillPanel />
            )}
          </div>
        </div>
      </aside>
      </div>
    </FillWorkspaceProvider>
  );
}

export default FillWorkspace;

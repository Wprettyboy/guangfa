import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FillCommonToolbar from "../features/docx/fill/FillCommonToolbar.jsx";
import OtherFieldFillPanel from "../features/docx/fill/OtherFieldFillPanel.jsx";
import { exportFilledDocx } from "../features/docx/fill/docxXmlFill.js";
import { requestOnlyOfficeDocumentDownloadAs } from "../features/docx/office/bridge.jsx";
import { DocumentFrame, getFillFieldDisplayPage } from "../features/docx/runtime.jsx";
import PlaceholderFillCards from "../features/placeholders/PlaceholderFillCards.jsx";
import { buildExportFileName, downloadDocxBuffer } from "../utils/files.js";

function FillWorkspace({
  fields,
  placeholderCards = [],
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
  const [trackRevisionsEnabled, setTrackRevisionsEnabled] = useState(true);
  const [uploadState, setUploadState] = useState("idle");
  const [activeFillType, setActiveFillType] = useState("auto");
  const baseTemplateFile = sourceTemplateFile || templateFile;
  const hasDynamicFieldPages = Object.keys(fieldPageMap || {}).length > 0;
  const pageFields = fields.filter((field) => getFillFieldDisplayPage(field, fieldPageMap, hasDynamicFieldPages) === currentPage);
  const currentPagePlaceholderCount = placeholderCards.reduce(
    (count, card) => count + card.anchors.filter((anchor) => Number(anchor.page) === Number(currentPage)).length,
    0,
  );
  const activeTemplateName = baseTemplateFile?.name ?? "未选择模板";
  const fillableCount = fields.filter((field) => field.status !== "已确认" && field.status !== "生成中").length;
  const placeholderFillableCount = placeholderCards.filter((card) => card.status !== "已确认" && card.status !== "生成中").length;
  const activeFillableCount = activeFillType === "auto" ? placeholderFillableCount : fillableCount;
  const bulkProgressText = generatingAll && bulkFillProgress?.total
    ? `${bulkFillProgress.current}/${bulkFillProgress.total}`
    : "";
  const currentPageCount = activeFillType === "auto" ? currentPagePlaceholderCount : pageFields.length;
  const generateAllLabel = `一键填充${activeFillableCount > 0 ? ` ${activeFillableCount}` : ""}`;

  useEffect(() => {
    if (activeFillType === "auto" && placeholderCards.length === 0 && fields.length > 0) setActiveFillType("other");
    if (activeFillType === "other" && fields.length === 0 && placeholderCards.length > 0) setActiveFillType("auto");
  }, [activeFillType, fields.length, placeholderCards.length]);

  const tabItems = useMemo(
    () => [
      { id: "auto", label: "自动字段填充", count: placeholderCards.length },
      { id: "other", label: "其他类型填充", count: fields.length },
    ],
    [fields.length, placeholderCards.length],
  );

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

  function generateAllCurrentType() {
    if (activeFillType === "auto") {
      onGenerateAllPlaceholders?.();
      return;
    }
    onGenerateAll?.();
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
            currentPageCount={currentPageCount}
            materialFiles={materialFiles}
            materialsOpen={materialsOpen}
            uploadState={uploadState}
            onToggleMaterialsOpen={() => setMaterialsOpen((open) => !open)}
            onOpenMaterialPicker={openMaterialPicker}
            onRemoveMaterial={onRemoveMaterial}
            onGenerateAll={generateAllCurrentType}
            generateAllDisabled={generatingAll || activeFillableCount === 0}
            generateAllLabel={generateAllLabel}
            generatingAll={generatingAll}
            bulkProgressText={bulkProgressText}
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
            {tabItems.map((item) => (
              <button
                className={activeFillType === item.id ? "fill-type-tab active" : "fill-type-tab"}
                type="button"
                role="tab"
                aria-selected={activeFillType === item.id}
                key={item.id}
                onClick={() => setActiveFillType(item.id)}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>
          <div className="fill-panel-content">
            {activeFillType === "auto" ? (
              <PlaceholderFillCards
                cards={placeholderCards}
                currentPage={currentPage}
                generatingAll={generatingAll}
                onGenerate={onGeneratePlaceholder}
                onUpdateValue={onUpdatePlaceholderValue}
                onApplyValue={onApplyPlaceholderValue}
                onJumpAnchor={onJumpPlaceholderAnchor}
              />
            ) : (
              <OtherFieldFillPanel
                fields={fields}
                currentPage={currentPage}
                fieldPageMap={fieldPageMap}
                selectedFieldId={selectedFieldId}
                onSelectField={onSelectField}
                onGenerate={onGenerate}
                generateDisabled={generatingAll}
                onUpdateValue={onUpdateValue}
                onConfirm={onConfirm}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default FillWorkspace;

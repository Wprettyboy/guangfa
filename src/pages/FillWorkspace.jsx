import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Database, Download, FileText, FolderOpen, Info, Loader2, Upload, Wand2, X } from "lucide-react";
import { FillFieldRow } from "../features/docx/fill/FieldControls.jsx";
import { DocumentFrame, exportFilledDocx, getFillFieldDisplayPage } from "../features/docx/runtime.jsx";
import { buildExportFileName, downloadDocxBuffer, getExportStatusText } from "../utils/files.js";

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

export default FillWorkspace;

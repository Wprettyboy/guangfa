import React, { useEffect, useRef } from "react";
import { Ban, ChevronDown, Database, Download, FileText, FolderOpen, Loader2, PenLine, Upload, Wand2, X } from "lucide-react";
import { getExportStatusText } from "../../../utils/files.js";

function MultiKnowledgeSelect({ label, emptyLabel, bases, selectedIds, onChange, disabled }) {
  const detailsRef = useRef(null);
  const selectedBases = bases.filter((base) => selectedIds.includes(base.id));
  const text = selectedBases.length
    ? `${label}：${selectedBases.length === 1 ? selectedBases[0].name : `${selectedBases.length}个已选`}`
    : emptyLabel;

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  useEffect(() => {
    function closeOnOutsidePointer(event) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target)) details.open = false;
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  return (
    <details className="knowledge-multi-select" ref={detailsRef}>
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

function FillCommonToolbar({
  activeTemplateName,
  currentPageCount,
  materialFiles,
  materialsOpen,
  uploadState,
  onToggleMaterialsOpen,
  onOpenMaterialPicker,
  onRemoveMaterial,
  onGenerateAll,
  generateAllDisabled,
  generateAllLabel,
  generatingAll,
  bulkProgressText,
  onCancelGeneration,
  onExportDocx,
  exportState,
  canExport,
  trackRevisionsEnabled,
  onToggleTrackRevisions,
  knowledgeBases,
  selectedProjectKnowledgeBaseIds,
  selectedGlobalKnowledgeBaseIds,
  knowledgeTopK,
  onSelectedProjectKnowledgeBaseChange,
  onSelectedGlobalKnowledgeBaseChange,
  onKnowledgeTopKChange,
}) {
  const projectKnowledgeBases = knowledgeBases.filter((base) => base.scope !== "global");
  const globalKnowledgeBases = knowledgeBases.filter((base) => base.scope === "global" && (base.documentCount || 0) > 0);
  const anyKnowledgeSelected = selectedProjectKnowledgeBaseIds.length > 0 || selectedGlobalKnowledgeBaseIds.length > 0;
  const progressText = generatingAll && bulkProgressText ? ` ${bulkProgressText}` : "";

  return (
    <>
      <div className="panel-title align-top">
        <div>
          <div className="fill-heading-line">
            <h2>填充项</h2>
            <button
              className={trackRevisionsEnabled ? "revision-toggle is-on" : "revision-toggle"}
              type="button"
              onClick={onToggleTrackRevisions}
              title={trackRevisionsEnabled ? "关闭修订模式" : "开启修订模式"}
            >
              <PenLine size={14} />
              {trackRevisionsEnabled ? "关闭修订模式" : "开启修订模式"}
            </button>
          </div>
          <p>{activeTemplateName}</p>
        </div>
        <div className="fill-title-actions">
          <span className="soft-count">当前页 {currentPageCount} 项</span>
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
            <button className="tool-button" type="button" onClick={() => onOpenMaterialPicker("temporary")} disabled={uploadState === "indexing"}>
              <Upload size={17} />
              上传资料{materialFiles.length > 0 ? ` ${materialFiles.length}` : ""}
            </button>
            <button
              className={materialsOpen ? "icon-button quiet is-active" : "icon-button quiet"}
              type="button"
              aria-label="查看已上传资料"
              onClick={onToggleMaterialsOpen}
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
                <button type="button" onClick={() => onOpenMaterialPicker("temporary")} disabled={uploadState === "indexing"}>
                  <Upload size={15} />
                  仅本次使用
                </button>
                <button type="button" onClick={() => onOpenMaterialPicker("knowledge")} disabled={uploadState === "indexing"}>
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
        <button className="tool-button blue-action" type="button" onClick={onGenerateAll} disabled={generateAllDisabled}>
          {generatingAll ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} />}
          {generatingAll ? `一键填充${progressText}` : generateAllLabel}
        </button>
        {generatingAll ? (
          <button className="icon-button quiet" type="button" onClick={onCancelGeneration} aria-label="取消填充" title="取消填充">
            <Ban size={17} />
          </button>
        ) : null}
        <button className="tool-button solid" type="button" onClick={onExportDocx} disabled={!canExport || exportState === "exporting"}>
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
        />
      </div>
    </>
  );
}

export default FillCommonToolbar;

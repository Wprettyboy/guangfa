import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Bold, ChevronDown, ChevronRight, Highlighter, Italic, List, Loader2, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import StatusPill from "../components/StatusPill.jsx";
import { templateCategories } from "../constants/templates.js";
import ComplexFillPanel from "../features/complex-fill/ComplexFillPanel.jsx";
import { FieldForm } from "../features/docx/fill/FieldControls.jsx";
import { DocumentFrame } from "../features/docx/runtime.jsx";
import { comparePlaceholderAnchors, labelPlaceholderAnchorPages } from "../features/placeholders/variables.js";
import { getFillModeLabel, getTemplateFieldSourceText, normalizeFieldCategory, normalizeFillMode } from "../utils/fields.js";
import { inferTemplateCategory, normalizeTemplateCategory } from "../utils/templates.js";

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
  onAddPlaceholderVariable,
  onRenamePlaceholderVariable,
  onUpdatePlaceholderVariable,
  onDeletePlaceholderVariable,
  onInsertPlaceholderVariable,
  onJumpPlaceholderAnchor,
  onDeletePlaceholderAnchor,
  onOpenPlaceholderPanel,
  onOpenComplexFillPanel,
  onAddComplexFillField,
  onUpdateComplexFillField,
  onDeleteComplexFillField,
  onCreateComplexFillAnchor,
  onJumpComplexFillAnchor,
  onDeleteComplexFillAnchor,
  onOfficeDocumentReady,
  placeholderVariables = [],
  placeholderAnchors = [],
  complexFillFields = [],
  complexFillAnchors = [],
  sidePanelMode = "fields",
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

  const showPlaceholderPanel = sidePanelMode === "placeholders";
  const showComplexFillPanel = sidePanelMode === "complex-fill";

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
          onOpenPlaceholderPanel={onOpenPlaceholderPanel}
          onOpenComplexFillPanel={onOpenComplexFillPanel}
          onOfficeDocumentReady={onOfficeDocumentReady}
        />
      </section>

      <aside className="right-panel field-panel" ref={panelRef}>
        {showComplexFillPanel ? (
          <ComplexFillPanel
            fields={complexFillFields}
            anchors={complexFillAnchors}
            saveState={saveState}
            templateCategory={templateCategory}
            onTemplateCategoryChange={setTemplateCategory}
            onAddField={onAddComplexFillField}
            onUpdateField={onUpdateComplexFillField}
            onDeleteField={onDeleteComplexFillField}
            onCreateAnchor={onCreateComplexFillAnchor}
            onJumpAnchor={onJumpComplexFillAnchor}
            onDeleteAnchor={onDeleteComplexFillAnchor}
            onSaveTemplate={onSaveTemplate}
          />
        ) : showPlaceholderPanel ? (
          <PlaceholderPanel
            variables={placeholderVariables}
            anchors={placeholderAnchors}
            saveState={saveState}
            templateCategory={templateCategory}
            onTemplateCategoryChange={setTemplateCategory}
            onAddVariable={onAddPlaceholderVariable}
            onRenameVariable={onRenamePlaceholderVariable}
            onUpdateVariable={onUpdatePlaceholderVariable}
            onDeleteVariable={onDeletePlaceholderVariable}
            onInsertVariable={onInsertPlaceholderVariable}
            onJumpAnchor={onJumpPlaceholderAnchor}
            onDeleteAnchor={onDeletePlaceholderAnchor}
            onSaveTemplate={onSaveTemplate}
          />
        ) : (
          <>
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
          </>
        )}
      </aside>
    </div>
  );
}

function PlaceholderPanel({
  variables,
  anchors,
  saveState,
  templateCategory,
  onTemplateCategoryChange,
  onAddVariable,
  onRenameVariable,
  onDeleteVariable,
  onInsertVariable,
  onJumpAnchor,
  onDeleteAnchor,
  onSaveTemplate,
}) {
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [collapsedVariables, setCollapsedVariables] = useState({});

  function toggleVariable(variableId) {
    setCollapsedVariables((current) => ({
      ...current,
      [variableId]: !(current[variableId] ?? false),
    }));
  }

  return (
    <div className="panel-section placeholder-panel-section standalone">
      <div className="panel-title">
        <h2>自动字段设置</h2>
        <div className="panel-actions">
          <span className="soft-count">字段 {variables.length} 个</span>
          <button className="text-button" type="button" onClick={() => setMaintenanceOpen(true)}>
            <Settings2 size={14} />
            维护字段
          </button>
          <div className="template-save-actions">
            <select value={templateCategory} onChange={(event) => onTemplateCategoryChange?.(event.target.value)} disabled={saveState === "saving"}>
              {templateCategories.filter((category) => category !== "全部").map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <button className="text-button" type="button" onClick={() => onSaveTemplate?.(templateCategory)} disabled={saveState === "saving"}>
              {saveState === "saving" ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              {saveState === "saving" ? "保存中" : "保存模板"}
            </button>
          </div>
        </div>
      </div>
      <div className="placeholder-summary">
        <strong>字段变量</strong>
        <span>已插入总数 {anchors.length} 处</span>
      </div>
      <div className="placeholder-variable-list">
        {variables.length === 0 ? (
          <div className="empty-state compact">
            <Highlighter size={16} />
            <span>暂无字段变量，请先维护字段</span>
          </div>
        ) : variables.map((variable) => {
          const variableAnchors = anchors.filter((anchor) => anchor.variableId === variable.id).sort(comparePlaceholderAnchors);
          const anchorRows = labelPlaceholderAnchorPages(variableAnchors);
          const expanded = collapsedVariables[variable.id] !== true;
          const listId = `placeholder-anchor-list-${variable.id}`;
          return (
            <article className="placeholder-variable-card" key={variable.id}>
              <div className="placeholder-card-header">
                <strong title={variable.name}>{variable.name}</strong>
                <button className="placeholder-insert-button" type="button" onClick={() => onInsertVariable?.(variable)} title={`插入 ${variable.token}`}>
                  <Plus size={14} />
                  插入字段
                </button>
              </div>
              <button
                className="placeholder-card-toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => toggleVariable(variable.id)}
              >
                <span>已插入总数 {variableAnchors.length}</span>
                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {expanded ? (
                <div className="placeholder-card-anchor-list" id={listId}>
                  {anchorRows.length === 0 ? (
                    <div className="placeholder-card-empty">暂无插入位置</div>
                  ) : (
                    <>
                      <div className="placeholder-anchor-head">
                        <span>序号</span>
                        <span>页面</span>
                        <span>操作</span>
                      </div>
                      {anchorRows.map((anchor, index) => (
                        <div className="placeholder-anchor-row" key={anchor.bookmarkName || anchor.id}>
                          <span className="row-index">{index + 1}</span>
                          <button className="placeholder-page-link" type="button" onClick={() => onJumpAnchor?.(anchor)}>
                            {anchor.pageLabel}
                          </button>
                          <button className="placeholder-anchor-delete icon-button quiet" type="button" aria-label={`删除${anchor.pageLabel}位置`} onClick={() => onDeleteAnchor?.(anchor)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {maintenanceOpen ? (
        <PlaceholderMaintenanceModal
          variables={variables}
          anchors={anchors}
          onAddVariable={onAddVariable}
          onRenameVariable={onRenameVariable}
          onDeleteVariable={onDeleteVariable}
          onClose={() => setMaintenanceOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PlaceholderMaintenanceModal({ variables, anchors, onAddVariable, onRenameVariable, onUpdateVariable, onDeleteVariable, onClose }) {
  const [expandedPromptId, setExpandedPromptId] = useState("");

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="placeholder-maintenance-modal" role="dialog" aria-modal="true" aria-label="自动字段维护" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>自动字段维护</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="placeholder-maintenance-body">
          <div className="placeholder-maintenance-toolbar">
            <button className="placeholder-add-button" type="button" onClick={onAddVariable}>
              <Plus size={15} />
              新增字段
            </button>
            <span>共 {variables.length} 个字段</span>
          </div>
          <div className="placeholder-maintenance-list">
            {variables.length === 0 ? (
              <div className="empty-state compact">
                <Highlighter size={16} />
                <span>暂无字段变量</span>
              </div>
            ) : variables.map((variable) => (
                <div className="placeholder-maintenance-row" key={variable.id}>
                  <label>
                    <span>字段名称</span>
                    <input value={variable.name} onChange={(event) => onRenameVariable?.(variable.id, event.target.value)} />
                  </label>
                  <label className="placeholder-prompt-field">
                    <span>提示词</span>
                    <RichPromptEditor
                      value={variable.prompt || ""}
                      expanded={expandedPromptId === variable.id}
                      onExpand={() => setExpandedPromptId(variable.id)}
                      onChange={(prompt) => onUpdateVariable?.(variable.id, { prompt })}
                    />
                  </label>
                  <button className="icon-button quiet" type="button" aria-label={`删除${variable.name || "字段"}`} onClick={() => onDeleteVariable?.(variable.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="tool-button primary" type="button" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function sanitizePromptHtml(html) {
  const value = String(html || "").trim();
  if (!value) return "";
  const container = document.createElement("div");
  container.innerHTML = value;
  const allowedTags = new Set(["B", "BR", "DIV", "EM", "I", "LI", "OL", "P", "STRONG", "U", "UL"]);
  container.querySelectorAll("*").forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
  });
  return container.innerHTML.replace(/<div><br><\/div>/g, "").trim();
}

function RichPromptEditor({ value, expanded, onExpand, onChange }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (!editorRef.current || document.activeElement === editorRef.current) return;
    const nextHtml = sanitizePromptHtml(value);
    if (editorRef.current.innerHTML !== nextHtml) editorRef.current.innerHTML = nextHtml;
  }, [value]);

  function emitChange() {
    onChange?.(sanitizePromptHtml(editorRef.current?.innerHTML || ""));
  }

  function applyCommand(command) {
    editorRef.current?.focus();
    document.execCommand(command, false, null);
    emitChange();
  }

  return (
    <div className={expanded ? "placeholder-rich-prompt expanded" : "placeholder-rich-prompt"}>
      {expanded ? (
        <div className="placeholder-rich-toolbar" aria-label="提示词格式工具">
          <button type="button" aria-label="加粗" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("bold")}>
            <Bold size={14} />
          </button>
          <button type="button" aria-label="斜体" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("italic")}>
            <Italic size={14} />
          </button>
          <button type="button" aria-label="列表" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("insertUnorderedList")}>
            <List size={14} />
          </button>
        </div>
      ) : null}
      <div
        ref={editorRef}
        className="placeholder-rich-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder="点击编辑提示词"
        onFocus={onExpand}
        onInput={emitChange}
        suppressContentEditableWarning
      />
    </div>
  );
}

export default AnnotateWorkspace;

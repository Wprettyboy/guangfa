import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Crosshair, FileText, Loader2, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import { templateCategories } from "../../constants/templates.js";
import {
  compareComplexFillAnchors,
  isComplexFillFieldComplete,
  normalizeComplexFillFields,
} from "./anchors.js";

function ComplexFillPanel({
  fields = [],
  anchors = [],
  saveState,
  templateCategory,
  onTemplateCategoryChange,
  onAddField,
  onUpdateField,
  onDeleteField,
  onCreateAnchor,
  onJumpAnchor,
  onDeleteAnchor,
  onSaveTemplate,
}) {
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [collapsedFields, setCollapsedFields] = useState({});
  const normalizedFields = useMemo(() => normalizeComplexFillFields(fields), [fields]);
  const incompleteCount = normalizedFields.filter((field) => !isComplexFillFieldComplete(field)).length;

  function toggleField(fieldId) {
    setCollapsedFields((current) => ({
      ...current,
      [fieldId]: !(current[fieldId] ?? false),
    }));
  }

  return (
    <div className="panel-section complex-fill-panel-section standalone">
      <div className="panel-title">
        <h2>复杂类填充</h2>
        <div className="panel-actions">
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

      <div className="complex-fill-summary">
        <strong>字段 {normalizedFields.length} 个</strong>
        <span>已选区 {anchors.length} 处{incompleteCount > 0 ? ` · ${incompleteCount} 个未完善` : ""}</span>
      </div>

      <div className="complex-fill-list">
        {normalizedFields.length === 0 ? (
          <div className="empty-state compact">
            <FileText size={16} />
            <span>暂无复杂字段，请先维护字段</span>
          </div>
        ) : normalizedFields.map((field) => {
          const fieldAnchors = anchors.filter((anchor) => anchor.fieldId === field.id).sort(compareComplexFillAnchors);
          const expanded = collapsedFields[field.id] !== true;
          const listId = `complex-fill-anchor-list-${field.id}`;
          return (
            <article className="complex-fill-card" key={field.id}>
              <div className="complex-fill-card-header">
                <strong title={field.fieldSummary}>{field.fieldSummary}</strong>
                <button className="placeholder-insert-button" type="button" onClick={() => onCreateAnchor?.(field)} title="用当前选区建立书签">
                  <Crosshair size={14} />
                  建立书签
                </button>
              </div>
              <button
                className="placeholder-card-toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => toggleField(field.id)}
              >
                <span>已选区 {fieldAnchors.length} 处</span>
                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {expanded ? (
                <div className="placeholder-card-anchor-list complex-fill-anchor-list" id={listId}>
                  {fieldAnchors.length === 0 ? (
                    <div className="placeholder-card-empty">暂无选区书签</div>
                  ) : (
                    <>
                      <div className="complex-fill-anchor-head">
                        <span>序号</span>
                        <span>页面</span>
                        <span>选区</span>
                        <span>操作</span>
                      </div>
                      {fieldAnchors.map((anchor, index) => (
                        <div className="complex-fill-anchor-row" key={anchor.bookmarkName || anchor.id}>
                          <span className="row-index">{index + 1}</span>
                          <button className="placeholder-page-link" type="button" onClick={() => onJumpAnchor?.(anchor)}>
                            第 {anchor.page || 1} 页
                          </button>
                          <span className="complex-fill-anchor-text" title={anchor.sourceText}>{anchor.sourceText || "未读取到选区文字"}</span>
                          <button className="placeholder-anchor-delete icon-button quiet" type="button" aria-label={`删除第${index + 1}个选区`} onClick={() => onDeleteAnchor?.(anchor)}>
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
        <ComplexFillMaintenanceModal
          fields={normalizedFields}
          anchors={anchors}
          onAddField={onAddField}
          onUpdateField={onUpdateField}
          onDeleteField={onDeleteField}
          onClose={() => setMaintenanceOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ComplexFillMaintenanceModal({ fields, anchors, onAddField, onUpdateField, onDeleteField, onClose }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="complex-fill-maintenance-modal" role="dialog" aria-modal="true" aria-label="复杂类填充字段维护" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>复杂类填充字段维护</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="complex-fill-maintenance-body">
          <button className="placeholder-add-button" type="button" onClick={onAddField}>
            <Plus size={15} />
            新增字段
          </button>
          <div className="complex-fill-maintenance-list">
            {fields.length === 0 ? (
              <div className="empty-state compact">
                <FileText size={16} />
                <span>暂无复杂字段</span>
              </div>
            ) : fields.map((field) => {
              const anchorCount = anchors.filter((anchor) => anchor.fieldId === field.id).length;
              return (
                <div className="complex-fill-maintenance-row" key={field.id}>
                  <label>
                    <span>字段简述</span>
                    <input value={field.fieldSummary} onChange={(event) => onUpdateField?.(field.id, { fieldSummary: event.target.value })} />
                  </label>
                  <label>
                    <span>格式要求</span>
                    <textarea value={field.formatRequirement} onChange={(event) => onUpdateField?.(field.id, { formatRequirement: event.target.value })} />
                  </label>
                  <label>
                    <span>内容要求</span>
                    <textarea value={field.contentRequirement} onChange={(event) => onUpdateField?.(field.id, { contentRequirement: event.target.value })} />
                  </label>
                  <div className="complex-fill-maintenance-actions">
                    <span>{anchorCount} 处选区</span>
                    <button className="icon-button quiet" type="button" aria-label={`删除${field.fieldSummary || "复杂字段"}`} onClick={() => onDeleteField?.(field.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
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

export default ComplexFillPanel;

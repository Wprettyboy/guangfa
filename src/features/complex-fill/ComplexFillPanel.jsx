import React, { useMemo } from "react";
import { Crosshair, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { templateCategories } from "../../constants/templates.js";
import {
  compareComplexFillItems,
  isComplexFillItemComplete,
  normalizeComplexFillItems,
} from "./anchors.js";

function ComplexFillPanel({
  items = [],
  saveState,
  templateCategory,
  onTemplateCategoryChange,
  onCreateAnchor,
  onUpdateItem,
  onJumpItem,
  onDeleteItem,
  onSaveTemplate,
}) {
  const normalizedItems = useMemo(() => normalizeComplexFillItems(items).sort(compareComplexFillItems), [items]);
  const incompleteCount = normalizedItems.filter((item) => !isComplexFillItemComplete(item)).length;

  return (
    <div className="panel-section complex-fill-panel-section standalone">
      <div className="panel-title">
        <h2>复杂类填充</h2>
        <div className="panel-actions">
          <button className="text-button" type="button" onClick={onCreateAnchor}>
            <Crosshair size={14} />
            建立书签
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
        <strong>替换书签 {normalizedItems.length} 个</strong>
        <span>{incompleteCount > 0 ? `${incompleteCount} 个未完善` : "配置已完善"}</span>
      </div>

      <div className="complex-fill-list">
        {normalizedItems.length === 0 ? (
          <div className="empty-state compact">
            <FileText size={16} />
            <span>请先在左侧文档选中要整体替换的模板文字，再建立书签</span>
          </div>
        ) : normalizedItems.map((item, index) => {
          const title = item.fieldSummary || item.sourceText || `复杂字段 ${index + 1}`;
          return (
            <article className="complex-fill-card" key={item.bookmarkName || item.id}>
              <div className="complex-fill-card-header">
                <strong title={title}>{title}</strong>
                <div className="complex-fill-card-actions">
                  <button className="placeholder-page-link" type="button" onClick={() => onJumpItem?.(item)}>
                    第 {item.page || 1} 页
                  </button>
                  <button className="icon-button quiet" type="button" aria-label={`删除${title}`} onClick={() => onDeleteItem?.(item)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="complex-fill-source" title={item.sourceText}>
                {item.sourceText || "未读取到选区文字"}
              </div>

              <label className="complex-fill-field">
                <span>字段简述</span>
                <input value={item.fieldSummary} onChange={(event) => onUpdateItem?.(item.id, { fieldSummary: event.target.value })} />
              </label>
              <label className="complex-fill-field">
                <span>格式要求</span>
                <textarea value={item.formatRequirement} onChange={(event) => onUpdateItem?.(item.id, { formatRequirement: event.target.value })} />
              </label>
              <label className="complex-fill-field">
                <span>内容要求</span>
                <textarea value={item.contentRequirement} onChange={(event) => onUpdateItem?.(item.id, { contentRequirement: event.target.value })} />
              </label>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default ComplexFillPanel;

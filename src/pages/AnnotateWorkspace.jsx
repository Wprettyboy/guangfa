import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Highlighter, Loader2, Save, Trash2 } from "lucide-react";
import StatusPill from "../components/StatusPill.jsx";
import { templateCategories } from "../constants/templates.js";
import { FieldForm } from "../features/docx/fill/FieldControls.jsx";
import { DocumentFrame } from "../features/docx/runtime.jsx";
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

export default AnnotateWorkspace;

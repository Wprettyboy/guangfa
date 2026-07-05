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

const promptCommonTextStorageKey = "guangfa.placeholderPrompt.commonTexts";
const defaultPromptCommonCategoryId = "default";

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
  onUpdateVariable,
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
      [variableId]: !(current[variableId] ?? true),
    }));
  }

  return (
    <div className="panel-section placeholder-panel-section standalone">
      <div className="panel-title">
        <h2>字段设置</h2>
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
          const expanded = collapsedVariables[variable.id] === false;
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
          onUpdateVariable={onUpdateVariable}
          onDeleteVariable={onDeleteVariable}
          onClose={() => setMaintenanceOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PlaceholderMaintenanceModal({ variables, anchors, onAddVariable, onRenameVariable, onUpdateVariable, onDeleteVariable, onClose }) {
  const [expandedPromptId, setExpandedPromptId] = useState("");
  const [commonConfig, setCommonConfig] = useState(() => loadPromptCommonTextConfig());
  const [selectedCommonCategoryId, setSelectedCommonCategoryId] = useState(() => loadPromptCommonTextConfig().categories[0]?.id || defaultPromptCommonCategoryId);

  function updateCommonConfig(updater) {
    setCommonConfig((current) => {
      const nextConfig = typeof updater === "function" ? updater(current) : updater;
      const normalized = normalizePromptCommonTextConfig(nextConfig);
      savePromptCommonTextConfig(normalized);
      return normalized;
    });
  }

  function addCommonCategory(name) {
    const normalizedName = normalizeCommonText(name, 30);
    if (!normalizedName) return;
    const existing = commonConfig.categories.find((category) => category.name === normalizedName);
    if (existing) {
      setSelectedCommonCategoryId(existing.id);
      return;
    }
    const category = { id: createPromptCommonId("PCC"), name: normalizedName };
    updateCommonConfig((current) => ({ ...current, categories: [...current.categories, category] }));
    setSelectedCommonCategoryId(category.id);
  }

  function renameCommonCategory(categoryId, name) {
    const normalizedName = normalizeCommonText(name, 30);
    if (!normalizedName) return;
    updateCommonConfig((current) => ({
      ...current,
      categories: current.categories.map((category) => (category.id === categoryId ? { ...category, name: normalizedName } : category)),
    }));
  }

  function deleteCommonCategory(categoryId) {
    if (categoryId === defaultPromptCommonCategoryId) return;
    updateCommonConfig((current) => ({
      categories: current.categories.filter((category) => category.id !== categoryId),
      items: current.items.filter((item) => item.categoryId !== categoryId),
    }));
    if (selectedCommonCategoryId === categoryId) setSelectedCommonCategoryId(defaultPromptCommonCategoryId);
  }

  function addCommonText(categoryId, text) {
    const normalized = normalizeCommonText(text);
    if (!normalized) return;
    updateCommonConfig((current) => ({
      ...current,
      items: [
        { id: createPromptCommonId("PCT"), categoryId, text: normalized, createdAt: Date.now(), updatedAt: Date.now() },
        ...current.items.filter((item) => !(item.categoryId === categoryId && item.text === normalized)),
      ].slice(0, 200),
    }));
  }

  function updateCommonText(itemId, text) {
    const normalized = normalizeCommonText(text);
    if (!normalized) return;
    updateCommonConfig((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, text: normalized, updatedAt: Date.now() } : item)),
    }));
  }

  function deleteCommonText(itemId) {
    updateCommonConfig((current) => ({ ...current, items: current.items.filter((item) => item.id !== itemId) }));
  }

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
                      commonConfig={commonConfig}
                      selectedCommonCategoryId={selectedCommonCategoryId}
                      onSelectCommonCategory={setSelectedCommonCategoryId}
                      onAddCommonCategory={addCommonCategory}
                      onRenameCommonCategory={renameCommonCategory}
                      onDeleteCommonCategory={deleteCommonCategory}
                      onAddCommonText={addCommonText}
                      onUpdateCommonText={updateCommonText}
                      onDeleteCommonText={deleteCommonText}
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

function createPromptCommonId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeCommonText(value, maxLength = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizePromptCommonTextConfig(config) {
  if (Array.isArray(config)) {
    return {
      categories: [{ id: defaultPromptCommonCategoryId, name: "默认分类" }],
      items: config.map((text, index) => ({
        id: `PCT-legacy-${index + 1}`,
        categoryId: defaultPromptCommonCategoryId,
        text: normalizeCommonText(text),
        createdAt: 0,
        updatedAt: 0,
      })).filter((item) => item.text),
    };
  }
  const rawCategories = Array.isArray(config?.categories) ? config.categories : [];
  const categories = rawCategories
    .map((category, index) => ({
      id: String(category?.id || (index === 0 ? defaultPromptCommonCategoryId : createPromptCommonId("PCC"))),
      name: normalizeCommonText(category?.name, 30) || `分类${index + 1}`,
    }))
    .filter((category) => category.id && category.name);
  if (!categories.some((category) => category.id === defaultPromptCommonCategoryId)) {
    categories.unshift({ id: defaultPromptCommonCategoryId, name: "默认分类" });
  }
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const fallbackCategoryId = categories[0]?.id || defaultPromptCommonCategoryId;
  const items = (Array.isArray(config?.items) ? config.items : [])
    .map((item, index) => ({
      id: String(item?.id || `PCT-${index + 1}`),
      categoryId: validCategoryIds.has(String(item?.categoryId || "")) ? String(item.categoryId) : fallbackCategoryId,
      text: normalizeCommonText(item?.text || item?.value || item),
      createdAt: Number(item?.createdAt || 0),
      updatedAt: Number(item?.updatedAt || 0),
    }))
    .filter((item) => item.text)
    .slice(0, 200);
  return { categories, items };
}

function loadPromptCommonTextConfig() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(promptCommonTextStorageKey) || "[]");
    return normalizePromptCommonTextConfig(parsed);
  } catch {
    return normalizePromptCommonTextConfig([]);
  }
}

function savePromptCommonTextConfig(config) {
  try {
    window.localStorage.setItem(promptCommonTextStorageKey, JSON.stringify(normalizePromptCommonTextConfig(config)));
  } catch {}
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

function escapePromptText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function RichPromptEditor({
  value,
  expanded,
  onExpand,
  onChange,
  commonConfig,
  selectedCommonCategoryId,
  onSelectCommonCategory,
  onAddCommonCategory,
  onRenameCommonCategory,
  onDeleteCommonCategory,
  onAddCommonText,
  onUpdateCommonText,
  onDeleteCommonText,
}) {
  const editorRef = useRef(null);
  const lastRangeRef = useRef(null);
  const [commonModalOpen, setCommonModalOpen] = useState(false);

  useEffect(() => {
    if (!editorRef.current || document.activeElement === editorRef.current) return;
    const nextHtml = sanitizePromptHtml(value);
    if (editorRef.current.innerHTML !== nextHtml) editorRef.current.innerHTML = nextHtml;
  }, [value]);

  function emitChange() {
    onChange?.(sanitizePromptHtml(editorRef.current?.innerHTML || ""));
  }

  function saveSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      lastRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    const range = lastRangeRef.current;
    const selection = window.getSelection?.();
    if (!editor || !range || !selection) {
      editor?.focus();
      return;
    }
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function applyCommand(command) {
    editorRef.current?.focus();
    document.execCommand(command, false, null);
    emitChange();
    saveSelection();
  }

  function insertCommonText(text) {
    onExpand?.();
    restoreSelection();
    document.execCommand("insertHTML", false, escapePromptText(text));
    emitChange();
    saveSelection();
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
          <div className="placeholder-common-text">
            <button
              type="button"
              className={commonModalOpen ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                saveSelection();
                setCommonModalOpen(true);
              }}
            >
              常用文本
            </button>
          </div>
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
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={saveSelection}
        suppressContentEditableWarning
      />
      {commonModalOpen ? (
        <CommonTextManagerModal
          config={commonConfig}
          selectedCategoryId={selectedCommonCategoryId}
          onSelectCategory={onSelectCommonCategory}
          onAddCategory={onAddCommonCategory}
          onRenameCategory={onRenameCommonCategory}
          onDeleteCategory={onDeleteCommonCategory}
          onAddText={onAddCommonText}
          onUpdateText={onUpdateCommonText}
          onDeleteText={onDeleteCommonText}
          onInsert={insertCommonText}
          onClose={() => setCommonModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CommonTextManagerModal({
  config,
  selectedCategoryId,
  onSelectCategory,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onAddText,
  onUpdateText,
  onDeleteText,
  onInsert,
  onClose,
}) {
  const categories = config?.categories?.length ? config.categories : [{ id: defaultPromptCommonCategoryId, name: "默认分类" }];
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) || categories[0];
  const items = (config?.items || []).filter((item) => item.categoryId === selectedCategory.id);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingTextId, setEditingTextId] = useState("");
  const [editingTextValue, setEditingTextValue] = useState("");

  function submitCategory() {
    const name = normalizeCommonText(categoryDraft, 30);
    if (!name) return;
    onAddCategory?.(name);
    setCategoryDraft("");
  }

  function submitText() {
    const text = normalizeCommonText(textDraft);
    if (!text) return;
    onAddText?.(selectedCategory.id, text);
    setTextDraft("");
  }

  return createPortal(
    <div className="common-text-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="common-text-modal" role="dialog" aria-modal="true" aria-label="常用文本管理" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>常用文本</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="common-text-manager">
          <aside className="common-text-tree">
            <div className="common-text-add-row">
              <input
                value={categoryDraft}
                placeholder="新增分类"
                onChange={(event) => setCategoryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitCategory();
                }}
              />
              <button type="button" onClick={submitCategory}>新增</button>
            </div>
            <div className="common-text-category-list">
              {categories.map((category) => {
                const active = category.id === selectedCategory.id;
                const editing = editingCategoryId === category.id;
                return (
                  <div className={active ? "common-text-category active" : "common-text-category"} key={category.id}>
                    {editing ? (
                      <input
                        value={editingCategoryName}
                        autoFocus
                        onChange={(event) => setEditingCategoryName(event.target.value)}
                        onBlur={() => {
                          onRenameCategory?.(category.id, editingCategoryName);
                          setEditingCategoryId("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <button type="button" title={category.name} onClick={() => onSelectCategory?.(category.id)}>
                        {category.name}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="编辑分类"
                      onClick={() => {
                        setEditingCategoryId(category.id);
                        setEditingCategoryName(category.name);
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" aria-label="删除分类" disabled={category.id === defaultPromptCommonCategoryId} onClick={() => onDeleteCategory?.(category.id)}>
                      删除
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
          <main className="common-text-table-panel">
            <div className="common-text-add-row">
              <input
                value={textDraft}
                placeholder={`新增${selectedCategory.name}常用文本`}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitText();
                }}
              />
              <button type="button" onClick={submitText}>新增</button>
            </div>
            <div className="common-text-table">
              <div className="common-text-table-head">
                <span>常用文本</span>
                <span>操作</span>
              </div>
              {items.length === 0 ? (
                <div className="common-text-empty">当前分类暂无常用文本</div>
              ) : items.map((item) => {
                const editing = editingTextId === item.id;
                return (
                  <div className="common-text-table-row" key={item.id}>
                    {editing ? (
                      <input
                        value={editingTextValue}
                        autoFocus
                        onChange={(event) => setEditingTextValue(event.target.value)}
                        onBlur={() => {
                          onUpdateText?.(item.id, editingTextValue);
                          setEditingTextId("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <span title={item.text}>{item.text}</span>
                    )}
                    <div className="common-text-row-actions">
                      <button type="button" onClick={() => onInsert?.(item.text)}>插入</button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTextId(item.id);
                          setEditingTextValue(item.text);
                        }}
                      >
                        编辑
                      </button>
                      <button type="button" onClick={() => onDeleteText?.(item.id)}>删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default AnnotateWorkspace;

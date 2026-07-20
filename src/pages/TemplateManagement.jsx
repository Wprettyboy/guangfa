import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Archive, Check, FileCheck2, FolderOpen, Highlighter, Pencil, Plus, Trash2, Upload, Wand2, X } from "lucide-react";
import {
  buildContractFolders,
  getContractFolder,
  getTemplateCategoryTone,
  groupContractFolders,
  inferTemplateCategory,
  normalizeTemplateCategory,
  summarizeFieldTypes,
} from "../utils/templates.js";

function getTemplateInsertedFieldCount(template = {}) {
  if (Array.isArray(template.placeholderAnchors)) return template.placeholderAnchors.length;
  return Number(template.placeholderCount ?? template.fieldCount ?? template.fields?.length ?? 0) || 0;
}

function getTemplateMaintainedFieldCount(template = {}) {
  if (Array.isArray(template.placeholderVariables)) return template.placeholderVariables.length;
  if (Array.isArray(template.fields)) return template.fields.length;
  if (Array.isArray(template.typeSummary)) {
    return template.typeSummary.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  }
  return 0;
}

function normalizeTemplateTypes(templateTypes) {
  const seen = new Set();
  const types = (Array.isArray(templateTypes) ? templateTypes : [])
    .map((type, index) => ({
      id: String(type?.id || `TYPE-${index + 1}`),
      name: normalizeCategoryInput(type?.name),
      templateCount: Number(type?.templateCount || 0),
    }))
    .filter((type) => {
      if (!type.name || seen.has(type.name)) return false;
      seen.add(type.name);
      return true;
    });
  return types.length > 0
    ? types
    : ["招标类", "合同类", "方案类"].map((name, index) => ({ id: `TYPE-FALLBACK-${index + 1}`, name, templateCount: 0 }));
}

function normalizeCategoryInput(value) {
  return String(value || "").replace(/\s+/g, "").trim().slice(0, 30);
}

function TemplateManagement({
  canEdit = true,
  templates,
  templateTypes = [],
  onUseTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onUpdateCategory,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onCreateTemplate,
}) {
  const managerRef = useRef(null);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [activeContractFolder, setActiveContractFolder] = useState("全部");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");

  useGSAP(
    () => {
      const cards = gsap.utils.toArray(".template-card");
      if (cards.length > 0) {
        gsap.fromTo(
          cards,
          { y: 12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.05, ease: "power2.out" },
        );
      }
    },
    { dependencies: [templates.length], scope: managerRef },
  );

  const totalInsertedFields = templates.reduce((sum, template) => sum + getTemplateInsertedFieldCount(template), 0);
  const totalMaintainedFields = templates.reduce((sum, template) => sum + getTemplateMaintainedFieldCount(template), 0);
  const categoryOptions = normalizeTemplateTypes(templateTypes);
  const categoryNames = categoryOptions.map((type) => type.name);
  const allCategories = ["全部", ...categoryNames];
  const normalizedTemplates = templates.map((template) => ({
    ...template,
    category: normalizeTemplateCategory(template.category || inferTemplateCategory(template.name || template.fileName)),
    contractFolder: getContractFolder(template),
  }));
  const categoryTemplates =
    activeCategory === "全部"
      ? normalizedTemplates
      : normalizedTemplates.filter((template) => template.category === activeCategory);
  const contractFolders = buildContractFolders(normalizedTemplates);
  const visibleTemplates =
    activeCategory === "合同类" && activeContractFolder.startsWith("一级:")
      ? categoryTemplates.filter((template) => template.level1 === activeContractFolder.replace("一级:", ""))
      : activeCategory === "合同类" && activeContractFolder !== "全部"
      ? categoryTemplates.filter((template) => template.contractFolder === activeContractFolder)
      : categoryTemplates;
  const contractFolderGroups = groupContractFolders(contractFolders);
  const activeFolder = contractFolders.find((folder) => folder.key === activeContractFolder);
  const activeLevel1 = activeContractFolder.startsWith("一级:")
    ? activeContractFolder.replace("一级:", "")
    : activeFolder?.level1 || contractFolderGroups[0]?.level1 || "";
  const contractSelectValue = activeContractFolder === "全部" ? "全部" : `一级:${activeLevel1}`;
  const activeContractGroup = contractFolderGroups.find((group) => group.level1 === activeLevel1) || contractFolderGroups[0];
  const activeCategoryType = categoryOptions.find((type) => type.name === activeCategory) || null;

  useEffect(() => {
    if (!allCategories.includes(activeCategory)) {
      setActiveCategory("全部");
      setEditingCategoryId("");
      setEditingCategoryName("");
    }
  }, [activeCategory, allCategories.join("|")]);

  useEffect(() => {
    if (activeCategory !== "合同类") {
      setActiveContractFolder("全部");
      return;
    }
    const hasFolder = contractFolders.some((folder) => folder.key === activeContractFolder);
    const hasLevel1 = contractFolderGroups.some((group) => `一级:${group.level1}` === activeContractFolder);
    if (activeContractFolder !== "全部" && !hasFolder && !hasLevel1) {
      setActiveContractFolder("全部");
    }
  }, [activeCategory, activeContractFolder, contractFolders, contractFolderGroups]);

  async function createCategory() {
    const name = normalizeCategoryInput(newCategoryName);
    if (!name) {
      setCategoryMessage("类别名称不能为空。");
      return;
    }
    if (categoryNames.includes(name)) {
      setCategoryMessage("同名类别已存在。");
      return;
    }
    try {
      await onCreateCategory?.(name);
      setNewCategoryName("");
      setActiveCategory(name);
      setCategoryMessage("");
    } catch (error) {
      setCategoryMessage(error?.message || "类别新增失败。");
    }
  }

  async function renameCategory(type) {
    const name = normalizeCategoryInput(editingCategoryName);
    if (!type || !name) {
      setCategoryMessage("类别名称不能为空。");
      return;
    }
    if (name !== type.name && categoryNames.includes(name)) {
      setCategoryMessage("同名类别已存在。");
      return;
    }
    try {
      await onRenameCategory?.(type.id, name);
      setActiveCategory(name);
      setEditingCategoryId("");
      setEditingCategoryName("");
      setCategoryMessage("");
    } catch (error) {
      setCategoryMessage(error?.message || "类别修改失败。");
    }
  }

  async function deleteCategory(type) {
    if (!type) return;
    if (getCategoryTemplateCount(type.name) > 0) {
      setCategoryMessage("该类别下还有模板，不能删除。");
      return;
    }
    if (!window.confirm(`确认删除类别“${type.name}”？`)) return;
    try {
      await onDeleteCategory?.(type.id);
      setActiveCategory("全部");
      setEditingCategoryId("");
      setEditingCategoryName("");
      setCategoryMessage("");
    } catch (error) {
      setCategoryMessage(error?.message || "类别删除失败。");
    }
  }

  function getCategoryTemplateCount(category) {
    return normalizedTemplates.filter((template) => template.category === category).length;
  }

  return (
    <section className="template-manager" ref={managerRef}>
      <div className="manager-toolbar">
        <div>
          <h2>模板库</h2>
          <p>合同类、招标类、方案类模板统一管理，后续按智能体场景直接调用。</p>
        </div>
        {canEdit ? (
          <button className="tool-button solid" onClick={onCreateTemplate}>
            <Highlighter size={17} />
            新建标注模板
          </button>
        ) : null}
      </div>

      <div className="manager-summary">
        <div className="summary-card">
          <span>模板数量</span>
          <strong>{templates.length}</strong>
          <em>已保存</em>
        </div>
        <div className="summary-card">
          <span>字段总数</span>
          <strong>{totalInsertedFields}</strong>
          <em>已插入字段</em>
        </div>
        <div className="summary-card">
          <span>字段类型数量</span>
          <strong>{totalMaintainedFields}</strong>
          <em>维护字段</em>
        </div>
      </div>

      <div className="template-category-tabs">
        {allCategories.map((category) => {
          const count = category === "全部"
            ? normalizedTemplates.length
            : normalizedTemplates.filter((template) => template.category === category).length;
          return (
            <button
              className={activeCategory === category ? "category-tab active" : "category-tab"}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {canEdit ? <div className="template-category-crud">
        <div className="template-category-create">
          <input
            value={newCategoryName}
            placeholder="新增模板类别"
            onChange={(event) => setNewCategoryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createCategory();
            }}
          />
          <button className="mini-button blue" type="button" onClick={createCategory}>
            <Plus size={14} />
            新增
          </button>
        </div>
        {activeCategoryType ? (
          <div className="template-category-manage">
            {editingCategoryId === activeCategoryType.id ? (
              <>
                <input
                  value={editingCategoryName}
                  autoFocus
                  onChange={(event) => setEditingCategoryName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") renameCategory(activeCategoryType);
                    if (event.key === "Escape") {
                      setEditingCategoryId("");
                      setEditingCategoryName("");
                    }
                  }}
                />
                <button className="icon-button quiet" type="button" aria-label="保存类别名称" onClick={() => renameCategory(activeCategoryType)}>
                  <Check size={15} />
                </button>
                <button className="icon-button quiet" type="button" aria-label="取消编辑类别" onClick={() => {
                  setEditingCategoryId("");
                  setEditingCategoryName("");
                }}>
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <span>当前类别：{activeCategoryType.name}</span>
                <button className="mini-button" type="button" onClick={() => {
                  setEditingCategoryId(activeCategoryType.id);
                  setEditingCategoryName(activeCategoryType.name);
                  setCategoryMessage("");
                }}>
                  <Pencil size={14} />
                  重命名
                </button>
                <button
                  className="icon-button quiet"
                  type="button"
                  aria-label={`删除类别${activeCategoryType.name}`}
                  title={getCategoryTemplateCount(activeCategoryType.name) > 0 ? "该类别下还有模板，不能删除" : "删除类别"}
                  disabled={getCategoryTemplateCount(activeCategoryType.name) > 0}
                  onClick={() => deleteCategory(activeCategoryType)}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ) : (
          <span className="template-category-hint">选择具体类别后可重命名或删除；“全部”仅用于筛选。</span>
        )}
        {categoryMessage ? <span className="template-category-message">{categoryMessage}</span> : null}
      </div> : null}

      {activeCategory === "合同类" && contractFolders.length > 0 ? (
        <div className="contract-folder-browser">
          <div className="contract-folder-bar">
            <button
              className={activeContractFolder === "全部" ? "contract-folder all active" : "contract-folder all"}
              onClick={() => setActiveContractFolder("全部")}
            >
              <FolderOpen size={16} />
              全部合同
              <span>{contractFolders.reduce((sum, folder) => sum + folder.count, 0)}</span>
            </button>
            <select value={contractSelectValue} onChange={(event) => setActiveContractFolder(event.target.value)}>
              <option value="全部">全部合同</option>
              {contractFolderGroups.map((group) => (
                <option value={`一级:${group.level1}`} key={group.level1}>{group.level1}（{group.count}）</option>
              ))}
            </select>
          </div>
          {activeContractGroup ? (
            <div className="contract-folder-group">
              <button
                className={activeContractFolder === `一级:${activeContractGroup.level1}` ? "contract-folder level active" : "contract-folder level"}
                onClick={() => setActiveContractFolder(`一级:${activeContractGroup.level1}`)}
              >
                <FolderOpen size={16} />
                {activeContractGroup.level1}
                <span>{activeContractGroup.count}</span>
              </button>
              <div>
                {activeContractGroup.folders.map((folder) => (
                  <button
                    className={activeContractFolder === folder.key ? "contract-folder active" : "contract-folder"}
                    key={folder.key}
                    onClick={() => setActiveContractFolder(folder.key)}
                    title={folder.key}
                  >
                    <FolderOpen size={16} />
                    <span className="folder-name">{folder.level2}</span>
                    <span>{folder.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="template-empty">
          <Archive size={28} />
          <strong>暂无模板</strong>
          <span>在模板标注工作台上传 DOCX 后可直接保存入库；需要自动填充时再标注字段并设置输入点。</span>
          {canEdit ? (
            <button className="tool-button primary" onClick={onCreateTemplate}>
              <Upload size={17} />
              去标注模板
            </button>
          ) : null}
        </div>
      ) : (
        <div className="template-grid">
          {visibleTemplates.map((template) => {
            const fieldCount = getTemplateInsertedFieldCount(template);
            const fieldTypeSummary = template.typeSummary || summarizeFieldTypes(template.fields || []);
            const fieldTypeCount = getTemplateMaintainedFieldCount(template);
            return (
              <article className="template-card" key={template.id}>
              <div className="template-card-head">
                <FileCheck2 size={20} />
                <div>
                  <h3>{template.name}</h3>
                  <p>{template.fileName}</p>
                </div>
                <span className={`template-category ${getTemplateCategoryTone(template.category)}`}>{template.category}</span>
              </div>
              {template.category === "合同类" ? (
                <div className="template-folder-path">
                  <FolderOpen size={15} />
                  {template.contractFolder}
                </div>
              ) : null}
              <dl className="template-meta">
                <div>
                  <dt>总字段</dt>
                  <dd>{fieldCount}个</dd>
                </div>
                <div>
                  <dt>字段类型</dt>
                  <dd>{fieldTypeCount}个</dd>
                </div>
                <div>
                  <dt>文件大小</dt>
                  <dd>{template.fileSize || "--"}</dd>
                </div>
              </dl>
              <div className={template.fileBuffer || template.fileBase64 ? "template-file-state ok" : "template-file-state"}>
                {template.fileBuffer || template.fileBase64
                  ? template.supported === false
                    ? "已保存原始文件（需转换DOCX预览）"
                    : "已持久化 DOCX 文件"
                  : "仅字段配置"}
              </div>
              <label className="template-category-editor">
                <span>模板分类</span>
                <select disabled={!canEdit} value={template.category} onChange={(event) => onUpdateCategory(template.id, event.target.value)}>
                  {categoryNames.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <div className="template-type-list">
                {fieldTypeSummary.map((item) => (
                  <span key={item.type}>{item.type} {item.count}</span>
                ))}
              </div>
              <div className="template-foot">
                <span>保存于 {template.savedAt}</span>
                {canEdit ? <div>
                  <button className="mini-button" onClick={() => onEditTemplate(template)}>
                    <Highlighter size={15} />
                    编辑模板
                  </button>
                  <button className="mini-button blue" onClick={() => onUseTemplate(template)}>
                    <Wand2 size={15} />
                    使用模板
                  </button>
                  <button className="icon-button quiet" aria-label={`删除${template.name}`} onClick={() => onDeleteTemplate(template.id)}>
                    <Trash2 size={16} />
                  </button>
                </div> : null}
              </div>
              </article>
            );
          })}
          {visibleTemplates.length === 0 ? (
            <div className="template-empty inline">
              <Archive size={24} />
              <strong>当前分类暂无模板</strong>
              <span>切换其他分类，或在模板标注工作台保存新的{activeCategory}模板。</span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default TemplateManagement;

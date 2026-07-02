import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Archive, FileCheck2, FolderOpen, Highlighter, Trash2, Upload, Wand2 } from "lucide-react";
import { templateCategories } from "../constants/templates.js";
import { normalizeFieldCategory } from "../utils/fields.js";
import {
  buildContractFolders,
  getContractFolder,
  getTemplateCategoryTone,
  groupContractFolders,
  inferTemplateCategory,
  normalizeTemplateCategory,
  summarizeFieldTypes,
} from "../utils/templates.js";

function TemplateManagement({ templates, onUseTemplate, onEditTemplate, onDeleteTemplate, onUpdateCategory, onCreateTemplate }) {
  const managerRef = useRef(null);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [activeContractFolder, setActiveContractFolder] = useState("全部");

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

  const totalFields = templates.reduce((sum, template) => sum + (template.fieldCount || template.fields?.length || 0), 0);
  const allTypes = new Set(templates.flatMap((template) => (template.fields || []).map((field) => normalizeFieldCategory(field.type || field.category))));
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

  return (
    <section className="template-manager" ref={managerRef}>
      <div className="manager-toolbar">
        <div>
          <h2>模板库</h2>
          <p>合同类、招标类、方案类模板统一管理，后续按智能体场景直接调用。</p>
        </div>
        <button className="tool-button solid" onClick={onCreateTemplate}>
          <Highlighter size={17} />
          新建标注模板
        </button>
      </div>

      <div className="manager-summary">
        <div className="summary-card">
          <span>模板数量</span>
          <strong>{templates.length}</strong>
          <em>已保存</em>
        </div>
        <div className="summary-card">
          <span>字段总数</span>
          <strong>{totalFields}</strong>
          <em>可填充字段</em>
        </div>
        <div className="summary-card">
          <span>自动填充类别</span>
          <strong>{allTypes.size}</strong>
          <em>已配置</em>
        </div>
      </div>

      <div className="template-category-tabs">
        {templateCategories.map((category) => {
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
          <span>在模板标注工作台上传 DOCX、标注字段并设置输入点后，点击保存模板即可入库。</span>
          <button className="tool-button primary" onClick={onCreateTemplate}>
            <Upload size={17} />
            去标注模板
          </button>
        </div>
      ) : (
        <div className="template-grid">
          {visibleTemplates.map((template) => (
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
                  <dt>字段数</dt>
                  <dd>{template.fieldCount || template.fields?.length || 0}</dd>
                </div>
                <div>
                  <dt>已确认</dt>
                  <dd>{template.confirmedCount ?? template.fields?.filter((field) => field.status === "已标注").length ?? 0}</dd>
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
                <select value={template.category} onChange={(event) => onUpdateCategory(template.id, event.target.value)}>
                  <option>招标类</option>
                  <option>合同类</option>
                  <option>方案类</option>
                </select>
              </label>
              <div className="template-type-list">
                {(template.typeSummary || summarizeFieldTypes(template.fields || [])).map((item) => (
                  <span key={item.type}>{item.type} {item.count}</span>
                ))}
              </div>
              <div className="template-foot">
                <span>保存于 {template.savedAt}</span>
                <div>
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
                </div>
              </div>
            </article>
          ))}
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

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FileText, Loader2, Plus, RefreshCw, Send, Trash2, Wand2 } from "lucide-react";
import { generateSolutionModuleSections, identifySolutionModules } from "./service.js";
import SolutionDraftingPanel from "./SolutionDraftingPanel.jsx";
import TaskPlanningPanel from "./TaskPlanningPanel.jsx";

const SOLUTION_STYLE_OPTIONS = [
  { value: "body", label: "正文" },
  { value: "heading-1", label: "标题1" },
  { value: "heading-2", label: "标题2" },
  { value: "heading-3", label: "标题3" },
  { value: "heading-4", label: "标题4" },
  { value: "heading-5", label: "标题5" },
  { value: "heading-6", label: "标题6" },
];

function SolutionWritingPanel({
  outline,
  knowledgeBases = [],
  selectedProjectKnowledgeBaseIds = [],
  selectedGlobalKnowledgeBaseIds = [],
  knowledgeTopK = 8,
  currentProjectId = "default-project",
  onSelectedProjectKnowledgeBaseChange,
  onSelectedGlobalKnowledgeBaseChange,
  onKnowledgeTopKChange,
  onRequestOutline,
  onInsertText,
  onExportWord,
}) {
  const [localOutline, setLocalOutline] = useState(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [userInstruction, setUserInstruction] = useState("");
  const [modules, setModules] = useState([]);
  const [collapsedModuleIds, setCollapsedModuleIds] = useState([]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState(["template", "knowledge", "identify", "modules"]);
  const [activePlanPanel, setActivePlanPanel] = useState("outline-plan");
  const [generatedBlocks, setGeneratedBlocks] = useState([]);
  const [generatedTaskPlan, setGeneratedTaskPlan] = useState(null);
  const [styleSelections, setStyleSelections] = useState({});
  const [styleProbeText, setStyleProbeText] = useState("样式测试文本");
  const [styleProbeValue, setStyleProbeValue] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const effectiveOutline = localOutline || outline;
  const rawOutlineCount = Array.isArray(effectiveOutline?.items) ? effectiveOutline.items.length : 0;
  const styleDebug = effectiveOutline?.styleDebug || null;
  const outlineItems = useMemo(() => normalizeOutlineItems(effectiveOutline?.items), [effectiveOutline]);
  const documentStyles = useMemo(() => normalizeDocumentStyles(effectiveOutline?.documentStyles), [effectiveOutline]);
  const templateGroups = useMemo(() => buildTemplateGroups(outlineItems), [outlineItems]);
  const selectedGroup = templateGroups.find((group) => group.key === selectedGroupKey) || templateGroups[0] || null;
  const styleOptions = useMemo(() => buildStyleOptions(documentStyles), [documentStyles]);
  const styleMappingRows = useMemo(() => buildStyleMappingRows(selectedGroup, documentStyles), [selectedGroup, documentStyles]);
  const styleProbeRows = useMemo(
    () => buildStyleProbeRows(selectedGroup, styleMappingRows, styleSelections),
    [selectedGroup, styleMappingRows, styleSelections],
  );
  const projectBases = knowledgeBases.filter((base) => base.scope !== "global");
  const globalBases = knowledgeBases.filter((base) => base.scope === "global");
  const selectedKnowledgeBases = knowledgeBases.filter(
    (base) => selectedProjectKnowledgeBaseIds.includes(base.id) || selectedGlobalKnowledgeBaseIds.includes(base.id),
  );
  const knowledgeOptions = useMemo(() => ({
    enabled: selectedKnowledgeBases.length > 0,
    projectId: currentProjectId,
    kbIds: selectedProjectKnowledgeBaseIds,
    globalKbIds: selectedGlobalKnowledgeBaseIds,
    topK: knowledgeTopK,
    bases: selectedKnowledgeBases.map((base) => ({ id: base.id, name: base.name, scope: base.scope })),
  }), [currentProjectId, knowledgeTopK, selectedGlobalKnowledgeBaseIds, selectedKnowledgeBases, selectedProjectKnowledgeBaseIds]);

  useEffect(() => {
    if (selectedGroupKey && templateGroups.some((group) => group.key === selectedGroupKey)) return;
    const recommended = getRecommendedTemplateGroup(templateGroups);
    setSelectedGroupKey(recommended?.key || "");
  }, [selectedGroupKey, templateGroups]);

  useEffect(() => {
    if (!selectedGroup) return;
    setStyleSelections(buildDefaultStyleSelections(selectedGroup, documentStyles));
  }, [documentStyles, selectedGroup?.key]);

  useEffect(() => {
    if (styleProbeRows.some((row) => row.value === styleProbeValue)) return;
    setStyleProbeValue(styleProbeRows[0]?.value || "");
  }, [styleProbeRows, styleProbeValue]);

  async function refreshOutline() {
    setStatus("loading-outline");
    setMessage("");
    const result = await onRequestOutline?.();
    if (result?.ok) {
      const nextOutlineItems = normalizeOutlineItems(result.items);
      const nextTemplateGroups = buildTemplateGroups(nextOutlineItems);
      setLocalOutline(result);
      setStatus("idle");
      setMessage(`已读取有效标题 ${nextOutlineItems.length} 个（原始 ${result.items?.length || 0} 个），可选章节模板 ${nextTemplateGroups.length} 组`);
      return;
    }
    setStatus("error");
    setMessage(result?.error || "未读取到 OnlyOffice 大纲，请确认左侧文档已加载。");
  }

  async function identifyModules() {
    if (!selectedGroup) return;
    setStatus("identifying");
    setMessage("");
    try {
      const result = await identifySolutionModules({
        sectionTitle: selectedGroup.title,
        childTemplates: selectedGroup.childTemplates,
        userInstruction,
        knowledgeOptions,
      });
      const nextModules = result.modules || [];
      setModules(nextModules);
      setCollapsedModuleIds(nextModules.map((module) => module.id));
      setGeneratedBlocks([]);
      setStatus("idle");
      setMessage(result.modules?.length ? `已识别 ${result.modules.length} 个功能模块` : "未识别到功能模块，请调整知识库范围或补充要求。");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "功能模块识别失败");
    }
  }

  async function generateSections() {
    if (!selectedGroup || modules.length === 0) return;
    setStatus("generating");
    setMessage("");
    const nextBlocks = [];
    try {
      for (const module of modules) {
        if (!module.name.trim()) continue;
        const result = await generateSolutionModuleSections({
          sectionTitle: selectedGroup.title,
          childTemplates: selectedGroup.childTemplates,
          module,
          userInstruction,
          knowledgeOptions,
        });
        nextBlocks.push({
          moduleId: module.id,
          moduleName: result.moduleName || module.name,
          sections: result.sections || [],
          warnings: result.warnings || [],
        });
      }
      setGeneratedBlocks(nextBlocks);
      setStatus("idle");
      setMessage(nextBlocks.length ? `已生成 ${nextBlocks.length} 个模块写作规划，可按模块或子标题插入。` : "没有可生成的模块。");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "方案章节生成失败");
    }
  }

  async function insertGeneratedText(content, successMessage = "已插入当前光标位置") {
    const payload = normalizeInsertPayload(content);
    if (!payload.text) return;
    setStatus("inserting");
    setMessage("");
    const result = await onInsertText?.(payload.text, { paragraphs: payload.paragraphs });
    if (result?.ok) {
      setStatus("idle");
      setMessage(successMessage);
      return;
    }
    setStatus("error");
    setMessage(result?.error || "写入失败，请确认左侧文档已加载并把光标放在目标位置。");
  }

  async function insertStyleProbeText() {
    const text = styleProbeText.trim();
    const row = styleProbeRows.find((item) => item.value === styleProbeValue) || styleProbeRows[0];
    if (!text || !row) return;
    const paragraph = {
      type: row.type,
      level: row.level,
      style: row.value,
      styleName: getStyleName(row.value),
      styleFallback: getStyleFallback(row.value, row.type, row.level),
      text,
    };
    await insertGeneratedText({ text, paragraphs: [paragraph] }, `已插入样式测试：${row.label}`);
  }

  async function exportWord() {
    if (!onExportWord) return;
    setStatus("exporting");
    setMessage("");
    try {
      await onExportWord();
      setStatus("idle");
      setMessage("Word 文档已导出");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "导出失败，请确认左侧文档已加载。");
    }
  }

  function addModule() {
    const nextId = `SOL-M${String(modules.length + 1).padStart(3, "0")}-${Date.now()}`;
    const nextModule = { id: nextId, name: "新功能模块", description: "", reason: "", sourceRefs: [] };
    setModules((current) => [...current, nextModule]);
    setCollapsedModuleIds((ids) => [...ids, nextId]);
  }

  function updateModule(moduleId, patch) {
    setModules((current) => current.map((module) => (module.id === moduleId ? { ...module, ...patch } : module)));
  }

  function removeModule(moduleId) {
    setModules((current) => current.filter((module) => module.id !== moduleId));
    setGeneratedBlocks((current) => current.filter((block) => block.moduleId !== moduleId));
    setCollapsedModuleIds((current) => current.filter((id) => id !== moduleId));
  }

  function toggleModule(moduleId) {
    setCollapsedModuleIds((current) => (
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId]
    ));
  }

  function toggleSection(sectionId) {
    setCollapsedSectionIds((current) => (
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId]
    ));
  }

  function moveModule(moduleId, direction) {
    setModules((current) => {
      const index = current.findIndex((module) => module.id === moduleId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  const busy = ["loading-outline", "identifying", "generating", "inserting", "exporting"].includes(status);

  return (
    <div className="panel-section solution-writing-panel standalone">
      <div className="panel-title">
        <h2>方案编写</h2>
        <div className="panel-actions">
          <button className="text-button" type="button" onClick={refreshOutline} disabled={busy}>
            {status === "loading-outline" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            读取大纲
          </button>
          <button className="text-button" type="button" onClick={exportWord} disabled={busy || !onExportWord}>
            {status === "exporting" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {status === "exporting" ? "导出中" : "导出Word"}
          </button>
        </div>
      </div>

      <div className="solution-writing-scroll">
        <div className="solution-plan-tabs" role="tablist" aria-label="方案编写模块">
          <button
            className={activePlanPanel === "outline-plan" ? "solution-plan-tab active" : "solution-plan-tab"}
            type="button"
            onClick={() => setActivePlanPanel("outline-plan")}
            role="tab"
            aria-selected={activePlanPanel === "outline-plan"}
          >
            <span>
              <strong>方案大纲规划</strong>
              <em>{generatedBlocks.length ? `已生成 ${generatedBlocks.length} 个模块` : "大纲、模块与规划"}</em>
            </span>
            <ChevronRight size={15} />
          </button>
          <button
            className={activePlanPanel === "task-plan" ? "solution-plan-tab active" : "solution-plan-tab"}
            type="button"
            onClick={() => setActivePlanPanel("task-plan")}
            role="tab"
            aria-selected={activePlanPanel === "task-plan"}
          >
            <span>
              <strong>任务规划</strong>
              <em>待规划</em>
            </span>
            <ChevronRight size={15} />
          </button>
          <button
            className={activePlanPanel === "draft-plan" ? "solution-plan-tab active" : "solution-plan-tab"}
            type="button"
            onClick={() => setActivePlanPanel("draft-plan")}
            role="tab"
            aria-selected={activePlanPanel === "draft-plan"}
          >
            <span>
              <strong>方案编制</strong>
              <em>{generatedTaskPlan?.stats?.taskCount ? `承接 ${generatedTaskPlan.stats.taskCount} 个任务` : "待承接任务"}</em>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>

        {activePlanPanel === "outline-plan" ? (
          <div className="solution-plan-content">
        <SolutionSection
          title="章节模板"
          summary={templateGroups.length ? `模板组 ${templateGroups.length} 个` : "未读取大纲"}
          collapsed={collapsedSectionIds.includes("template")}
          onToggle={() => toggleSection("template")}
          icon={<FileText size={15} />}
        >
          <select value={selectedGroup?.key || ""} onChange={(event) => setSelectedGroupKey(event.target.value)} disabled={templateGroups.length === 0}>
            {templateGroups.length === 0 ? (
              <option value="">请先读取左侧文档大纲</option>
            ) : templateGroups.map((group) => (
              <option key={group.key} value={group.key}>{group.title} · {group.childTemplates.length} 个子章节</option>
            ))}
          </select>
          {selectedGroup ? (
            <>
              <div className="solution-outline-stats">
                <span>有效标题 {outlineItems.length} 个</span>
                <span>原始返回 {rawOutlineCount} 个</span>
              </div>
              <div className="solution-template-children">
                {selectedGroup.childTemplates.map((item) => <span key={`${selectedGroup.key}-${item.index}`}>{item.title}</span>)}
              </div>
              <div className="solution-style-map">
                <div className="solution-style-map-title">
                  <strong>样式匹配</strong>
                  <span>插入时优先套用文档真实 Word 样式</span>
                </div>
                {styleMappingRows.map((row) => (
                  <label className="solution-style-row" key={row.key}>
                    <span>
                      <strong>{row.label}</strong>
                      <em>{row.sample}</em>
                    </span>
                    <select
                      value={styleSelections[row.key] || row.defaultStyle}
                      onChange={(event) => setStyleSelections((current) => ({ ...current, [row.key]: event.target.value }))}
                    >
                      {styleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="solution-style-probe">
                  <div className="solution-style-probe-head">
                    <strong>样式测试</strong>
                    <span>用于核对抓取样式和写入效果</span>
                  </div>
                  <div className="solution-style-captured-list">
                    {styleProbeRows.map((row) => (
                      <div key={row.key}>
                        <span>{row.label}</span>
                        <em>{row.capturedStyleName || "未抓到"} · {row.capturedSource || "无来源"} · 写入 {getStyleName(row.value) || row.value}</em>
                      </div>
                    ))}
                  </div>
                  <div className="solution-style-probe-controls">
                    <select value={styleProbeValue} onChange={(event) => setStyleProbeValue(event.target.value)}>
                      {styleProbeRows.map((row) => (
                        <option key={row.key} value={row.value}>{row.label}：{getStyleName(row.value) || row.value}</option>
                      ))}
                    </select>
                    <input
                      value={styleProbeText}
                      onChange={(event) => setStyleProbeText(event.target.value)}
                      placeholder="输入测试文字"
                    />
                    <button type="button" className="text-button" onClick={insertStyleProbeText} disabled={!styleProbeText.trim() || !styleProbeRows.length || status === "inserting"}>
                      测试写入
                    </button>
                  </div>
                  {styleDebug ? (
                    <StyleDebugPanel debug={styleDebug} />
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </SolutionSection>

        <SolutionSection
          title="知识库范围"
          summary={selectedKnowledgeBases.length ? `已选 ${selectedKnowledgeBases.length} 个` : "未选择"}
          collapsed={collapsedSectionIds.includes("knowledge")}
          onToggle={() => toggleSection("knowledge")}
        >
          <KnowledgeScopeList
            title="项目库"
            bases={projectBases}
            selectedIds={selectedProjectKnowledgeBaseIds}
            onChange={onSelectedProjectKnowledgeBaseChange}
          />
          <KnowledgeScopeList
            title="全局库"
            bases={globalBases}
            selectedIds={selectedGlobalKnowledgeBaseIds}
            onChange={onSelectedGlobalKnowledgeBaseChange}
          />
          <label className="solution-topk">
            <span>召回数量</span>
            <input
              type="number"
              min="1"
              max="20"
              value={knowledgeTopK}
              onChange={(event) => onKnowledgeTopKChange?.(Number(event.target.value) || 8)}
            />
          </label>
        </SolutionSection>

        <SolutionSection
          title="识别功能模块"
          summary={userInstruction.trim() ? "已填写补充要求" : "待填写补充要求"}
          collapsed={collapsedSectionIds.includes("identify")}
          onToggle={() => toggleSection("identify")}
        >
          <label className="solution-instruction">
            <span>补充要求</span>
            <textarea
              value={userInstruction}
              placeholder="例如：只补齐详细功能设计，功能模块按资料中的业务子系统依次展开。"
              onChange={(event) => setUserInstruction(event.target.value)}
            />
          </label>
          <button className="tool-button primary full-width" type="button" onClick={identifyModules} disabled={!selectedGroup || busy}>
            {status === "identifying" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
            识别功能模块
          </button>
        </SolutionSection>

        <SolutionSection
          title="模块清单"
          summary={`${modules.length} 个`}
          collapsed={collapsedSectionIds.includes("modules")}
          onToggle={() => toggleSection("modules")}
          className="grow"
        >
          <div className="solution-module-list">
            {modules.length === 0 ? (
              <div className="empty-state compact">先识别或手动新增功能模块</div>
            ) : modules.map((module, index) => {
              const collapsed = collapsedModuleIds.includes(module.id);
              const detailId = `solution-module-detail-${module.id}`;
              return (
              <article className={collapsed ? "solution-module-card collapsed" : "solution-module-card"} key={module.id}>
                <div className="solution-module-head">
                  <button
                    className="icon-button quiet solution-module-toggle"
                    type="button"
                    onClick={() => toggleModule(module.id)}
                    aria-expanded={!collapsed}
                    aria-controls={detailId}
                    aria-label={collapsed ? "展开模块" : "收起模块"}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <span>{index + 1}</span>
                  <input value={module.name} onChange={(event) => updateModule(module.id, { name: event.target.value })} />
                  <button className="icon-button quiet" type="button" onClick={() => moveModule(module.id, -1)} disabled={index === 0} aria-label="上移">
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-button quiet" type="button" onClick={() => moveModule(module.id, 1)} disabled={index === modules.length - 1} aria-label="下移">
                    <ArrowDown size={14} />
                  </button>
                  <button className="icon-button quiet" type="button" onClick={() => removeModule(module.id)} aria-label="删除模块">
                    <Trash2 size={14} />
                  </button>
                </div>
                {!collapsed ? (
                  <div className="solution-module-detail" id={detailId}>
                    <textarea
                      value={module.description}
                      placeholder="模块职责说明"
                      onChange={(event) => updateModule(module.id, { description: event.target.value })}
                    />
                    {module.reason || module.sourceRefs?.length ? (
                      <p>{module.reason}{module.sourceRefs?.length ? ` · ${module.sourceRefs.join("、")}` : ""}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>
              );
            })}
          </div>
          <div className="solution-actions-row">
            <button className="text-button" type="button" onClick={addModule}>
              <Plus size={14} />
              新增模块
            </button>
            <button className="tool-button primary" type="button" onClick={generateSections} disabled={modules.length === 0 || busy}>
              {status === "generating" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
              生成规划
            </button>
          </div>
        </SolutionSection>

        <section className="solution-block">
          <div className="solution-block-title">
            <strong>规划结果</strong>
            <div className="solution-block-title-actions">
              <span>{generatedBlocks.length ? `${generatedBlocks.length} 个模块` : "待生成"}</span>
              {generatedBlocks.length ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => insertGeneratedText(buildAllGeneratedModulesInsert(selectedGroup, generatedBlocks, styleSelections), "已插入全部写作规划")}
                  disabled={busy}
                >
                  {status === "inserting" ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  全部插入规划
                </button>
              ) : null}
            </div>
          </div>
          {generatedBlocks.length === 0 ? (
            <div className="empty-state compact">生成后的模块写作规划会出现在这里</div>
          ) : (
            <div className="solution-generated-list">
              {generatedBlocks.map((block, moduleIndex) => {
                const moduleTitle = stripHeadingNumber(block.moduleName);
                const moduleStyleLabel = getStyleLabel(resolveParagraphStyle("module-heading", selectedGroup?.level, styleSelections), styleOptions);
                return (
                  <article className="solution-generated-card" key={block.moduleId || `${block.moduleName}-${moduleIndex}`}>
                    <div className="solution-generated-head">
                      <span className="solution-generated-title">
                        <strong>{moduleTitle}</strong>
                        <em className="solution-style-badge">{moduleStyleLabel}</em>
                      </span>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => insertGeneratedText(buildGeneratedModuleInsert(selectedGroup, block, styleSelections), `已插入 ${block.moduleName} 写作规划`)}
                        disabled={busy}
                      >
                        {status === "inserting" ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        插入规划
                      </button>
                    </div>
                    <div className="solution-generated-sections">
                      {block.sections.map((section, sectionIndex) => {
                        const sectionLevel = Number(selectedGroup?.level || 0) + 1;
                        const sectionTitle = stripHeadingNumber(section.templateTitle || section.heading);
                        const sectionTemplate = getSectionTemplate(selectedGroup, section, sectionIndex);
                        const sectionStyleLabel = getStyleLabel(resolveParagraphStyle("section-heading", sectionLevel, styleSelections), styleOptions);
                        const bodyStyleLabel = getStyleLabel(resolveParagraphStyle("body", null, styleSelections), styleOptions);
                        return (
                          <section className="solution-generated-section" key={`${block.moduleId}-${section.templateTitle}-${sectionIndex}`}>
                            <div>
                              <span className="solution-generated-title">
                                <strong>{sectionTitle}</strong>
                                <em className="solution-style-badge">{sectionStyleLabel}</em>
                              </span>
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => insertGeneratedText(buildGeneratedSectionInsert(sectionTitle, section.content, selectedGroup?.level + 1, styleSelections, sectionTemplate, selectedGroup), `已插入 ${sectionTitle} 写作规划`)}
                                disabled={busy}
                              >
                                <Send size={13} />
                                插入规划
                              </button>
                            </div>
                            <p>
                              <em className="solution-style-badge body">{bodyStyleLabel}</em>
                              {section.content || "需结合项目资料补充该标题的写作要点。"}
                            </p>
                          </section>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
          </div>
        ) : activePlanPanel === "task-plan" ? (
          <TaskPlanningPanel
            outlineItems={outlineItems}
            rawOutlineCount={rawOutlineCount}
            busy={busy}
            status={status}
            knowledgeOptions={knowledgeOptions}
            onRefreshOutline={refreshOutline}
            onTaskPlanGenerated={setGeneratedTaskPlan}
          />
        ) : (
          <SolutionDraftingPanel
            taskPlan={generatedTaskPlan}
            knowledgeOptions={knowledgeOptions}
            onInsertText={onInsertText}
          />
        )}
      </div>

      {message ? <div className={status === "error" ? "solution-message error" : "solution-message"}>{message}</div> : null}
    </div>
  );
}

function SolutionSection({ title, summary, icon, collapsed, onToggle, className = "", children }) {
  return (
    <section className={["solution-block", className, collapsed ? "collapsed" : ""].filter(Boolean).join(" ")}>
      <button className="solution-section-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="solution-section-title">
          {icon}
          <strong>{title}</strong>
        </span>
        <span className="solution-section-summary">
          <em>{summary}</em>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>
      {collapsed ? null : children}
    </section>
  );
}

function KnowledgeScopeList({ title, bases, selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedNames = bases.filter((base) => selectedIds.includes(base.id)).map((base) => base.name);
  const summary = bases.length === 0
    ? "无可选知识库"
    : selectedNames.length > 0
      ? `已选 ${selectedNames.length} 个`
      : "未选择";

  function toggle(id) {
    const nextIds = selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
    onChange?.(nextIds);
  }

  return (
    <div className="solution-knowledge-group">
      <button
        className="solution-knowledge-dropdown"
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={bases.length === 0}
        aria-expanded={open}
      >
        <span>
          <strong>{title}</strong>
          <em>{summary}</em>
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && bases.length > 0 ? (
        <div className="solution-knowledge-menu">
          {bases.map((base) => (
            <label key={base.id}>
              <input type="checkbox" checked={selectedIds.includes(base.id)} onChange={() => toggle(base.id)} />
              <span title={base.name}>{base.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeOutlineItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, position) => ({
      ...item,
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : position,
      level: Number.isFinite(Number(item.level)) ? Number(item.level) : 0,
      title: String(item.displayTitle || item.title || "").trim(),
      styleName: String(item.styleName || "").trim(),
      styleSource: String(item.styleSource || "").trim(),
      styleRef: normalizeStyleRef(item.styleRef),
      bodyStyleName: String(item.bodyStyleName || "").trim(),
      bodyStyleSource: String(item.bodyStyleSource || "").trim(),
      bodyStyleRef: normalizeStyleRef(item.bodyStyleRef),
      bodyText: String(item.bodyText || "").trim(),
      bodyParagraphCount: normalizeBodyParagraphCount(item.bodyParagraphCount),
    }))
    .filter((item) => item.title && !item.isEmptyItem);
}

function normalizeDocumentStyles(styles) {
  const seen = new Set();
  return (Array.isArray(styles) ? styles : [])
    .map((style, index) => ({
      id: String(style?.id || style?.name || index),
      name: String(style?.name || style?.id || "").trim(),
    }))
    .filter((style) => {
      const key = style.name.toLowerCase();
      if (!style.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeBodyParagraphCount(value) {
  if (value == null || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function buildTemplateGroups(items) {
  return items
    .map((item, position) => {
      const childTemplates = [];
      for (let index = position + 1; index < items.length; index += 1) {
        const child = items[index];
        if (child.level <= item.level) break;
        if (child.level === item.level + 1) {
          childTemplates.push({
            index: child.index,
            title: stripHeadingNumber(child.title),
            level: child.level,
            styleName: child.styleName,
            styleSource: child.styleSource,
            styleRef: child.styleRef,
            bodyStyleName: normalizeBodyStyleName(child.bodyStyleName),
            bodyStyleSource: child.bodyStyleSource,
            bodyStyleRef: normalizeBodyStyleRef(child.bodyStyleRef),
          });
        }
      }
      const itemBodyStyleName = normalizeBodyStyleName(item.bodyStyleName);
      const itemBodyStyleRef = normalizeBodyStyleRef(item.bodyStyleRef);
      const firstBodyTemplate = childTemplates.find((child) => child.bodyStyleName);
      return {
        key: String(item.index),
        title: item.title,
        level: item.level,
        styleName: item.styleName,
        styleSource: item.styleSource,
        styleRef: item.styleRef,
        bodyStyleName: itemBodyStyleName || firstBodyTemplate?.bodyStyleName || "",
        bodyStyleSource: itemBodyStyleName ? item.bodyStyleSource : firstBodyTemplate?.bodyStyleSource || "",
        bodyStyleRef: itemBodyStyleRef || firstBodyTemplate?.bodyStyleRef || null,
        childTemplates,
      };
    })
    .filter((group) => group.childTemplates.length > 0);
}

function getRecommendedTemplateGroup(groups) {
  return groups.find((group) => /功能模块/.test(group.title))
    || groups.find((group) => /详细功能/.test(group.title))
    || groups[0];
}

function buildStyleMappingRows(group, documentStyles = []) {
  if (!group) return [];
  const sectionLevels = [...new Set(group.childTemplates.map((item) => Number(item.level)).filter((level) => Number.isFinite(level)))];
  return [
    {
      key: "module-heading",
      label: "模块标题",
      sample: group.title,
      defaultStyle: getDefaultStyleValueForTemplate(group.styleName, group.level, documentStyles),
    },
    ...sectionLevels.map((level) => {
      const sample = group.childTemplates.find((item) => Number(item.level) === level)?.title || `子标题 ${level + 1}`;
      const template = group.childTemplates.find((item) => Number(item.level) === level && item.styleName)
        || group.childTemplates.find((item) => Number(item.level) === level);
      return {
        key: getSectionStyleKey(level),
        label: "子标题",
        sample,
        defaultStyle: getDefaultStyleValueForTemplate(template?.styleName, level, documentStyles),
      };
    }),
    {
      key: "body",
      label: "正文描述",
      sample: "写作规划正文",
      defaultStyle: getDefaultBodyStyleValue(documentStyles, group.bodyStyleName),
    },
  ];
}

function buildStyleProbeRows(group, styleRows = [], styleSelections = {}) {
  if (!group) return [];
  return styleRows.map((row) => {
    const value = styleSelections[row.key] || row.defaultStyle;
    if (row.key === "module-heading") {
      return {
        ...row,
        type: "module-heading",
        level: group.level,
        value,
        capturedStyleName: group.styleName || "",
        capturedSource: group.styleSource || "",
      };
    }
    if (row.key === "body") {
      return {
        ...row,
        type: "body",
        level: null,
        value,
        capturedStyleName: group.bodyStyleName || "",
        capturedSource: group.bodyStyleSource || "",
      };
    }
    const levelMatch = /^section-heading-(.+)$/.exec(row.key);
    const level = levelMatch ? Number(levelMatch[1]) : null;
    const template = group.childTemplates.find((item) => Number(item.level) === Number(level) && item.styleName)
      || group.childTemplates.find((item) => Number(item.level) === Number(level));
    return {
      ...row,
      type: "section-heading",
      level,
      value,
      capturedStyleName: template?.styleName || "",
      capturedSource: template?.styleSource || "",
    };
  });
}

function StyleDebugPanel({ debug }) {
  const samples = Array.isArray(debug?.samples) ? debug.samples : [];
  const requestedTitles = Array.isArray(debug?.requestedTitles) ? debug.requestedTitles : [];
  return (
    <div className="solution-style-debug">
      <div>
        <span>探针</span>
        <em>
          段落 {debug?.paragraphCount ?? 0} 个 · 有文本 {debug?.nonEmptyParagraphCount ?? 0} 个
          {debug?.source ? ` · ${debug.source}` : ""}
          {debug?.error ? ` · ${debug.error}` : ""}
        </em>
      </div>
      {requestedTitles.length ? (
        <div>
          <span>待匹配</span>
          <em>{requestedTitles.map((item) => item.title).filter(Boolean).slice(0, 4).join(" / ")}</em>
        </div>
      ) : null}
      {samples.slice(0, 6).map((sample) => (
        <div key={`${sample.paragraphIndex}-${sample.text}`}>
          <span>#{sample.paragraphIndex}</span>
          <em>{sample.styleName || "无样式"} · {sample.text}</em>
        </div>
      ))}
    </div>
  );
}

function buildDefaultStyleSelections(group, documentStyles = []) {
  return Object.fromEntries(buildStyleMappingRows(group, documentStyles).map((row) => [row.key, row.defaultStyle]));
}

function getHeadingStyleValue(level) {
  const nextLevel = Math.max(1, Math.min(6, Number(level) + 1 || 1));
  return `heading-${nextLevel}`;
}

function getSectionStyleKey(level) {
  return `section-heading-${Number.isFinite(Number(level)) ? Number(level) : "default"}`;
}

function resolveParagraphStyle(type, level, styleSelections = {}) {
  if (type === "module-heading") return styleSelections["module-heading"] || getHeadingStyleValue(level);
  if (type === "section-heading") return styleSelections[getSectionStyleKey(level)] || getHeadingStyleValue(level);
  return styleSelections.body || "body";
}

function buildStyleOptions(documentStyles = []) {
  const wordOptions = documentStyles.map((style) => ({
    value: toWordStyleValue(style.name),
    label: `Word样式：${style.name}`,
  }));
  return [...wordOptions, ...SOLUTION_STYLE_OPTIONS];
}

function getStyleLabel(value, styleOptions = SOLUTION_STYLE_OPTIONS) {
  return styleOptions.find((option) => option.value === value)?.label || "正文";
}

function toWordStyleValue(name) {
  return `word-style:${String(name || "").trim()}`;
}

function findDocumentStyleByPatterns(documentStyles, patterns) {
  return documentStyles.find((style) => patterns.some((pattern) => pattern.test(style.name)));
}

function findExactDocumentStyle(documentStyles, styleName) {
  const wanted = String(styleName || "").trim().toLowerCase();
  return wanted ? documentStyles.find((style) => style.name.toLowerCase() === wanted) : null;
}

function getDefaultStyleValueForTemplate(styleName, level, documentStyles = []) {
  const exactTemplateStyle = findExactDocumentStyle(documentStyles, styleName);
  if (exactTemplateStyle) return toWordStyleValue(exactTemplateStyle.name);
  return getDefaultStyleValueForLevel(level, documentStyles);
}

function getDefaultStyleValueForLevel(level, documentStyles = []) {
  const fallback = getHeadingStyleValue(level);
  const headingLevel = Math.max(1, Math.min(6, Number(level) + 1 || 1));
  const exact = findDocumentStyleByPatterns(documentStyles, [
    new RegExp(`^标题\\s*${headingLevel}$`, "i"),
    new RegExp(`^heading\\s*${headingLevel}$`, "i"),
  ]);
  return exact ? toWordStyleValue(exact.name) : fallback;
}

function getDefaultBodyStyleValue(documentStyles = [], bodyStyleName = "") {
  const exactTemplateStyle = findExactDocumentStyle(documentStyles, bodyStyleName);
  if (exactTemplateStyle) return toWordStyleValue(exactTemplateStyle.name);
  const exact = findDocumentStyleByPatterns(documentStyles, [/^正文$/i, /^normal$/i]);
  return exact ? toWordStyleValue(exact.name) : "body";
}

function getStyleFallback(value, type, level) {
  if (String(value || "").startsWith("word-style:")) {
    if (type === "module-heading") return getHeadingStyleValue(level);
    if (type === "section-heading") return getHeadingStyleValue(level);
    return "body";
  }
  return value || "body";
}

function getStyleName(value) {
  const raw = String(value || "");
  return raw.startsWith("word-style:") ? raw.slice("word-style:".length) : "";
}

function buildAllGeneratedModulesInsert(group, blocks, styleSelections = {}) {
  const items = (Array.isArray(blocks) ? blocks : []).map((block) => buildGeneratedModuleInsert(group, block, styleSelections));
  return {
    text: items.map((item) => item.text).filter(Boolean).join("\n\n"),
    paragraphs: items.flatMap((item, index) => (
      index === 0 ? item.paragraphs : [{ type: "blank", text: "" }, ...item.paragraphs]
    )),
  };
}

function buildGeneratedModuleInsert(group, block, styleSelections = {}) {
  const moduleTitle = stripHeadingNumber(block.moduleName);
  const moduleLevel = Number.isFinite(Number(group?.level)) ? Number(group.level) : 1;
  const moduleStyle = resolveParagraphStyle("module-heading", moduleLevel, styleSelections);
  const moduleStyleRef = getSelectedStyleRef(group?.styleRef, moduleStyle, group?.styleName);
  const paragraphs = [{
    type: "module-heading",
    level: moduleLevel,
    style: moduleStyle,
    styleName: getStyleName(moduleStyle),
    styleFallback: getStyleFallback(moduleStyle, "module-heading", moduleLevel),
    styleRef: moduleStyleRef,
    text: moduleTitle,
  }];
  block.sections.forEach((section, sectionIndex) => {
    const title = stripHeadingNumber(section.templateTitle || section.heading);
    const template = getSectionTemplate(group, section, sectionIndex);
    paragraphs.push(...buildGeneratedSectionInsert(title, section.content, Number(group?.level || 0) + 1, styleSelections, template, group).paragraphs);
  });
  return paragraphsToInsertPayload(paragraphs);
}

function buildGeneratedSectionInsert(title, content, level = 2, styleSelections = {}, template = null, bodyTemplate = null) {
  const sectionLevel = Number.isFinite(Number(level)) ? Number(level) : 2;
  const bodyLines = splitBodyParagraphs(content || "需结合项目资料补充该标题的写作要点。");
  const headingStyle = resolveParagraphStyle("section-heading", sectionLevel, styleSelections);
  const bodyStyle = resolveParagraphStyle("body", null, styleSelections);
  const headingStyleRef = getSelectedStyleRef(template?.styleRef, headingStyle, template?.styleName);
  const bodyStyleRef = getSelectedStyleRef(
    normalizeBodyStyleRef(bodyTemplate?.bodyStyleRef),
    bodyStyle,
    normalizeBodyStyleName(bodyTemplate?.bodyStyleName),
  );
  return paragraphsToInsertPayload([
    {
      type: "section-heading",
      level: sectionLevel,
      style: headingStyle,
      styleName: getStyleName(headingStyle),
      styleFallback: getStyleFallback(headingStyle, "section-heading", sectionLevel),
      styleRef: headingStyleRef,
      text: title,
    },
    ...bodyLines.map((text) => ({
      type: "body",
      style: bodyStyle,
      styleName: getStyleName(bodyStyle),
      styleFallback: getStyleFallback(bodyStyle, "body", null),
      styleRef: bodyStyleRef,
      text,
    })),
  ]);
}

function paragraphsToInsertPayload(paragraphs) {
  const normalized = (Array.isArray(paragraphs) ? paragraphs : [])
    .map((paragraph) => ({
      type: paragraph.type || "body",
      level: Number.isFinite(Number(paragraph.level)) ? Number(paragraph.level) : null,
      style: paragraph.style || "",
      styleName: paragraph.styleName || "",
      styleFallback: paragraph.styleFallback || "",
      styleRef: normalizeStyleRef(paragraph.styleRef),
      text: String(paragraph.text || ""),
    }))
    .filter((paragraph) => paragraph.text || paragraph.type === "blank");
  return {
    text: normalized.map((paragraph) => paragraph.text).join("\n").trim(),
    paragraphs: normalized,
  };
}

function normalizeStyleRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const paragraphIndex = Number(ref.paragraphIndex);
  return Number.isFinite(paragraphIndex)
    ? {
      paragraphIndex,
      outlineIndex: Number.isFinite(Number(ref.outlineIndex)) ? Number(ref.outlineIndex) : null,
      title: String(ref.title || "").trim(),
      text: String(ref.text || "").trim(),
      level: Number.isFinite(Number(ref.level)) ? Number(ref.level) : null,
      styleName: String(ref.styleName || "").trim(),
    }
    : null;
}

function normalizeBodyStyleName(styleName) {
  const value = String(styleName || "").trim();
  return isHeadingStyleName(value) ? "" : value;
}

function normalizeBodyStyleRef(ref) {
  const normalized = normalizeStyleRef(ref);
  return normalized && !isHeadingStyleName(normalized.styleName) ? normalized : null;
}

function isHeadingStyleName(styleName) {
  return /heading\s*\d|标题\s*\d|标题\d/i.test(String(styleName || ""));
}

function getSelectedStyleRef(ref, selectedStyle, referenceStyleName) {
  const normalized = normalizeStyleRef(ref);
  if (!normalized) return null;
  const selectedName = getStyleName(selectedStyle);
  if (!selectedName) return null;
  return selectedName.toLowerCase() === String(referenceStyleName || normalized.styleName || "").trim().toLowerCase()
    ? normalized
    : null;
}

function getSectionTemplate(group, section, sectionIndex) {
  const title = stripHeadingNumber(section?.templateTitle);
  return group?.childTemplates?.find((item) => stripHeadingNumber(item.title) === title)
    || group?.childTemplates?.[sectionIndex]
    || null;
}

function normalizeInsertPayload(content) {
  if (content && typeof content === "object") return paragraphsToInsertPayload(content.paragraphs || []);
  const text = String(content || "").trim();
  return {
    text,
    paragraphs: text.split(/\n+/).map((line) => ({ type: "body", style: "body", styleFallback: "body", text: line.trim() })).filter((line) => line.text),
  };
}

function splitBodyParagraphs(content) {
  return String(content || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripHeadingNumber(title) {
  return String(title || "")
    .replace(/^(?:\d+\.\d+(?:\.\d+)*\s*|\d+[、.．\s]+|[一二三四五六七八九十]+[、.．\s]+)/, "")
    .replace(/^[（(](?:\d+|[一二三四五六七八九十]+)[）)]\s*/, "")
    .trim();
}

export default SolutionWritingPanel;

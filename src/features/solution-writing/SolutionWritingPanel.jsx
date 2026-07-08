import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileText, Loader2, Plus, RefreshCw, Save, Send, Trash2, Wand2 } from "lucide-react";
import { generateSolutionModuleSections, identifySolutionModules } from "./service.js";

function SolutionWritingPanel({
  outline,
  saveState,
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
  onSaveTemplate,
}) {
  const [localOutline, setLocalOutline] = useState(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [userInstruction, setUserInstruction] = useState("");
  const [modules, setModules] = useState([]);
  const [generatedBlocks, setGeneratedBlocks] = useState([]);
  const [draftText, setDraftText] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const effectiveOutline = localOutline || outline;
  const rawOutlineCount = Array.isArray(effectiveOutline?.items) ? effectiveOutline.items.length : 0;
  const outlineItems = useMemo(() => normalizeOutlineItems(effectiveOutline?.items), [effectiveOutline]);
  const templateGroups = useMemo(() => buildTemplateGroups(outlineItems), [outlineItems]);
  const selectedGroup = templateGroups.find((group) => group.key === selectedGroupKey) || templateGroups[0] || null;
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
      setModules(result.modules || []);
      setGeneratedBlocks([]);
      setDraftText("");
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
      const text = composeSolutionText(selectedGroup, nextBlocks);
      setGeneratedBlocks(nextBlocks);
      setDraftText(text);
      setStatus("idle");
      setMessage(nextBlocks.length ? `已生成 ${nextBlocks.length} 个模块章节，可编辑后写入当前光标。` : "没有可生成的模块。");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "方案章节生成失败");
    }
  }

  async function insertDraftText() {
    const text = draftText.trim();
    if (!text) return;
    setStatus("inserting");
    setMessage("");
    const result = await onInsertText?.(text);
    if (result?.ok) {
      setStatus("idle");
      setMessage("已写入当前光标位置");
      return;
    }
    setStatus("error");
    setMessage(result?.error || "写入失败，请确认左侧文档已加载并把光标放在目标位置。");
  }

  function addModule() {
    setModules((current) => [
      ...current,
      { id: `SOL-M${String(current.length + 1).padStart(3, "0")}-${Date.now()}`, name: "新功能模块", description: "", reason: "", sourceRefs: [] },
    ]);
  }

  function updateModule(moduleId, patch) {
    setModules((current) => current.map((module) => (module.id === moduleId ? { ...module, ...patch } : module)));
  }

  function removeModule(moduleId) {
    setModules((current) => current.filter((module) => module.id !== moduleId));
    setGeneratedBlocks((current) => current.filter((block) => block.moduleId !== moduleId));
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

  const busy = ["loading-outline", "identifying", "generating", "inserting"].includes(status);

  return (
    <div className="panel-section solution-writing-panel standalone">
      <div className="panel-title">
        <h2>方案编写</h2>
        <div className="panel-actions">
          <button className="text-button" type="button" onClick={refreshOutline} disabled={busy}>
            {status === "loading-outline" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            读取大纲
          </button>
          <button className="text-button" type="button" onClick={onSaveTemplate} disabled={saveState === "saving"}>
            {saveState === "saving" ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            保存模板
          </button>
        </div>
      </div>

      <div className="solution-writing-scroll">
        <section className="solution-block">
          <div className="solution-block-title">
            <FileText size={15} />
            <strong>章节模板</strong>
            <span>{templateGroups.length ? `模板组 ${templateGroups.length} 个` : "未读取大纲"}</span>
          </div>
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
            </>
          ) : null}
        </section>

        <section className="solution-block">
          <div className="solution-block-title">
            <strong>知识库范围</strong>
            <span>{selectedKnowledgeBases.length ? `已选 ${selectedKnowledgeBases.length} 个` : "未选择"}</span>
          </div>
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
        </section>

        <section className="solution-block">
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
        </section>

        <section className="solution-block grow">
          <div className="solution-block-title">
            <strong>模块清单</strong>
            <span>{modules.length} 个</span>
          </div>
          <div className="solution-module-list">
            {modules.length === 0 ? (
              <div className="empty-state compact">先识别或手动新增功能模块</div>
            ) : modules.map((module, index) => (
              <article className="solution-module-card" key={module.id}>
                <div className="solution-module-head">
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
                <textarea
                  value={module.description}
                  placeholder="模块职责说明"
                  onChange={(event) => updateModule(module.id, { description: event.target.value })}
                />
                {module.reason || module.sourceRefs?.length ? (
                  <p>{module.reason}{module.sourceRefs?.length ? ` · ${module.sourceRefs.join("、")}` : ""}</p>
                ) : null}
              </article>
            ))}
          </div>
          <div className="solution-actions-row">
            <button className="text-button" type="button" onClick={addModule}>
              <Plus size={14} />
              新增模块
            </button>
            <button className="tool-button primary" type="button" onClick={generateSections} disabled={modules.length === 0 || busy}>
              {status === "generating" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
              生成章节
            </button>
          </div>
        </section>

        <section className="solution-block">
          <div className="solution-block-title">
            <strong>生成结果</strong>
            <span>{generatedBlocks.length ? `${generatedBlocks.length} 个模块` : "待生成"}</span>
          </div>
          <textarea
            className="solution-draft-text"
            value={draftText}
            placeholder="生成后的方案正文会出现在这里，可人工编辑后写入当前光标。"
            onChange={(event) => setDraftText(event.target.value)}
          />
          <button className="tool-button primary full-width" type="button" onClick={insertDraftText} disabled={!draftText.trim() || busy}>
            {status === "inserting" ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            写入当前光标
          </button>
        </section>
      </div>

      {message ? <div className={status === "error" ? "solution-message error" : "solution-message"}>{message}</div> : null}
    </div>
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
    }))
    .filter((item) => item.title && !item.isEmptyItem);
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
            number: parseHeadingNumber(child.title),
          });
        }
      }
      return {
        key: String(item.index),
        title: item.title,
        number: parseHeadingNumber(item.title),
        level: item.level,
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

function composeSolutionText(group, blocks) {
  return blocks
    .map((block, moduleIndex) => {
      const moduleNumber = nextSiblingNumber(group.number, moduleIndex);
      const lines = [`${moduleNumber ? `${moduleNumber} ` : ""}${block.moduleName}`.trim()];
      block.sections.forEach((section, sectionIndex) => {
        const headingNumber = moduleNumber ? `${moduleNumber}.${sectionIndex + 1}` : "";
        lines.push("", `${headingNumber ? `${headingNumber} ` : ""}${stripHeadingNumber(section.heading || section.templateTitle)}`.trim(), section.content || "需结合项目资料补充。");
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

function parseHeadingNumber(title) {
  return String(title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
}

function stripHeadingNumber(title) {
  return String(title || "").replace(/^\d+(?:\.\d+)*\s*/, "").trim();
}

function nextSiblingNumber(baseNumber, offset) {
  if (!baseNumber) return "";
  const parts = baseNumber.split(".");
  const last = Number(parts[parts.length - 1]);
  if (!Number.isFinite(last)) return "";
  parts[parts.length - 1] = String(last + offset);
  return parts.join(".");
}

export default SolutionWritingPanel;

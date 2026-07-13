import React, { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, Send, Wand2 } from "lucide-react";
import { generateSolutionDraftContent } from "./service.js";
import { buildDraftSectionInsert, buildDraftSectionsInsert, groupDraftSectionsByTarget } from "./draftInsert.js";

function buildDescendingInsertPayloads(groups) {
  return groups
    .map(buildDraftSectionsInsert)
    .sort((left, right) => {
      const leftIndex = Number(left?.replaceTarget?.styleRef?.paragraphIndex);
      const rightIndex = Number(right?.replaceTarget?.styleRef?.paragraphIndex);
      if (!Number.isFinite(leftIndex)) return Number.isFinite(rightIndex) ? 1 : 0;
      if (!Number.isFinite(rightIndex)) return -1;
      return rightIndex - leftIndex;
    });
}

function SolutionDraftingPanel({ taskPlan, knowledgeOptions, onInsertText, onDocumentMutated }) {
  const [globalPrompt, setGlobalPrompt] = useState("你是一名资深政企技术方案编制专家，文档类型为正式技术方案，表达需要专业、稳健、可落地。");
  const [draft, setDraft] = useState(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState([]);
  const [expandedSectionIds, setExpandedSectionIds] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function generateDraft() {
    if (!taskPlan?.categories?.length) return;
    setStatus("generating");
    setMessage("");
    try {
      const result = await generateSolutionDraftContent({
        taskPlan,
        globalPrompt,
        knowledgeOptions,
      });
      setDraft(result);
      setCollapsedCategoryIds([]);
      setExpandedSectionIds([]);
      setStatus("idle");
      setMessage(`已生成 ${result.stats?.sectionCount || 0} 段方案内容`);
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "方案编制生成失败");
    }
  }

  const taskCount = taskPlan?.stats?.taskCount
    || taskPlan?.categories?.reduce((sum, category) => sum + (category.tasks?.length || 0), 0)
    || 0;
  const busy = status === "generating" || status === "inserting";
  const inserting = status === "inserting";

  function toggleCategory(categoryId) {
    setCollapsedCategoryIds((current) => (
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    ));
  }

  function toggleSection(sectionId) {
    setExpandedSectionIds((current) => (
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId]
    ));
  }

  async function insertSection(section, successMessage) {
    const payload = buildDraftSectionInsert(section);
    return insertPayloads([payload], successMessage || `已写入 ${section.title || section.sourceHeading}`);
  }

  async function insertCategory(category) {
    const payloads = buildDescendingInsertPayloads(groupDraftSectionsByTarget(category.sections || []));
    return insertPayloads(payloads, `已写入 ${category.title}`);
  }

  async function insertAllDraft() {
    const groups = (draft?.categories || []).flatMap((category) => groupDraftSectionsByTarget(category.sections || []));
    return insertPayloads(buildDescendingInsertPayloads(groups), "已写入全部方案内容");
  }

  async function insertPayloads(payloads, successMessage) {
    const rows = (Array.isArray(payloads) ? payloads : []).filter((payload) => payload?.text);
    if (!rows.length) return false;
    setStatus("inserting");
    setMessage("");
    let mutated = false;
    let failure = null;
    try {
      for (const payload of rows) {
        const result = await onInsertText?.(payload.text, {
          paragraphs: payload.paragraphs,
          replaceTarget: payload.replaceTarget,
          timeoutMs: 20000,
        });
        mutated = mutated || Boolean(result?.ok || result?.partial);
        if (!result?.ok) {
          failure = result || { error: "写入失败：未匹配到对应标题" };
          break;
        }
      }
    } catch (error) {
      failure = { error: error?.message || "写入失败：未匹配到对应标题" };
    }

    if (mutated) {
      setDraft(null);
      onDocumentMutated?.();
    }
    if (!failure) {
      setStatus("idle");
      setMessage(successMessage);
      return true;
    }
    setStatus("error");
    setMessage(failure.error || "写入失败：未匹配到对应标题");
    return false;
  }

  return (
    <div className="solution-draft-panel">
      <section className="solution-block">
        <div className="solution-task-toolbar">
          <div>
            <strong>方案编制</strong>
            <span>承接任务规划结果，将执行任务转写为方案正文草稿</span>
          </div>
          <div className="solution-task-actions">
            <button className="tool-button primary" type="button" onClick={generateDraft} disabled={busy || taskCount === 0}>
              {busy ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
              生成方案内容
            </button>
            {draft?.categories?.length ? (
              <button className="text-button" type="button" onClick={insertAllDraft} disabled={busy || inserting}>
                {inserting ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                全部写入
              </button>
            ) : null}
          </div>
        </div>

        <div className="solution-task-stats">
          <span>承接任务 {taskCount} 个</span>
          <span>任务类别 {taskPlan?.categories?.length || 0} 个</span>
          <span>知识库 {knowledgeOptions?.bases?.length || 0} 个</span>
        </div>

        <label className="solution-instruction">
          <span>全局提示词</span>
          <textarea
            value={globalPrompt}
            placeholder="输入 AI 角色充当、文档类型、背景设定、语气要求等。"
            onChange={(event) => setGlobalPrompt(event.target.value)}
          />
        </label>
        {message ? <div className={status === "error" ? "solution-message error" : "solution-message"}>{message}</div> : null}
      </section>

      {!taskCount ? (
        <section className="solution-block">
          <div className="empty-state compact">请先在任务规划模块生成任务，再进行方案编制。</div>
        </section>
      ) : null}

      {draft?.categories?.length ? (
        <div className="solution-task-category-list">
          {draft.categories.map((category) => {
            const categoryId = category.id || category.sourceHeading || category.title;
            const collapsed = collapsedCategoryIds.includes(categoryId);
            return (
              <section className="solution-task-category" key={categoryId}>
                <button
                  className="solution-task-category-head"
                  type="button"
                  onClick={() => toggleCategory(categoryId)}
                  aria-expanded={!collapsed}
                >
                  <span>
                    <strong>{category.title}</strong>
                    <em>{category.sections?.length || 0} 段内容 · 来源 {category.sourceHeading}</em>
                  </span>
                  {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                {collapsed ? null : (
                  <div className="solution-task-category-body">
                    <div className="solution-task-actions">
                      <button className="text-button" type="button" onClick={() => insertCategory(category)} disabled={busy || inserting}>
                        {inserting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        写入本类
                      </button>
                    </div>
                    <div className="solution-task-list">
                      {(category.sections || []).map((section) => {
                        const sectionId = section.id || `${categoryId}-${section.sourceHeading}-${section.title}`;
                        const expanded = expandedSectionIds.includes(sectionId);
                        return (
                          <article className={expanded ? "solution-task-card expanded" : "solution-task-card"} key={sectionId}>
                            <button className="solution-task-card-head" type="button" onClick={() => toggleSection(sectionId)} aria-expanded={expanded}>
                              <span>
                                <strong>{section.title}</strong>
                                <em><FileText size={13} />{section.sourceHeading}</em>
                              </span>
                              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                            {expanded ? (
                              <div className="solution-task-detail">
                                <div className="solution-task-info-row">
                                  <strong>写入位置</strong>
                                  <span>{section.replaceTarget?.title || section.sourceHeading || "未匹配到标题引用"}</span>
                                </div>
                                <div className="solution-task-info-row">
                                  <strong>正文内容</strong>
                                  <span>{section.content}</span>
                                </div>
                                <div className="solution-task-actions">
                                  <button className="text-button" type="button" onClick={() => insertSection(section)} disabled={busy || inserting}>
                                    {inserting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                                    写入本段
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default SolutionDraftingPanel;

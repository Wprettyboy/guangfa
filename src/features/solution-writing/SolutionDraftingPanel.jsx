import React, { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { generateSolutionDraftContent } from "./service.js";

function SolutionDraftingPanel({ taskPlan, knowledgeOptions }) {
  const [globalPrompt, setGlobalPrompt] = useState("你是一名资深政企技术方案编制专家，文档类型为正式技术方案，表达需要专业、稳健、可落地。");
  const [draft, setDraft] = useState(null);
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
  const busy = status === "generating";

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
        <div className="solution-draft-list">
          {draft.categories.map((category) => (
            <section className="solution-task-category" key={category.id || category.sourceHeading || category.title}>
              <div className="solution-block-title">
                <strong>{category.title}</strong>
                <span>{category.sections?.length || 0} 段内容</span>
              </div>
              <div className="solution-draft-section-list">
                {(category.sections || []).map((section) => (
                  <article className="solution-generated-section" key={section.id || section.sourceHeading || section.title}>
                    <div>
                      <strong>{section.title}</strong>
                      <span className="solution-style-badge">{section.sourceHeading}</span>
                    </div>
                    <p>{section.content}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default SolutionDraftingPanel;

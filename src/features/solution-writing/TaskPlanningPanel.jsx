import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, RefreshCw, Send, Wand2 } from "lucide-react";
import { generateSolutionTaskPlan } from "./service.js";
import { buildTaskPlanningPreview } from "./taskPlanning.js";

function TaskPlanningPanel({
  outlineItems = [],
  rawOutlineCount = 0,
  busy = false,
  status = "idle",
  onRefreshOutline,
}) {
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState(() => ({ categories: [], stats: buildTaskPlanningPreview([]).stats }));
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState([]);
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const [taskStatus, setTaskStatus] = useState("idle");
  const [taskMessage, setTaskMessage] = useState("");
  const outlinePreview = useMemo(() => buildTaskPlanningPreview(outlineItems), [outlineItems]);
  const outlineStats = outlinePreview.stats;

  function generatePreview() {
    const nextPreview = buildTaskPlanningPreview(outlineItems);
    setPreview(nextPreview);
    setGeneratedPlan(null);
    setTaskMessage("");
    setCollapsedCategoryIds([]);
    setExpandedTaskIds([]);
  }

  async function generateAiPlan() {
    const inputPreview = preview.categories.length ? preview : buildTaskPlanningPreview(outlineItems);
    if (!inputPreview.categories.length) return;
    setTaskStatus("generating");
    setTaskMessage("");
    try {
      const result = await generateSolutionTaskPlan({
        outlineText: inputPreview.outlineText || outlinePreview.outlineText,
        categories: inputPreview.categories,
        userInstruction: instruction,
      });
      setGeneratedPlan(result);
      setPreview({ categories: result.categories || [], stats: inputPreview.stats, outlineText: inputPreview.outlineText });
      setCollapsedCategoryIds([]);
      setExpandedTaskIds([]);
      setTaskStatus("idle");
      setTaskMessage(`已生成 ${result.stats?.taskCount || 0} 个任务规划`);
    } catch (error) {
      setTaskStatus("error");
      setTaskMessage(error?.message || "任务规划生成失败");
    }
  }

  function toggleCategory(categoryId) {
    setCollapsedCategoryIds((current) => (
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    ));
  }

  function toggleTask(taskId) {
    setExpandedTaskIds((current) => (
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    ));
  }

  const hasOutline = outlineItems.length > 0;
  const generatingDisabled = busy || !hasOutline;
  const aiGenerating = taskStatus === "generating";
  const hasPreview = preview.categories.length > 0;

  return (
    <div className="solution-task-panel">
      <section className="solution-block">
        <div className="solution-task-toolbar">
          <div>
            <strong>任务规划</strong>
            <span>完整大纲作全局架构约束，当前标题加标题下原文作为生成单元</span>
          </div>
          <div className="solution-task-actions">
            <button className="text-button" type="button" onClick={onRefreshOutline} disabled={busy}>
              {status === "loading-outline" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              读取方案内容
            </button>
            <button className="tool-button primary" type="button" onClick={generatePreview} disabled={generatingDisabled}>
              <Wand2 size={15} />
              生成输入预览
            </button>
            <button className="tool-button primary" type="button" onClick={generateAiPlan} disabled={busy || aiGenerating || (!hasPreview && !hasOutline)}>
              {aiGenerating ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
              AI生成规划
            </button>
          </div>
        </div>

        <div className="solution-task-stats">
          <span>有效标题 {outlineItems.length} 个</span>
          <span>原始返回 {rawOutlineCount} 个</span>
          <span>任务类别 {outlineStats.categoryCount} 个</span>
          <span>预计任务 {outlineStats.taskCount} 个</span>
          <span>最大层级 {outlineStats.maxDepth || 0}</span>
        </div>

        <div className={architectureOpen ? "solution-task-architecture open" : "solution-task-architecture"}>
          <button type="button" onClick={() => setArchitectureOpen((current) => !current)} aria-expanded={architectureOpen}>
            <span>
              <strong>全局大纲架构</strong>
              <em>后续生成每个标题任务时，完整大纲都会作为结构约束传给 AI。</em>
            </span>
            {architectureOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          {architectureOpen ? <pre>{outlinePreview.outlineText || "请先读取左侧文档大纲。"}</pre> : null}
        </div>

        <label className="solution-instruction">
          <span>规划补充要求</span>
          <textarea
            value={instruction}
            placeholder="例如：偏项目实施任务，任务需要体现交付物、前置依赖和验收关注点。"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        {taskMessage ? <div className={taskStatus === "error" ? "solution-message error" : "solution-message"}>{taskMessage}</div> : null}
        {generatedPlan?.warnings?.length ? (
          <div className="solution-task-warnings">
            {generatedPlan.warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : null}
      </section>

      {preview.categories.length === 0 ? (
        <section className="solution-block">
          <div className="empty-state compact">
            {hasOutline ? "点击生成输入预览，查看后续传给 AI 的任务规划结构。" : "请先读取左侧文档大纲。"}
          </div>
        </section>
      ) : (
        <div className="solution-task-category-list">
          {preview.categories.map((category) => {
            const collapsed = collapsedCategoryIds.includes(category.id);
            return (
              <section className="solution-task-category" key={category.id}>
                <button
                  className="solution-task-category-head"
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-expanded={!collapsed}
                >
                  <span>
                    <strong>{category.title}</strong>
                    <em>{category.tasks.length} 个任务 · 来源 {category.sourceHeading}</em>
                  </span>
                  {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                {collapsed ? null : (
                  <div className="solution-task-category-body">
                    <div className="solution-task-boundary">
                      <span>
                        <strong>写什么</strong>
                        <em>{category.boundary.include}</em>
                      </span>
                      <span>
                        <strong>不写什么</strong>
                        <em>{category.boundary.exclude}</em>
                      </span>
                      <span>
                        <strong>上下文规则</strong>
                        <em>{category.contextRule}</em>
                      </span>
                    </div>
                    <div className="solution-task-list">
                      {category.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          expanded={expandedTaskIds.includes(task.id)}
                          onToggle={() => toggleTask(task.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, expanded, onToggle }) {
  return (
    <article className={expanded ? "solution-task-card expanded" : "solution-task-card"}>
      <button className="solution-task-card-head" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span>
          <strong>{task.title}</strong>
          <em><FileText size={13} />{task.sourceHeading} · {task.bodyState}</em>
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {expanded ? (
        <div className="solution-task-detail">
          <InfoRow label="对应原文" value={task.sourceText} />
          <ListRow label="AI要干什么" values={getAiWorkItems(task)} />
          <ListRow label="约束是什么" values={getTaskConstraints(task)} />
          {task.planningSummary ? <InfoRow label="AI规划摘要" value={task.planningSummary} /> : null}
          <ListRow label="交付物" values={task.deliverables} />
        </div>
      ) : null}
    </article>
  );
}

function getAiWorkItems(task) {
  return [
    task.objective,
    ...(Array.isArray(task.executionPoints) ? task.executionPoints : []),
  ].filter(Boolean);
}

function getTaskConstraints(task) {
  return [
    ...(Array.isArray(task.exclusiveBoundary?.include) ? task.exclusiveBoundary.include.map((item) => `范围：${item}`) : []),
    ...(Array.isArray(task.exclusiveBoundary?.exclude) ? task.exclusiveBoundary.exclude.map((item) => `排除：${item}`) : []),
    ...(Array.isArray(task.exclusiveBoundary?.handoffToChildren) ? task.exclusiveBoundary.handoffToChildren.map((item) => `下沉：${item}`) : []),
    task.previousPlanSummary ? `上下文：${task.previousPlanSummary}` : "",
  ].filter(Boolean);
}

function InfoRow({ label, value }) {
  return (
    <div className="solution-task-info-row">
      <strong>{label}</strong>
      <span>{value || "无"}</span>
    </div>
  );
}

function ListRow({ label, values = [], emptyText = "无" }) {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  return (
    <div className="solution-task-info-row">
      <strong>{label}</strong>
      <span>{rows.length ? rows.join("；") : emptyText}</span>
    </div>
  );
}

export default TaskPlanningPanel;

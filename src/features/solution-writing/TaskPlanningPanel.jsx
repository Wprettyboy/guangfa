import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, RefreshCw, Wand2 } from "lucide-react";
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
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState([]);
  const outlineStats = useMemo(() => buildTaskPlanningPreview(outlineItems).stats, [outlineItems]);

  function generatePreview() {
    const nextPreview = buildTaskPlanningPreview(outlineItems);
    setPreview(nextPreview);
    setCollapsedCategoryIds([]);
    setExpandedTaskIds([]);
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

  return (
    <div className="solution-task-panel">
      <section className="solution-block">
        <div className="solution-task-toolbar">
          <div>
            <strong>任务规划</strong>
            <span>按一级标题分类，所有下级标题至少生成一个执行任务</span>
          </div>
          <div className="solution-task-actions">
            <button className="text-button" type="button" onClick={onRefreshOutline} disabled={busy}>
              {status === "loading-outline" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              读取方案内容
            </button>
            <button className="tool-button primary" type="button" onClick={generatePreview} disabled={generatingDisabled}>
              <Wand2 size={15} />
              生成前端预览
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

        <label className="solution-instruction">
          <span>规划补充要求</span>
          <textarea
            value={instruction}
            placeholder="例如：偏项目实施任务，任务需要体现交付物、前置依赖和验收关注点。"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      </section>

      {preview.categories.length === 0 ? (
        <section className="solution-block">
          <div className="empty-state compact">
            {hasOutline ? "点击生成前端预览，查看任务规划结构。" : "请先读取左侧文档大纲。"}
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
          <InfoRow label="标题路径" value={task.headingPath.join(" / ")} />
          <InfoRow label="任务目标" value={task.objective} />
          <InfoRow label="上下文承接" value={task.previousContextUsed} />
          <ListRow label="写什么" values={task.exclusiveBoundary.include} />
          <ListRow label="不写什么" values={task.exclusiveBoundary.exclude} />
          <ListRow label="下沉给子标题" values={task.exclusiveBoundary.handoffToChildren} emptyText="无下级标题承接" />
          <ListRow label="执行要点" values={task.executionPoints} />
          <ListRow label="交付物" values={task.deliverables} />
          <ListRow label="依赖任务" values={task.dependsOn} emptyText="无前置任务" />
          <ListRow label="产出给后续" values={task.produces} />
        </div>
      ) : null}
    </article>
  );
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

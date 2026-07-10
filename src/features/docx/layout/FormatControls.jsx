import React from "react";
import { Check, ClipboardCheck, Download, FileText, Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { groupFindingsByDomain } from "./analyzer/report.js";

function FormatControls({
  standard,
  report,
  plan,
  analysisReady,
  selectedFindingIds,
  busy,
  hasDocument,
  status,
  result,
  onToggleFinding,
  onSelectFixable,
  onAnalyze,
  onPreviewPlan,
  onApply,
  onExport,
}) {
  const grouped = groupFindingsByDomain(report.findings, standard.domains);
  const selectedCount = selectedFindingIds.length;
  const fixableCount = analysisReady
    ? report.findings.filter((item) => item.fixable && item.status !== "blocked").length
    : 0;
  return (
    <aside className="right-panel field-panel layout-panel">
      <div className="panel-section grow-section">
        <div className="panel-title">
          <div>
            <h2>公文格式治理</h2>
            <span>{standard.name}</span>
          </div>
        </div>

        <div className="layout-action-bar">
          <button className="tool-button" type="button" onClick={onAnalyze} disabled={!hasDocument || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <ClipboardCheck size={16} />}
            格式体检
          </button>
          <button className="tool-button" type="button" onClick={onSelectFixable} disabled={!hasDocument || busy || !analysisReady || fixableCount === 0}>
            <Check size={16} />
            {selectedCount === fixableCount && fixableCount > 0 ? "取消修复项" : "选择可修复"}
          </button>
          <button className="tool-button" type="button" onClick={onPreviewPlan} disabled={!hasDocument || busy || !analysisReady || selectedCount === 0}>
            <FileText size={16} />
            生成计划
          </button>
          <button className="tool-button primary" type="button" onClick={onApply} disabled={!hasDocument || busy || !analysisReady || plan.actions.length === 0}>
            {busy ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
            执行修复
          </button>
        </div>

        <div className="layout-summary-strip">
          <Metric label="规则" value={report.findings.length} />
          <Metric label="可修复" value={fixableCount} />
          <Metric label="已选" value={selectedCount} />
          <Metric label="需确认" value={report.findings.filter((item) => item.status === "needs-confirmation").length} />
        </div>

        <div className="layout-rule-list">
          {grouped.map((domain) => (
            <section className="layout-domain" key={domain.id}>
              <div className="layout-domain-head">
                <strong>{domain.title}</strong>
                <span>{domain.findings.length}</span>
              </div>
              {domain.findings.map((finding) => (
                <label className={`layout-rule-item ${finding.fixable ? "fixable" : "manual"}`} key={finding.id}>
                  <input
                    type="checkbox"
                    checked={selectedFindingIds.includes(finding.id)}
                    onChange={() => onToggleFinding(finding.id)}
                    disabled={busy || !analysisReady || !finding.fixable || finding.status === "blocked"}
                  />
                  <span>
                    <strong>{finding.title}</strong>
                    <em>{finding.clause} · {statusLabel(finding)}</em>
                    <small>{finding.finding}</small>
                    {finding.evidence ? <small className="layout-evidence">{finding.evidence}</small> : null}
                  </span>
                </label>
              ))}
            </section>
          ))}
        </div>

        <div className="layout-result">
          <strong>{status || "等待上传文档"}</strong>
          <span>{result?.summary || report.summary}</span>
          {plan.actions.length > 0 ? (
            <div className="layout-plan-inline">
              <ShieldCheck size={15} />
              <span>{plan.summary}</span>
            </div>
          ) : null}
          {Array.isArray(result?.items) && result.items.length > 0 ? (
            <div className="layout-result-list">
              {result.items.map((item) => (
                <div className={item.ok ? "layout-result-item ok" : "layout-result-item"} key={item.id || item.title}>
                  <b>{item.title || item.id}</b>
                  <span>{item.message || (item.ok ? "已完成" : "未执行")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="layout-export-bar">
          <button className="tool-button" type="button" onClick={onExport} disabled={!hasDocument || busy}>
            <Download size={16} />
            导出修复文档
          </button>
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value }) {
  return (
    <div className="layout-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusLabel(finding) {
  if (finding.status === "blocked") return "不可自动处理";
  if (finding.status === "needs-confirmation") return "需人工确认";
  if (finding.fixable) return "可自动修复";
  return "需复核";
}

export default FormatControls;

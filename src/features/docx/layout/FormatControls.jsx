import React from "react";
import { Check, Download, FileText, Loader2, Wand2 } from "lucide-react";

function FormatControls({
  rule,
  selectedActionIds,
  busy,
  hasDocument,
  status,
  result,
  onToggleAction,
  onSelectAll,
  onPreviewPlan,
  onApply,
  onExport,
}) {
  const allSelected = rule.actions.every((action) => selectedActionIds.includes(action.id));
  return (
    <aside className="right-panel field-panel layout-panel">
      <div className="panel-section grow-section">
        <div className="panel-title">
          <div>
            <h2>公文排版</h2>
            <span>{rule.name}</span>
          </div>
        </div>

        <div className="layout-action-bar">
          <button className="tool-button" type="button" onClick={onSelectAll}>
            <Check size={16} />
            {allSelected ? "取消全选" : "全选规则"}
          </button>
          <button className="tool-button" type="button" onClick={onPreviewPlan} disabled={!hasDocument || busy || selectedActionIds.length === 0}>
            <FileText size={16} />
            生成计划
          </button>
          <button className="tool-button primary" type="button" onClick={onApply} disabled={!hasDocument || busy || selectedActionIds.length === 0}>
            {busy ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
            应用排版
          </button>
        </div>

        <div className="layout-rule-list">
          {rule.actions.map((action) => (
            <label className="layout-rule-item" key={action.id}>
              <input type="checkbox" checked={selectedActionIds.includes(action.id)} onChange={() => onToggleAction(action.id)} disabled={busy} />
              <span>
                <strong>{action.title}</strong>
                <em>{action.summary}</em>
              </span>
            </label>
          ))}
        </div>

        <div className="layout-result">
          <strong>{status || "等待上传文档"}</strong>
          {result?.summary ? <span>{result.summary}</span> : <span>上传 DOCX 后，可先生成排版计划，再由 OnlyOffice 执行格式调整。</span>}
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
            导出排版文档
          </button>
        </div>
      </div>
    </aside>
  );
}

export default FormatControls;

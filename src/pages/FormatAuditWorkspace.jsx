import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Loader2, MessageSquareText, Settings, Sparkles, Wand2, X } from "lucide-react";
import { auditDocxFormat } from "../lib/docx/formatAudit";
import { reviseDocxFormat } from "../lib/docx/formatRevise";
import { templateCategories } from "../constants/templates.js";
import { buildFormatRevisionFileName, formatFileSize } from "../utils/files.js";
import {
  DocumentFrame,
  createPreviewId,
  waitForNextFrame,
} from "../features/docx/runtime.jsx";
import {
  auditConfigItems,
  auditConfigStorageKey,
  isAuditIssueEnabled,
  readAuditConfig,
} from "../features/docx/audit/config.js";
import {
  enhanceAuditWithAiOutline,
  getOutlineRevisionAction,
  getOutlineRevisionReason,
} from "../features/docx/audit/aiOutline.js";
import { readDocxStructure } from "../features/docx/structure/docxStructure.js";
import { apiRequest } from "../services/apiClient.js";

function FormatAuditWorkspace({ onStoreTemplate }) {
  const fileInputRef = useRef(null);
  const aiAuditRequestRef = useRef(0);
  const currentAuditFileRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [auditResult, setAuditResult] = useState(null);
  const [outlineAuditResult, setOutlineAuditResult] = useState(null);
  const [auditPanelMode, setAuditPanelMode] = useState(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState([]);
  const [auditState, setAuditState] = useState("idle");
  const [error, setError] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [auditConfig, setAuditConfig] = useState(() => readAuditConfig());
  const [expandedIssueIds, setExpandedIssueIds] = useState([]);
  const [aiOutlineBusy, setAiOutlineBusy] = useState(false);
  const [outlineUserInput, setOutlineUserInput] = useState("");
  const [templateCategory, setTemplateCategory] = useState("招标类");
  const [templateStoreState, setTemplateStoreState] = useState("idle");
  const [onlyOfficeOutline, setOnlyOfficeOutline] = useState(null);
  const activeAuditResult = auditPanelMode === "outline" ? outlineAuditResult : auditPanelMode === "content" ? auditResult : null;
  const issues = activeAuditResult?.issues || [];
  const enabledAuditItems = auditConfig.enabled;
  const enabledAuditItemSet = useMemo(() => new Set(enabledAuditItems), [enabledAuditItems]);
  const repairableIssues = issues.filter((issue) => isAuditIssueEnabled(issue, enabledAuditItemSet));
  const selectedIssues = repairableIssues.filter((issue) => selectedIssueIds.includes(issue.id));
  const allIssuesSelected = repairableIssues.length > 0 && repairableIssues.every((issue) => selectedIssueIds.includes(issue.id));
  const isAuditBusy = auditState === "auditing" || auditState === "revising" || aiOutlineBusy;
  const canRevise = Boolean(previewFile?.buffer && selectedIssues.length > 0 && !isAuditBusy);
  const canStoreTemplate = Boolean((currentAuditFileRef.current || previewFile)?.buffer && !isAuditBusy && onStoreTemplate);
  const canStartOutlineAudit = Boolean(auditPanelMode === "outline" && onlyOfficeOutline?.ok && previewFile?.buffer && !isAuditBusy);
  const outlineAuditStarted = Boolean(outlineAuditResult || aiOutlineBusy);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      setError("请上传 .docx 文件。");
      setAuditState("error");
      return;
    }

    setError("");
    setAiOutlineBusy(false);
    setAuditState("auditing");
    try {
      const buffer = await file.arrayBuffer();
      const structure = await readDocxStructure(buffer.slice(0)).catch(() => null);
      const nextFile = {
        previewId: createPreviewId("audit-source"),
        name: file.name,
        size: formatFileSize(file.size),
        uploadedAt: "刚刚上传",
        buffer,
        supported: true,
        structure,
      };
      currentAuditFileRef.current = nextFile;
      setPreviewFile(nextFile);
      setOutlineAuditResult(null);
      setAuditPanelMode("content");
      setTemplateStoreState("idle");
      setOnlyOfficeOutline(null);
      await runAudit(nextFile);
    } catch (uploadError) {
      setAuditState("error");
      setError(uploadError?.message || "文档审查失败。");
    }
  }

  async function runAudit(file, config = auditConfig) {
    aiAuditRequestRef.current += 1;
    const scriptAudit = await auditDocxFormat(file.buffer.slice(0), config);
    const visibleAudit = scriptAudit;
    setError("");
    setAuditResult(visibleAudit);
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setAuditState("ready");
    setAiOutlineBusy(false);
    setOutlineAuditResult(null);
    return visibleAudit;
  }

  async function runOutlineAudit(file = currentAuditFileRef.current || previewFile, userInstruction = "") {
    if (!file?.buffer || aiOutlineBusy) return;
    const outline = window.__guangfaOnlyOfficeOutline || onlyOfficeOutline;
    if (!outline?.ok || !Array.isArray(outline.items) || outline.items.length === 0) {
      setAuditPanelMode("outline");
      setOutlineAuditResult({ issues: [] });
      setError("OnlyOffice 大纲未挂载，不能开始 AI 审查。");
      return;
    }
    const requestId = aiAuditRequestRef.current + 1;
    aiAuditRequestRef.current = requestId;
    setAuditPanelMode("outline");
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setAiOutlineBusy(true);
    setOutlineAuditResult(null);
    setError("");
    try {
      const nextAudit = await enhanceAuditWithAiOutline({ issues: [] }, file, auditConfig, outline, userInstruction);
      if (requestId !== aiAuditRequestRef.current) return;
      const outlineIssues = nextAudit.issues.filter((issue) => /^ai-/.test(issue.id));
      setOutlineAuditResult({ ...nextAudit, issues: outlineIssues });
      setError(nextAudit.aiError || "");
    } catch (outlineError) {
      if (requestId !== aiAuditRequestRef.current) return;
      setOutlineAuditResult({ issues: [] });
      setError(outlineError?.message || "AI 大纲审查失败。");
    } finally {
      if (requestId === aiAuditRequestRef.current) {
        setAiOutlineBusy(false);
        setAuditState("ready");
      }
    }
  }

  function toggleContentAuditPanel() {
    setAuditPanelMode((mode) => (mode === "content" ? null : "content"));
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
  }

  function toggleOutlineAuditPanel() {
    if (auditPanelMode === "outline") {
      setAuditPanelMode(null);
      setSelectedIssueIds([]);
      setExpandedIssueIds([]);
      return;
    }
    setAuditPanelMode("outline");
    setSelectedIssueIds([]);
    setExpandedIssueIds([]);
    setOutlineAuditResult(null);
    setError("");
  }

  function handleStartOutlineAudit() {
    runOutlineAudit(currentAuditFileRef.current || previewFile, "");
  }

  function handleSendOutlineInstruction() {
    const instruction = outlineUserInput.trim();
    if (!instruction) return;
    setOutlineUserInput("");
    runOutlineAudit(currentAuditFileRef.current || previewFile, instruction);
  }

  useEffect(() => {
    const controller = new AbortController();
    function handleOfficeCustomAction(event) {
      const data = event.data || {};
      if (data.source !== "guangfa-onlyoffice-custom") return;
      if (data.action === "onlyoffice-outline-probe") {
        window.__guangfaOnlyOfficeOutline = data.outline;
        setOnlyOfficeOutline(data.outline);
        console.log("[format-audit] onlyoffice-outline-probe", data.outline);
        if (data.outline?.items && console.table) console.table(data.outline.items);
        apiRequest("/api/office/outline-probe", {
          method: "POST",
          json: {
            fileName: previewFile?.name || "",
            previewId: previewFile?.previewId || "",
            outline: data.outline,
          },
          signal: controller.signal,
          fallbackMessage: "大纲探针上报失败",
        }).catch(() => {});
        return;
      }
      if (data.action === "toggle-content-audit") toggleContentAuditPanel();
      if (data.action === "toggle-outline-audit") toggleOutlineAuditPanel();
    }

    window.addEventListener("message", handleOfficeCustomAction);
    return () => {
      controller.abort();
      window.removeEventListener("message", handleOfficeCustomAction);
    };
  });

  async function applyAuditConfig() {
    setConfigOpen(false);
    const currentFile = currentAuditFileRef.current || previewFile;
    if (!currentFile?.buffer) return;
    setAuditState("auditing");
    setAiOutlineBusy(false);
    setOutlineAuditResult(null);
    setAuditPanelMode("content");
    setError("");
    try {
      await runAudit(currentFile, auditConfig);
    } catch (auditError) {
      setAuditState("error");
      setError(auditError?.message || "按配置重新审查失败。");
    }
  }

  function toggleIssue(issueId) {
    setSelectedIssueIds((ids) => (ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId]));
  }

  function toggleSelectAllIssues() {
    setSelectedIssueIds(allIssuesSelected ? [] : repairableIssues.map((issue) => issue.id));
  }

  function toggleIssueDetails(issueId) {
    setExpandedIssueIds((ids) => (ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId]));
  }

  async function handleReviseSelectedIssues() {
    if (!canRevise) return;
    const baseFile = currentAuditFileRef.current || previewFile;
    if (!baseFile?.buffer) return;
    const wasOutlinePanel = auditPanelMode === "outline";
    setAuditState("revising");
    setError("");
    try {
      const blob = await reviseDocxFormat(baseFile.buffer.slice(0), selectedIssues, auditConfig);
      const revisedBuffer = await blob.arrayBuffer();
      const revisedFile = {
        ...baseFile,
        previewId: createPreviewId("audit-revised"),
        name: buildFormatRevisionFileName(baseFile.name),
        size: formatFileSize(blob.size),
        uploadedAt: "刚刚修订",
        buffer: revisedBuffer,
        supported: true,
        structure: await readDocxStructure(revisedBuffer.slice(0)).catch(() => null),
      };
      setPreviewFile(null);
      await waitForNextFrame();
      currentAuditFileRef.current = revisedFile;
      if (wasOutlinePanel) {
        setOnlyOfficeOutline(null);
        setOutlineAuditResult(null);
        setSelectedIssueIds([]);
        setExpandedIssueIds([]);
      }
      setPreviewFile(revisedFile);
      setTemplateStoreState("idle");
      if (wasOutlinePanel) setAuditState("ready");
      else await runAudit(revisedFile, auditConfig);
    } catch (reviseError) {
      setAuditState("error");
      setError(reviseError?.message || "执行修复失败。");
    }
  }

  async function handleStoreTemplate() {
    const currentFile = currentAuditFileRef.current || previewFile;
    if (!currentFile?.buffer || !onStoreTemplate) return;
    setTemplateStoreState("saving");
    try {
      await onStoreTemplate(currentFile, templateCategory);
      setTemplateStoreState("saved");
    } catch (storeError) {
      setTemplateStoreState("error");
      setError(storeError?.message || "存入模板库失败。");
    }
  }

  function toggleAuditConfigItem(itemId) {
    setAuditConfig((config) => {
      const enabled = config.enabled.includes(itemId) ? config.enabled.filter((id) => id !== itemId) : [...config.enabled, itemId];
      const next = { ...config, enabled };
      localStorage.setItem(auditConfigStorageKey, JSON.stringify(next));
      setSelectedIssueIds((ids) => ids.filter((id) => issues.some((issue) => issue.id === id && isAuditIssueEnabled(issue, new Set(enabled)))));
      return next;
    });
  }

  function updateAuditParam(name, value) {
    setAuditConfig((config) => {
      const next = { ...config, params: { ...config.params, [name]: value } };
      localStorage.setItem(auditConfigStorageKey, JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className={auditPanelMode ? "work-grid audit-grid" : "work-grid audit-grid audit-grid-full"}>
      <section className="document-card">
        <input className="visually-hidden" type="file" accept=".docx" ref={fileInputRef} onChange={handleFileChange} />

        <DocumentFrame key={previewFile?.previewId || "audit-empty"} mode="audit" templateFile={previewFile} onUploadClick={() => fileInputRef.current?.click()} />
      </section>

      {auditPanelMode ? (
      <aside className="right-panel field-panel audit-panel">
        <div className="panel-section grow-section">
          <div className="panel-title">
            <h2>{auditPanelMode === "outline" ? "大纲审查" : "内容审查"}</h2>
            <div className="panel-actions">
              <div className="audit-template-store">
                <select value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)} disabled={!canStoreTemplate || templateStoreState === "saving"}>
                  {templateCategories.filter((category) => category !== "全部").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <button className="text-button" type="button" onClick={handleStoreTemplate} disabled={!canStoreTemplate || templateStoreState === "saving"}>
                  {templateStoreState === "saving" ? "保存中" : "存入模板库"}
                </button>
              </div>
              <button className="text-button" type="button" onClick={toggleSelectAllIssues} disabled={repairableIssues.length === 0 || isAuditBusy}>
                {allIssuesSelected ? "取消全选" : "全选"}
              </button>
              <button className="icon-button quiet" type="button" onClick={() => setConfigOpen(true)} aria-label="格式审查配置">
                <Settings size={16} />
              </button>
            </div>
          </div>
          {auditPanelMode === "outline" ? (
            <div className={onlyOfficeOutline?.ok ? "outline-mount-status ready" : onlyOfficeOutline ? "outline-mount-status error" : "outline-mount-status pending"}>
              {onlyOfficeOutline?.ok ? <Check size={15} /> : onlyOfficeOutline ? <CircleAlert size={15} /> : <Loader2 size={15} className="spin" />}
              <div>
                <strong>{onlyOfficeOutline?.ok ? `OnlyOffice 大纲已挂载：${onlyOfficeOutline.count || onlyOfficeOutline.items?.length || 0} 项` : onlyOfficeOutline ? "OnlyOffice 大纲挂载失败" : "OnlyOffice 大纲挂载中"}</strong>
                <span>{onlyOfficeOutline?.ok ? "AI 将按当前 OnlyOffice 导航大纲进行审查。" : onlyOfficeOutline?.error || "等待编辑器返回当前文档导航大纲。"}</span>
              </div>
              <button className="tool-button primary" type="button" onClick={handleStartOutlineAudit} disabled={!canStartOutlineAudit}>
                {aiOutlineBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                开始审查
              </button>
            </div>
          ) : null}
          {repairableIssues.length === 0 && !aiOutlineBusy ? (
            <div className="template-empty inline">
              <strong>{auditState === "idle" ? "等待上传文档" : auditPanelMode === "outline" && !outlineAuditStarted ? "等待开始审查" : "暂无可修订项"}</strong>
              <span>{auditState === "idle" ? "上传 DOCX 后生成审查清单。" : auditPanelMode === "outline" ? (outlineAuditStarted ? "AI 大纲审查未发现可修复项。" : "大纲挂载后点击开始审查，AI 只生成修复计划。") : "脚本审查未发现可修复项。"}</span>
            </div>
          ) : (
            <div className="audit-issue-list">
              {auditPanelMode === "outline" && repairableIssues.length > 0 ? (
                <div className="outline-revision-table-wrap">
                  <table className="outline-revision-table">
                    <thead>
                      <tr>
                        <th>选</th>
                        <th>index</th>
                        <th>displayLevel</th>
                        <th>title</th>
                        <th>修订原因</th>
                        <th>修订方式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repairableIssues.map((issue) => {
                        const target = issue.targets?.[0] || {};
                        return (
                          <tr className={selectedIssueIds.includes(issue.id) ? "selected" : ""} key={issue.id}>
                            <td>
                              <input type="checkbox" checked={selectedIssueIds.includes(issue.id)} onChange={() => toggleIssue(issue.id)} disabled={isAuditBusy} />
                            </td>
                            <td>{Number.isInteger(target.outlineIndex) ? target.outlineIndex : target.index}</td>
                            <td>{`L${(Number.isInteger(target.outlineLevel) ? target.outlineLevel : target.level ?? 0) + 1}`}</td>
                            <td title={target.text}>{target.text || "空标题"}</td>
                            <td>{getOutlineRevisionReason(target)}</td>
                            <td>{getOutlineRevisionAction(target)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : repairableIssues.map((issue) => {
                const expanded = expandedIssueIds.includes(issue.id);
                return (
                <div className={selectedIssueIds.includes(issue.id) ? "audit-issue selected" : "audit-issue"} key={issue.id}>
                  <label className="audit-issue-check">
                    <input type="checkbox" checked={selectedIssueIds.includes(issue.id)} onChange={() => toggleIssue(issue.id)} disabled={isAuditBusy} />
                  </label>
                  <div className="audit-issue-body">
                    <div className="audit-issue-head">
                      <strong>{issue.title}</strong>
                    </div>
                    <p>{issue.description}</p>
                    <div className="audit-issue-meta">
                      <em>{issue.category} · {issue.count} 处</em>
                      {issue.samples.length > 0 ? (
                        <button className="text-button" type="button" onClick={() => toggleIssueDetails(issue.id)}>
                          {expanded ? "收起" : "查看"}
                        </button>
                      ) : null}
                    </div>
                    {expanded && issue.samples.length > 0 ? (
                      <div className="audit-samples">
                        {issue.samples.map((sample, index) => (
                          <span key={`${issue.id}-${index}`}>{sample}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                );
              })}
              {aiOutlineBusy ? (
                <div className="audit-ai-loading">
                  <Loader2 size={16} className="spin" />
                  <div>
                    <strong>AI 正在审查大纲</strong>
                    <span>标题体系和 Word 大纲结果稍后自动补充到清单。</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {auditPanelMode === "outline" ? (
            <div className="outline-chat-box">
              <MessageSquareText size={16} />
              <input
                value={outlineUserInput}
                onChange={(event) => setOutlineUserInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSendOutlineInstruction();
                }}
                placeholder="输入调整要求，如：这个保留为标题、这些都降为正文"
                disabled={!onlyOfficeOutline?.ok || isAuditBusy}
              />
              <button className="text-button" type="button" onClick={handleSendOutlineInstruction} disabled={!outlineUserInput.trim() || !onlyOfficeOutline?.ok || isAuditBusy}>
                发送
              </button>
            </div>
          ) : null}
          <div className="audit-revise-bar">
            {error ? (
              <span className="audit-error-text">{error}</span>
            ) : templateStoreState === "saved" ? (
              <span>已存入{templateCategory}模板库</span>
            ) : templateStoreState === "error" ? (
              <span className="audit-error-text">模板库保存失败</span>
            ) : (
              <span>已选择 {selectedIssues.length} 项</span>
            )}
            <button className="tool-button primary" type="button" onClick={handleReviseSelectedIssues} disabled={!canRevise}>
              {auditState === "revising" ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
              执行修复
            </button>
          </div>
        </div>
      </aside>
      ) : null}
      {configOpen ? (
        <FormatAuditConfigModal
          config={auditConfig}
          onClose={() => setConfigOpen(false)}
          onApply={applyAuditConfig}
          onToggleItem={toggleAuditConfigItem}
          onUpdateParam={updateAuditParam}
        />
      ) : null}
    </div>
  );
}
function FormatAuditConfigModal({ config, onClose, onApply, onToggleItem, onUpdateParam }) {
  const params = config.params;
  const itemById = new Map(auditConfigItems.map((item) => [item.id, item]));
  const sections = [
    { group: "页面版式", items: ["page-margin"] },
    { group: "基础文字", items: ["body-font", "body-size"] },
    { group: "段落格式", items: ["first-line-indent", "line-spacing", "paragraph-spacing", "blank-lines"] },
    { group: "标题体系", items: ["body-outline", "missing-heading-style", "heading-level", "heading-visual-style", "split-heading"] },
    { group: "目录大纲", items: ["word-outline", "toc-items"] },
  ];

  function renderItemParams(itemId) {
    if (itemId === "page-margin") {
      return (
        <div className="audit-param-grid">
          <NumberField label="上边距 mm" value={params.pageMarginTopMm} onChange={(value) => onUpdateParam("pageMarginTopMm", value)} />
          <NumberField label="右边距 mm" value={params.pageMarginRightMm} onChange={(value) => onUpdateParam("pageMarginRightMm", value)} />
          <NumberField label="下边距 mm" value={params.pageMarginBottomMm} onChange={(value) => onUpdateParam("pageMarginBottomMm", value)} />
          <NumberField label="左边距 mm" value={params.pageMarginLeftMm} onChange={(value) => onUpdateParam("pageMarginLeftMm", value)} />
        </div>
      );
    }
    if (itemId === "body-font") return <TextField label="标准字体" value={params.bodyFont} onChange={(value) => onUpdateParam("bodyFont", value)} />;
    if (itemId === "body-size") return <NumberField label="标准字号 pt" value={params.bodyFontSizePt} onChange={(value) => onUpdateParam("bodyFontSizePt", value)} />;
    if (itemId === "first-line-indent") return <NumberField label="首行缩进 字符" value={params.firstLineChars} onChange={(value) => onUpdateParam("firstLineChars", value)} />;
    if (itemId === "line-spacing") return <NumberField label="行距 倍" value={params.lineSpacing} step="0.1" onChange={(value) => onUpdateParam("lineSpacing", value)} />;
    if (itemId === "paragraph-spacing") {
      return (
        <div className="audit-param-grid">
          <NumberField label="段前 pt" value={params.paragraphBeforePt} onChange={(value) => onUpdateParam("paragraphBeforePt", value)} />
          <NumberField label="段后 pt" value={params.paragraphAfterPt} onChange={(value) => onUpdateParam("paragraphAfterPt", value)} />
        </div>
      );
    }
    if (itemId === "heading-visual-style") {
      return (
        <div className="audit-param-grid">
          <TextField label="一级标题字体" value={params.headingLevel1Font} onChange={(value) => onUpdateParam("headingLevel1Font", value)} />
          <NumberField label="一级标题字号 pt" value={params.headingLevel1SizePt} onChange={(value) => onUpdateParam("headingLevel1SizePt", value)} />
          <TextField label="二级标题字体" value={params.headingLevel2Font} onChange={(value) => onUpdateParam("headingLevel2Font", value)} />
          <NumberField label="二级标题字号 pt" value={params.headingLevel2SizePt} onChange={(value) => onUpdateParam("headingLevel2SizePt", value)} />
          <TextField label="三级标题字体" value={params.headingLevel3Font} onChange={(value) => onUpdateParam("headingLevel3Font", value)} />
          <NumberField label="三级标题字号 pt" value={params.headingLevel3SizePt} onChange={(value) => onUpdateParam("headingLevel3SizePt", value)} />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="audit-config-modal" role="dialog" aria-modal="true" aria-label="格式审查配置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>格式审查配置</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="audit-config-body">
          {sections.map((section) => (
            <section className="audit-config-section" key={section.group}>
              <h3>{section.group}</h3>
              <div className="audit-config-items">
                {section.items.map((itemId) => {
                  const item = itemById.get(itemId);
                  if (!item) return null;
                  return (
                    <div className="audit-config-item" key={item.id}>
                      <label className="audit-config-check">
                        <input type="checkbox" checked={config.enabled.includes(item.id)} onChange={() => onToggleItem(item.id)} />
                        <strong>{item.name}</strong>
                      </label>
                      {renderItemParams(item.id)}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button className="tool-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="tool-button primary" type="button" onClick={onApply}>
            应用配置
          </button>
        </div>
      </section>
    </div>
  );
}
function NumberField({ label, value, step = "1", onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}
function TextField({ label, value, onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default FormatAuditWorkspace;

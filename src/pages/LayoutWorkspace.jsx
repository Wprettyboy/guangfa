import React, { useMemo, useRef, useState } from "react";
import { DocumentFrame, createPreviewId } from "../features/docx/runtime.jsx";
import { requestOnlyOfficeAnalyzeLayoutFormat, requestOnlyOfficeApplyLayoutFormat, requestOnlyOfficeDocumentDownloadAs } from "../features/docx/office/bridge.jsx";
import FormatControls from "../features/docx/layout/FormatControls.jsx";
import { buildPendingLayoutReport, normalizeLayoutReport } from "../features/docx/layout/analyzer/report.js";
import { buildLayoutRepairPlan, getDefaultSelectedFindingIds } from "../features/docx/layout/planner/plan.js";
import { gbt9704Standard } from "../features/docx/layout/standards/gbt9704-2012.js";
import { buildFormatRevisionFileName, formatFileSize } from "../utils/files.js";

function LayoutWorkspace() {
  const fileInputRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [officeDocId, setOfficeDocId] = useState("");
  const [report, setReport] = useState(() => buildPendingLayoutReport(gbt9704Standard));
  const [selectedFindingIds, setSelectedFindingIds] = useState(() => []);
  const [busy, setBusy] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const plan = useMemo(
    () => buildLayoutRepairPlan(gbt9704Standard, report, analysisReady ? selectedFindingIds : []),
    [analysisReady, report, selectedFindingIds],
  );

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      setStatus("请上传 .docx 文件");
      return;
    }
    const buffer = await file.arrayBuffer();
    setPreviewFile({
      previewId: createPreviewId("layout-source"),
      name: file.name,
      size: formatFileSize(file.size),
      uploadedAt: "刚刚上传",
      buffer,
      supported: true,
    });
    setOfficeDocId("");
    const pendingReport = buildPendingLayoutReport(gbt9704Standard);
    setReport(pendingReport);
    setSelectedFindingIds([]);
    setAnalysisReady(false);
    setStatus("文档已加载，等待格式体检");
    setResult(null);
  }

  function toggleFinding(findingId) {
    if (!analysisReady) return;
    setSelectedFindingIds((ids) => (ids.includes(findingId) ? ids.filter((id) => id !== findingId) : [...ids, findingId]));
  }

  function toggleSelectFixable() {
    if (!analysisReady) return;
    const defaultIds = getDefaultSelectedFindingIds(report);
    setSelectedFindingIds((ids) => (ids.length === defaultIds.length ? [] : defaultIds));
  }

  async function analyzeLayout() {
    if (!previewFile?.buffer || busy) return;
    setBusy(true);
    setAnalysisReady(false);
    setReport(buildPendingLayoutReport(gbt9704Standard));
    setSelectedFindingIds([]);
    setStatus("OnlyOffice 正在读取文档结构");
    setResult(null);
    try {
      const response = await requestOnlyOfficeAnalyzeLayoutFormat(gbt9704Standard);
      if (response?.ok !== true) {
        const message = response?.summary || response?.error || "格式体检失败";
        setResult({ ok: false, summary: message, items: [] });
        setStatus(message);
        return;
      }
      const nextReport = normalizeLayoutReport(response, gbt9704Standard);
      setReport(nextReport);
      setSelectedFindingIds(getDefaultSelectedFindingIds(nextReport));
      setAnalysisReady(true);
      setStatus("格式体检已完成");
    } catch (error) {
      const message = error?.message || "格式体检失败";
      setResult({ ok: false, summary: message, items: [] });
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  function previewPlan() {
    if (!analysisReady) return;
    setResult({
      summary: plan.summary,
      items: [
        ...plan.actions.map((action) => ({ id: action.id, title: action.title, ok: true, message: action.summary })),
        ...plan.manualItems.map((item) => ({ id: item.id, title: item.title, ok: false, message: "需人工确认后处理。" })),
      ],
    });
    setStatus("修复计划已生成");
  }

  async function applyLayout() {
    if (!previewFile?.buffer || busy || !analysisReady) return;
    setBusy(true);
    setStatus("OnlyOffice 正在应用排版");
    setResult(null);
    try {
      const response = await requestOnlyOfficeApplyLayoutFormat(plan);
      setResult(response);
      if (response?.ok) {
        setAnalysisReady(false);
        setReport(buildPendingLayoutReport(gbt9704Standard));
        setSelectedFindingIds([]);
        setStatus("排版已应用，请重新执行格式体检");
      } else {
        setStatus("排版未完全完成");
      }
    } catch (error) {
      setResult({ ok: false, summary: error?.message || "排版执行失败", items: [] });
      setStatus("排版执行失败");
    } finally {
      setBusy(false);
    }
  }

  async function exportDocument() {
    if (!previewFile?.buffer || busy) return;
    setBusy(true);
    setStatus("正在导出排版文档");
    try {
      const buffer = await requestOnlyOfficeDocumentDownloadAs("docx", 20000);
      if (!buffer) throw new Error("OnlyOffice 未返回导出文件。");
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildFormatRevisionFileName(previewFile.name || "排版文档.docx");
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus("排版文档已导出");
    } catch (error) {
      setStatus(error?.message || "导出失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="work-grid layout-grid">
      <section className="document-card">
        <input className="visually-hidden" type="file" accept=".docx" ref={fileInputRef} onChange={handleFileChange} />
        <DocumentFrame
          key={previewFile?.previewId || "layout-empty"}
          mode="layout"
          templateFile={previewFile}
          onUploadClick={() => fileInputRef.current?.click()}
          onOfficeDocumentReady={setOfficeDocId}
          trackRevisionsEnabled={false}
        />
      </section>

      <FormatControls
        standard={gbt9704Standard}
        report={report}
        plan={plan}
        analysisReady={analysisReady}
        selectedFindingIds={selectedFindingIds}
        busy={busy}
        hasDocument={Boolean(previewFile?.buffer && officeDocId)}
        status={status}
        result={result}
        onToggleFinding={toggleFinding}
        onSelectFixable={toggleSelectFixable}
        onAnalyze={analyzeLayout}
        onPreviewPlan={previewPlan}
        onApply={applyLayout}
        onExport={exportDocument}
      />
    </div>
  );
}

export default LayoutWorkspace;

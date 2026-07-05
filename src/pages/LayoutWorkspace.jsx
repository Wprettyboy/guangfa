import React, { useMemo, useRef, useState } from "react";
import { DocumentFrame, createPreviewId } from "../features/docx/runtime.jsx";
import { requestOnlyOfficeApplyLayoutFormat, requestOnlyOfficeDocumentDownloadAs } from "../features/docx/office/bridge.jsx";
import FormatControls from "../features/docx/layout/FormatControls.jsx";
import { buildGbLayoutPlan, gbOfficialDocumentRule } from "../features/docx/layout/gbRules.js";
import { buildFormatRevisionFileName, formatFileSize } from "../utils/files.js";

function LayoutWorkspace() {
  const fileInputRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [officeDocId, setOfficeDocId] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState(() => gbOfficialDocumentRule.actions.map((item) => item.id));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const plan = useMemo(() => buildGbLayoutPlan(selectedActionIds), [selectedActionIds]);

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
    setStatus("文档已加载，等待排版");
    setResult(null);
  }

  function toggleAction(actionId) {
    setSelectedActionIds((ids) => (ids.includes(actionId) ? ids.filter((id) => id !== actionId) : [...ids, actionId]));
  }

  function toggleSelectAll() {
    setSelectedActionIds((ids) => (ids.length === gbOfficialDocumentRule.actions.length ? [] : gbOfficialDocumentRule.actions.map((item) => item.id)));
  }

  function previewPlan() {
    setResult({
      summary: `已生成 ${plan.actions.length} 项排版计划，尚未修改文档。`,
      items: plan.actions.map((action) => ({ id: action.id, title: action.title, ok: true, message: action.summary })),
    });
    setStatus("排版计划已生成");
  }

  async function applyLayout() {
    if (!previewFile?.buffer || busy) return;
    setBusy(true);
    setStatus("OnlyOffice 正在应用排版");
    setResult(null);
    try {
      const response = await requestOnlyOfficeApplyLayoutFormat(plan);
      setResult(response);
      setStatus(response?.ok ? "排版已应用" : "排版未完全完成");
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
        rule={gbOfficialDocumentRule}
        selectedActionIds={selectedActionIds}
        busy={busy}
        hasDocument={Boolean(previewFile?.buffer && officeDocId)}
        status={status}
        result={result}
        onToggleAction={toggleAction}
        onSelectAll={toggleSelectAll}
        onPreviewPlan={previewPlan}
        onApply={applyLayout}
        onExport={exportDocument}
      />
    </div>
  );
}

export default LayoutWorkspace;

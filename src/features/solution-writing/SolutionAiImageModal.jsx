import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { generateSolutionPlantumlImage } from "./service.js";

function SolutionAiImageModal({
  open,
  outline,
  onRequestOutline,
  onInsertImage,
  onClose,
}) {
  const [localOutline, setLocalOutline] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generatedImage, setGeneratedImage] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const effectiveOutline = localOutline || outline;
  const outlineItems = useMemo(() => normalizeOutlineItems(effectiveOutline?.items), [effectiveOutline]);
  const selectedItem = outlineItems.find((item) => String(item.index) === String(selectedIndex)) || outlineItems[0] || null;
  const outlineText = useMemo(
    () => String(effectiveOutline?.documentText || "").trim() || buildDocumentOutlineText(outlineItems),
    [effectiveOutline?.documentText, outlineItems],
  );
  const busy = status === "loading-outline" || status === "generating" || status === "inserting";

  useEffect(() => {
    if (!open) return;
    refreshOutline();
  }, [open]);

  if (!open) return null;

  async function refreshOutline() {
    setStatus("loading-outline");
    setMessage("");
    setGeneratedImage(null);
    setLocalOutline(null);
    setSelectedIndex("");
    const result = await onRequestOutline?.({ timeoutMs: 10000 });
    if (result?.ok) {
      const nextItems = normalizeOutlineItems(result.items);
      setLocalOutline(result);
      setSelectedIndex(String(nextItems[0]?.index ?? ""));
      setStatus("idle");
      setMessage(`已读取当前文档大纲 ${nextItems.length} 个标题。`);
      return;
    }
    setStatus("error");
    setMessage(result?.error || "未读取到当前文档大纲，请确认左侧 OnlyOffice 文档已加载。");
  }

  async function generateImage() {
    if (!selectedItem || !prompt.trim()) return;
    setStatus("generating");
    setMessage("");
    setGeneratedImage(null);
    try {
      const result = await generateSolutionPlantumlImage({
        prompt,
        selectedTitle: selectedItem.title,
        selectedBodyText: selectedItem.bodyText,
        outlineItems,
        outlineText,
      });
      setGeneratedImage(result.image || null);
      setStatus("idle");
      setMessage(result.repairAttempts ? `已生成配图，自动修复 ${result.repairAttempts} 次。` : "已生成配图。");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "AI 生图失败");
    }
  }

  async function insertGeneratedImage() {
    if (!generatedImage) return;
    setStatus("inserting");
    setMessage("");
    const result = await onInsertImage?.(generatedImage);
    if (result?.ok) {
      setStatus("idle");
      setMessage("已插入当前光标位置。");
      return;
    }
    setStatus("error");
    setMessage(result?.error || "图片插入失败，请确认左侧文档已加载并把光标放到插入位置。");
  }

  return createPortal(
    <div className="knowledge-table-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="knowledge-table-modal solution-ai-image-modal" role="dialog" aria-modal="true" aria-label="AI生图" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>AI生图</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="solution-ai-image-grid">
          <aside className="solution-ai-image-form">
            <button className="tool-button full-width" type="button" onClick={refreshOutline} disabled={busy}>
              {status === "loading-outline" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
              读取当前文档大纲
            </button>

            <label className="solution-ai-field">
              <span>选择标题</span>
              <select
                value={selectedItem ? String(selectedItem.index) : ""}
                onChange={(event) => {
                  setSelectedIndex(event.target.value);
                  setGeneratedImage(null);
                }}
                disabled={!outlineItems.length || busy}
              >
                {outlineItems.length ? outlineItems.map((item) => (
                  <option key={item.index} value={String(item.index)}>
                    {`${"　".repeat(Math.min(item.level, 5))}${item.title}`}
                  </option>
                )) : (
                  <option value="">请先读取当前文档大纲</option>
                )}
              </select>
            </label>

            <div className="solution-ai-context">
              <strong>{selectedItem?.title || "未选择标题"}</strong>
              <span>{selectedItem?.bodyText ? `标题下正文 ${selectedItem.bodyText.length} 字` : "该标题下暂未读取到正文"}</span>
            </div>

            <label className="solution-ai-field">
              <span>生图要求</span>
              <textarea
                value={prompt}
                placeholder="例如：生成业务流程图；生成功能组成图；生成系统总体架构图。"
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setGeneratedImage(null);
                }}
                disabled={busy}
              />
            </label>

            <button className="tool-button primary full-width" type="button" onClick={generateImage} disabled={!selectedItem || !prompt.trim() || busy}>
              {status === "generating" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              生成配图
            </button>
          </aside>

          <main className="solution-ai-image-preview">
            {generatedImage ? (
              <>
                <div className="solution-ai-image-preview-head">
                  <div>
                    <strong>{generatedImage.title || "AI 生成配图"}</strong>
                    <span>PlantUML · 黑体 · 字号不小于 20pt</span>
                  </div>
                  <button className="tool-button primary" type="button" onClick={insertGeneratedImage} disabled={busy}>
                    {status === "inserting" ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                    插入到光标
                  </button>
                </div>
                <div className="solution-ai-image-scroll">
                  <img src={generatedImage.previewUrl} alt={generatedImage.title || "AI 生成配图"} />
                </div>
              </>
            ) : (
              <div className="solution-ai-image-empty">
                <ImageIcon size={28} />
                <strong>等待生成配图</strong>
                <span>AI 会优先读取所选标题下正文，并用全文大纲避免遗漏上下文。</span>
              </div>
            )}
          </main>
        </div>

        {message ? <div className={status === "error" ? "solution-message error" : "solution-message"}>{message}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

function normalizeOutlineItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, position) => ({
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : position,
      level: Number.isFinite(Number(item.level)) ? Number(item.level) : 0,
      title: String(item.displayTitle || item.title || "").trim(),
      bodyText: String(item.bodyText || "").trim(),
    }))
    .filter((item) => item.title && !item.isEmptyItem);
}

function buildDocumentOutlineText(items) {
  return items
    .map((item) => {
      const prefix = `${"  ".repeat(Math.min(item.level, 8))}- ${item.title}`;
      return item.bodyText ? `${prefix}\n${item.bodyText}` : prefix;
    })
    .join("\n");
}

export default SolutionAiImageModal;

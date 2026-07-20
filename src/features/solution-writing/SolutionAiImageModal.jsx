import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, Download, Image as ImageIcon, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { generateSolutionPlantumlImage, renderSolutionPlantuml } from "./service.js";
import useApiAssetUrl from "../../hooks/useApiAssetUrl.js";

function SolutionAiImageModal({
  open,
  outline,
  onRequestOutline,
  onInsertImage,
  onClose,
}) {
  const [activeMode, setActiveMode] = useState("ai");
  const [localOutline, setLocalOutline] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiImage, setAiImage] = useState(null);
  const [aiStatus, setAiStatus] = useState("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [plantumlTitle, setPlantumlTitle] = useState("");
  const [plantumlSource, setPlantumlSource] = useState("");
  const [plantumlImage, setPlantumlImage] = useState(null);
  const [plantumlStatus, setPlantumlStatus] = useState("idle");
  const [plantumlMessage, setPlantumlMessage] = useState("");
  const effectiveOutline = localOutline || outline;
  const outlineItems = useMemo(() => normalizeOutlineItems(effectiveOutline?.items), [effectiveOutline]);
  const selectedItem = outlineItems.find((item) => String(item.index) === String(selectedIndex)) || outlineItems[0] || null;
  const outlineText = useMemo(
    () => String(effectiveOutline?.documentText || "").trim() || buildDocumentOutlineText(outlineItems),
    [effectiveOutline?.documentText, outlineItems],
  );
  const aiBusy = aiStatus === "loading-outline" || aiStatus === "generating" || aiStatus === "inserting";
  const plantumlBusy = plantumlStatus === "generating" || plantumlStatus === "inserting";
  const manualMode = activeMode === "plantuml";
  const currentImage = manualMode ? plantumlImage : aiImage;
  const currentImageAsset = useApiAssetUrl(open ? currentImage?.previewUrl : "");
  const currentStatus = manualMode ? plantumlStatus : aiStatus;
  const currentMessage = manualMode ? plantumlMessage : aiMessage;
  const busy = manualMode ? plantumlBusy : aiBusy;

  useEffect(() => {
    if (!open || activeMode !== "ai") return;
    refreshOutline();
  }, [activeMode, open]);

  if (!open) return null;

  async function refreshOutline() {
    setAiStatus("loading-outline");
    setAiMessage("");
    setAiImage(null);
    setLocalOutline(null);
    setSelectedIndex("");
    const result = await onRequestOutline?.({ timeoutMs: 10000 });
    if (result?.ok) {
      const nextItems = normalizeOutlineItems(result.items);
      setLocalOutline(result);
      setSelectedIndex(String(nextItems[0]?.index ?? ""));
      setAiStatus("idle");
      setAiMessage(`已读取当前文档大纲 ${nextItems.length} 个标题。`);
      return;
    }
    setAiStatus("error");
    setAiMessage(result?.error || "未读取到当前文档大纲，请确认左侧 OnlyOffice 文档已加载。");
  }

  async function generateImage() {
    if (!selectedItem || !prompt.trim()) return;
    setAiStatus("generating");
    setAiMessage("");
    setAiImage(null);
    try {
      const result = await generateSolutionPlantumlImage({
        prompt,
        selectedTitle: selectedItem.title,
        selectedBodyText: selectedItem.bodyText,
        outlineItems,
        outlineText,
      });
      setAiImage(result.image || null);
      setAiStatus("idle");
      setAiMessage(result.repairAttempts ? `已生成配图，自动修复 ${result.repairAttempts} 次。` : "已生成配图。");
    } catch (error) {
      setAiStatus("error");
      setAiMessage(error?.message || "AI 生图失败");
    }
  }

  async function generatePlantumlImage() {
    if (!plantumlSource.trim()) return;
    setPlantumlStatus("generating");
    setPlantumlMessage("");
    setPlantumlImage(null);
    try {
      const result = await renderSolutionPlantuml({
        title: plantumlTitle,
        source: plantumlSource,
      });
      setPlantumlImage(result.image || null);
      setPlantumlStatus("idle");
      setPlantumlMessage("已生成 PlantUML 配图。");
    } catch (error) {
      setPlantumlStatus("error");
      setPlantumlMessage(error?.message || "PlantUML 渲染失败");
    }
  }

  async function insertGeneratedImage() {
    if (!currentImage) return;
    const setStatus = manualMode ? setPlantumlStatus : setAiStatus;
    const setMessage = manualMode ? setPlantumlMessage : setAiMessage;
    setStatus("inserting");
    setMessage("");
    const result = await onInsertImage?.(currentImage);
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
          <h2>配图生成</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="solution-image-tabs" role="tablist" aria-label="生图方式">
          <button className={activeMode === "ai" ? "active" : ""} type="button" role="tab" aria-selected={activeMode === "ai"} onClick={() => setActiveMode("ai")}>
            <Sparkles size={15} />
            AI生成
          </button>
          <button className={manualMode ? "active" : ""} type="button" role="tab" aria-selected={manualMode} onClick={() => setActiveMode("plantuml")}>
            <Code2 size={15} />
            PlantUML
          </button>
        </div>

        <div className="solution-ai-image-grid">
          {manualMode ? (
            <aside className="solution-ai-image-form">
              <label className="solution-ai-field">
                <span>图片标题</span>
                <input
                  value={plantumlTitle}
                  placeholder="PlantUML配图"
                  onChange={(event) => {
                    setPlantumlTitle(event.target.value);
                    setPlantumlImage(null);
                  }}
                  disabled={plantumlBusy}
                />
              </label>

              <label className="solution-ai-field solution-plantuml-source-field">
                <span>PlantUML 源码</span>
                <textarea
                  value={plantumlSource}
                  placeholder="粘贴 PlantUML 源码"
                  spellCheck={false}
                  onChange={(event) => {
                    setPlantumlSource(event.target.value);
                    setPlantumlImage(null);
                  }}
                  disabled={plantumlBusy}
                />
              </label>

              <button className="tool-button primary full-width" type="button" onClick={generatePlantumlImage} disabled={!plantumlSource.trim() || plantumlBusy}>
                {plantumlStatus === "generating" ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
                生成图片
              </button>
            </aside>
          ) : (
            <aside className="solution-ai-image-form">
              <button className="tool-button full-width" type="button" onClick={refreshOutline} disabled={busy}>
                {aiStatus === "loading-outline" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                读取当前文档大纲
              </button>

            <label className="solution-ai-field">
              <span>选择标题</span>
              <select
                value={selectedItem ? String(selectedItem.index) : ""}
                onChange={(event) => {
                  setSelectedIndex(event.target.value);
                  setAiImage(null);
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
                  setAiImage(null);
                }}
                disabled={busy}
              />
            </label>

            <button className="tool-button primary full-width" type="button" onClick={generateImage} disabled={!selectedItem || !prompt.trim() || busy}>
              {aiStatus === "generating" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              生成配图
            </button>
            </aside>
          )}

          <main className="solution-ai-image-preview">
            {currentImage ? (
              <>
                <div className="solution-ai-image-preview-head">
                  <div>
                    <strong>{currentImage.title || (manualMode ? "PlantUML配图" : "AI 生成配图")}</strong>
                    <span>{manualMode ? "本地 PlantUML 服务生成" : "PlantUML · 黑体 · 字号不小于 20pt"}</span>
                  </div>
                  <div className="solution-ai-image-preview-actions">
                    <a
                      className="tool-button"
                      href={currentImageAsset.url || undefined}
                      aria-disabled={!currentImageAsset.url}
                      download={`${currentImage.title || "PlantUML配图"}.png`}
                    >
                      <Download size={15} />
                      下载 PNG
                    </a>
                    <button className="tool-button primary" type="button" onClick={insertGeneratedImage} disabled={busy}>
                      {currentStatus === "inserting" ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                      插入到光标
                    </button>
                  </div>
                </div>
                <div className="solution-ai-image-scroll">
                  {currentImageAsset.loading ? (
                    <Loader2 size={24} className="spin" />
                  ) : currentImageAsset.error ? (
                    <div className="solution-ai-image-empty">{currentImageAsset.error}</div>
                  ) : (
                    <img src={currentImageAsset.url} alt={currentImage.title || (manualMode ? "PlantUML配图" : "AI 生成配图")} />
                  )}
                </div>
              </>
            ) : (
              <div className="solution-ai-image-empty">
                <ImageIcon size={28} />
                <strong>{manualMode ? "等待渲染" : "等待生成配图"}</strong>
                <span>{manualMode ? "粘贴源码后生成预览。" : "AI 会优先读取所选标题下正文，并用全文大纲避免遗漏上下文。"}</span>
              </div>
            )}
          </main>
        </div>

        {currentMessage ? <div className={currentStatus === "error" ? "solution-message error" : "solution-message"}>{currentMessage}</div> : null}
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

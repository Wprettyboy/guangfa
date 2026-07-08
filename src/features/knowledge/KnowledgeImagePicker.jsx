import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { searchKnowledgeImages } from "../../services/knowledgeBase.js";

function KnowledgeImagePicker({
  open,
  title = "插入资料图片",
  emptyScopeMessage = "请先在填充工作台选择项目库或全局库。",
  insertButtonLabel = "插入到光标",
  knowledgeBases = [],
  selectedProjectKnowledgeBaseIds = [],
  selectedGlobalKnowledgeBaseIds = [],
  onInsert,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [images, setImages] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [insertStatus, setInsertStatus] = useState("");
  const selectedIds = useMemo(
    () => [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds],
    [selectedGlobalKnowledgeBaseIds, selectedProjectKnowledgeBaseIds],
  );
  const documents = useMemo(() => groupImagesByDocument(images), [images]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || documents[0] || null;
  const documentImages = selectedDocument ? images.filter((image) => image.documentId === selectedDocument.id) : [];
  const selectedImage = documentImages.find((image) => image.id === selectedImageId) || documentImages[0] || null;

  useEffect(() => {
    if (!open) return;
    loadImages("");
  }, [open, selectedIds.join("|")]);

  if (!open) return null;

  async function loadImages(keyword = query) {
    setStatus("loading");
    setError("");
    setInsertStatus("");
    try {
      const nextImages = await searchKnowledgeImages({
        query: keyword,
        kbIds: selectedProjectKnowledgeBaseIds,
        globalKbIds: selectedGlobalKnowledgeBaseIds,
      });
      setImages(nextImages);
      setSelectedDocumentId(nextImages[0]?.documentId || "");
      setSelectedImageId(nextImages[0]?.id || "");
      setStatus("ready");
    } catch (loadError) {
      setImages([]);
      setSelectedDocumentId("");
      setSelectedImageId("");
      setStatus("error");
      setError(loadError?.message || "知识库图片读取失败");
    }
  }

  async function insertSelectedImage() {
    if (!selectedImage) return;
    setInsertStatus("inserting");
    const result = await onInsert?.(selectedImage);
    if (result?.ok) {
      setInsertStatus("done");
      return;
    }
    setInsertStatus(result?.error || "图片插入失败，请确认左侧文档已加载并把光标放到插入位置。");
  }

  const selectedKnowledgeBaseNames = knowledgeBases
    .filter((base) => selectedIds.includes(base.id))
    .map((base) => base.name);

  return createPortal(
    <div className="knowledge-table-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="knowledge-table-modal knowledge-image-modal" role="dialog" aria-modal="true" aria-label="插入知识库图片" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="knowledge-table-toolbar">
          <label className="knowledge-table-search">
            <Search size={15} />
            <input
              value={query}
              placeholder="搜索图片标题或文档名"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadImages();
              }}
            />
          </label>
          <button className="tool-button" type="button" onClick={() => loadImages()} disabled={status === "loading" || selectedIds.length === 0}>
            {status === "loading" ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            检索
          </button>
        </div>
        <div className="knowledge-table-scope">
          {selectedIds.length === 0 ? emptyScopeMessage : `当前范围：${selectedKnowledgeBaseNames.join("、")}`}
        </div>
        <div className="knowledge-table-body">
          <aside className="knowledge-table-documents">
            {status === "loading" ? (
              <div className="knowledge-table-empty"><Loader2 size={16} className="spin" /> 正在读取原文图片</div>
            ) : error ? (
              <div className="knowledge-table-empty error">{error}</div>
            ) : documents.length === 0 ? (
              <div className="knowledge-table-empty">未找到含图片的 Word 文档</div>
            ) : documents.map((document) => (
              <button
                className={document.id === selectedDocument?.id ? "knowledge-table-document active" : "knowledge-table-document"}
                type="button"
                key={document.id}
                onClick={() => {
                  setSelectedDocumentId(document.id);
                  setSelectedImageId(document.firstImageId);
                  setInsertStatus("");
                }}
              >
                <FileText size={16} />
                <span>
                  <strong title={document.name}>{document.name}</strong>
                  <em>{document.knowledgeBaseName} · {document.imageCount} 张图片</em>
                </span>
              </button>
            ))}
          </aside>
          <aside className="knowledge-table-list">
            {selectedDocument ? documentImages.map((image) => (
              <button
                className={image.id === selectedImage?.id ? "knowledge-table-item active" : "knowledge-table-item"}
                type="button"
                key={image.id}
                onClick={() => {
                  setSelectedImageId(image.id);
                  setInsertStatus("");
                }}
              >
                <ImageIcon size={16} />
                <span>
                  <strong>{image.title || `图片 ${image.imageIndex}`}</strong>
                  <em>{image.imageCount > 1 ? `${image.imageCount}张图片` : "1张图片"}{image.page ? ` · 第${image.page}页` : ""}</em>
                </span>
              </button>
            )) : <div className="knowledge-table-empty">请选择 Word 文档</div>}
          </aside>
          <main className="knowledge-table-preview">
            {selectedImage ? (
              <>
                <div className="knowledge-table-preview-head">
                  <div>
                    <strong>{selectedImage.title || `图片 ${selectedImage.imageIndex}`}</strong>
                    <span><FileText size={14} /> {selectedImage.documentName}{selectedImage.page ? ` · 第${selectedImage.page}页` : ""}</span>
                  </div>
                  <button className="tool-button primary" type="button" onClick={insertSelectedImage} disabled={insertStatus === "inserting"}>
                    {insertStatus === "inserting" ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
                    {insertButtonLabel}
                  </button>
                </div>
                <div className="knowledge-table-preview-scroll knowledge-image-preview-scroll">
                  <img src={selectedImage.previewUrl} alt={selectedImage.title || "资料图片预览"} />
                </div>
                {insertStatus && insertStatus !== "inserting" ? (
                  <div className={insertStatus === "done" ? "knowledge-table-status done" : "knowledge-table-status error"}>
                    {insertStatus === "done" ? "已插入当前光标位置" : insertStatus}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="knowledge-table-empty">请选择左侧图片</div>
            )}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function groupImagesByDocument(images) {
  const byDocument = new Map();
  images.forEach((image) => {
    const id = image.documentId || image.fileName || image.documentName || "unknown";
    if (!byDocument.has(id)) {
      byDocument.set(id, {
        id,
        name: image.documentName || image.fileName || "未命名文档",
        fileName: image.fileName || "",
        knowledgeBaseName: image.knowledgeBaseName || "",
        imageCount: 0,
        firstImageId: image.id,
      });
    }
    const document = byDocument.get(id);
    document.imageCount += Number(image.imageCount || 1) || 1;
  });
  return [...byDocument.values()];
}

export default KnowledgeImagePicker;

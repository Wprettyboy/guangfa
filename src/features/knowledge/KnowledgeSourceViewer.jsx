import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, X } from "lucide-react";
import { createKnowledgeDocumentOfficePreview } from "../../services/knowledgeBase.js";
import { OnlyOfficePreview, requestOnlyOfficeGoToBookmark, requestOnlyOfficeGoToPage } from "../docx/office/bridge.jsx";

function KnowledgeSourceViewer({ result }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (result.sourceFileAvailable === false) {
    return <span className="knowledge-source-missing">原文件已删除，请重新上传</span>;
  }
  if (String(result.sourceFileType || "").toLowerCase() !== "docx") return null;

  async function openViewer() {
    setOpen(true);
    setError("");
    if (preview) return;
    setLoading(true);
    try {
      const data = await createKnowledgeDocumentOfficePreview(result.documentId);
      if (!data?.available || !data.config || !data.serverUrl) throw new Error("OnlyOffice 服务不可用");
      setPreview(data);
    } catch (loadError) {
      setError(loadError.message || "原始 DOCX 预览初始化失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="tool-button" type="button" onClick={openViewer}>
        <FileText size={15} />
        打开原文
      </button>
      {open ? createPortal(
        <div className="knowledge-table-backdrop knowledge-source-viewer-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="knowledge-source-viewer-modal" role="dialog" aria-modal="true" aria-label="打开原始 DOCX" onMouseDown={(event) => event.stopPropagation()}>
            <header className="knowledge-source-viewer-header">
              <div>
                <strong>{result.documentName || "原始 DOCX"}</strong>
                <span>{result.page ? `MinerU 解析页序第${result.page}页` : "原格式查看"} · {result.headingPath || "当前检索结果"}</span>
              </div>
              <button className="icon-button quiet" type="button" onClick={() => setOpen(false)} aria-label="关闭原文预览" title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="knowledge-source-viewer-body">
              {loading ? <div className="knowledge-source-viewer-status"><Loader2 size={18} className="spin" />正在初始化原始 DOCX 预览</div> : null}
              {error ? <div className="knowledge-source-viewer-status error">{error}</div> : null}
              {preview ? (
                <OnlyOfficePreview
                  config={preview.config}
                  serverUrl={preview.serverUrl}
                  mode="source"
                  onReady={() => {
                    window.setTimeout(() => {
                      if (result.locator?.type === "bookmark" && result.locator.anchor) {
                        requestOnlyOfficeGoToBookmark(result.locator.anchor);
                      } else if (result.page) {
                        requestOnlyOfficeGoToPage(result.page);
                      }
                    }, 700);
                  }}
                  onError={() => setError("原始 DOCX 编辑器加载失败")}
                />
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export default KnowledgeSourceViewer;

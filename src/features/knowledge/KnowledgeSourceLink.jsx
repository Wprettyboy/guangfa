import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { readKnowledgeSourcePdf } from "../../services/knowledgeBase.js";
import KnowledgeSourcePreviewModal from "./KnowledgeSourcePreviewModal.jsx";

function KnowledgeSourceLink({ documentId, page, highlightText = "", available = true }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  if (!available || !documentId || !page) return null;
  return (
    <>
      <button
        className="text-button knowledge-source-link"
        type="button"
        disabled={loading}
        onClick={async (event) => {
          event.stopPropagation();
          setLoading(true);
          try {
            const blob = await readKnowledgeSourcePdf(documentId);
            setPreview({ blob, page, highlightText });
          } catch (error) {
            window.alert(error.message || "原文 PDF 读取失败");
          } finally {
            setLoading(false);
          }
        }}
      >
        <ExternalLink size={14} />
        {loading ? "加载原文" : `查看原文第${page}页`}
      </button>
      {preview ? <KnowledgeSourcePreviewModal {...preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

export default KnowledgeSourceLink;

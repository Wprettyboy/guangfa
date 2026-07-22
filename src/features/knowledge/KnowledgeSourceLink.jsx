import { ExternalLink } from "lucide-react";
import { openKnowledgeSourcePdf } from "../../services/knowledgeBase.js";

function KnowledgeSourceLink({ documentId, page, available = true }) {
  if (!available || !documentId || !page) return null;
  return (
    <button
      className="text-button knowledge-source-link"
      type="button"
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await openKnowledgeSourcePdf(documentId, page);
        } catch (error) {
          window.alert(error.message || "原文 PDF 读取失败");
        }
      }}
    >
      <ExternalLink size={14} />
      查看原文第{page}页
    </button>
  );
}

export default KnowledgeSourceLink;

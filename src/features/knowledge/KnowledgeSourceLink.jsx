import { useState } from "react";
import { ExternalLink } from "lucide-react";
import KnowledgePdfEvidenceViewer from "./KnowledgePdfEvidenceViewer.jsx";

function KnowledgeSourceLink({ documentId, page, available = true, bbox = null, documentName = "", sourceText = "" }) {
  const [open, setOpen] = useState(false);
  if (!available || !documentId || !page) return null;
  return (
    <>
      <button
        className="text-button knowledge-source-link"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <ExternalLink size={14} />
        查看原文第{page}页
      </button>
      {open ? (
        <KnowledgePdfEvidenceViewer
          documentId={documentId}
          page={page}
          bbox={bbox}
          documentName={documentName}
          sourceText={sourceText}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export default KnowledgeSourceLink;

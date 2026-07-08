import React, { useMemo, useState } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import KnowledgeImagePicker from "../knowledge/KnowledgeImagePicker.jsx";

function SolutionIllustrationPanel({
  knowledgeBases = [],
  selectedProjectKnowledgeBaseIds = [],
  selectedGlobalKnowledgeBaseIds = [],
  onInsertImage,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const selectedIds = useMemo(
    () => [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds],
    [selectedGlobalKnowledgeBaseIds, selectedProjectKnowledgeBaseIds],
  );
  const selectedBases = knowledgeBases.filter((base) => selectedIds.includes(base.id));

  async function insertImage(image) {
    setStatus("inserting");
    setMessage("");
    const result = await onInsertImage?.(image);
    if (result?.ok) {
      setStatus("idle");
      setMessage(`已插入配图：${image?.title || image?.documentName || "资料图片"}`);
      return result;
    }
    setStatus("error");
    const error = result?.error || "图片插入失败，请确认左侧文档已加载并把光标放到插入位置。";
    setMessage(error);
    return { ok: false, error };
  }

  return (
    <div className="solution-illustration-panel">
      <section className="solution-block">
        <div className="solution-task-toolbar">
          <div>
            <strong>方案配图</strong>
            <span>从已选知识库原 Word 文档中选择图片，并通过 OnlyOffice DOCX 片段插入到当前光标位置</span>
          </div>
          <div className="solution-task-actions">
            <button className="tool-button primary" type="button" onClick={() => setPickerOpen(true)} disabled={status === "inserting"}>
              {status === "inserting" ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
              选择配图
            </button>
          </div>
        </div>

        <div className="solution-task-stats">
          <span>知识库 {selectedBases.length} 个</span>
          <span>插入方式 DOCX片段</span>
          <span>位置 当前光标</span>
        </div>

        {selectedBases.length ? (
          <div className="solution-illustration-scope">
            {selectedBases.map((base) => <span key={base.id}>{base.name}</span>)}
          </div>
        ) : (
          <div className="empty-state compact">请先在“知识库范围”里选择包含图片的项目库或全局库。</div>
        )}

        {message ? <div className={status === "error" ? "solution-message error" : "solution-message"}>{message}</div> : null}
      </section>

      <KnowledgeImagePicker
        open={pickerOpen}
        title="插入方案配图"
        emptyScopeMessage="请先在方案编写的知识库范围中选择项目库或全局库。"
        insertButtonLabel="插入配图"
        knowledgeBases={knowledgeBases}
        selectedProjectKnowledgeBaseIds={selectedProjectKnowledgeBaseIds}
        selectedGlobalKnowledgeBaseIds={selectedGlobalKnowledgeBaseIds}
        onInsert={insertImage}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export default SolutionIllustrationPanel;

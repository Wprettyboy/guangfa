import React from "react";
import { RotateCcw } from "lucide-react";

const emptyKnowledgeSearchFilters = {
  documentIds: [],
  pageFrom: "",
  pageTo: "",
  isTable: null,
  blockTypes: [],
  hasStar: false,
};

function KnowledgeSearchFilters({ documents = [], value = emptyKnowledgeSearchFilters, onChange }) {
  const tableMode = value.blockTypes?.some((type) => type === "image" || type === "image-segment")
    ? "image"
    : value.isTable == null ? "all" : value.isTable ? "table" : "body";

  function update(patch) {
    onChange?.({ ...value, ...patch });
  }

  return (
    <div className="knowledge-search-filters" aria-label="检索筛选条件">
      <select
        value={value.documentIds?.[0] || ""}
        onChange={(event) => update({ documentIds: event.target.value ? [event.target.value] : [] })}
        aria-label="筛选资料"
      >
        <option value="">全部资料</option>
        {documents.map((document) => <option value={document.id} key={document.id}>{document.name}</option>)}
      </select>
      <label className="knowledge-page-filter">
        <span>页码</span>
        <input
          type="number"
          min="1"
          value={value.pageFrom ?? ""}
          onChange={(event) => update({ pageFrom: event.target.value })}
          placeholder="起"
          aria-label="起始页"
        />
        <span>至</span>
        <input
          type="number"
          min="1"
          value={value.pageTo ?? ""}
          onChange={(event) => update({ pageTo: event.target.value })}
          placeholder="止"
          aria-label="结束页"
        />
      </label>
      <div className="knowledge-block-segments" role="group" aria-label="分段类型">
        {[{ id: "all", label: "全部" }, { id: "body", label: "正文" }, { id: "table", label: "表格" }, { id: "image", label: "图片" }].map((item) => (
          <button
            className={tableMode === item.id ? "active" : ""}
            type="button"
            key={item.id}
            aria-pressed={tableMode === item.id}
            onClick={() => update({
              isTable: item.id === "all" || item.id === "image" ? null : item.id === "table",
              blockTypes: item.id === "image" ? ["image", "image-segment"] : [],
            })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="knowledge-star-filter">
        <input type="checkbox" checked={Boolean(value.hasStar)} onChange={(event) => update({ hasStar: event.target.checked })} />
        仅星号项
      </label>
      <button className="icon-button quiet" type="button" onClick={() => onChange?.({ ...emptyKnowledgeSearchFilters })} title="清除筛选" aria-label="清除筛选">
        <RotateCcw size={15} />
      </button>
    </div>
  );
}

export { emptyKnowledgeSearchFilters };
export default KnowledgeSearchFilters;

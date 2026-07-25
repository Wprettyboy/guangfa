import React, { useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";

const emptyKnowledgeSearchFilters = {
  documentIds: [],
  pageFrom: "",
  pageTo: "",
  isTable: null,
  blockTypes: [],
  hasStar: false,
};

function KnowledgeSearchFilters({ documents = [], value = emptyKnowledgeSearchFilters, onChange }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const tableMode = value.blockTypes?.some((type) => type === "image" || type === "image-segment")
    ? "image"
    : value.isTable == null ? "all" : value.isTable ? "table" : "body";
  const hasPageFilter = value.pageFrom !== "" || value.pageTo !== "";

  function update(patch) {
    onChange?.({ ...value, ...patch });
  }

  return (
    <div className="knowledge-search-filters" aria-label="检索筛选条件">
      <div className="knowledge-filter-row">
        <select
          value={value.documentIds?.[0] || ""}
          onChange={(event) => update({ documentIds: event.target.value ? [event.target.value] : [] })}
          aria-label="筛选资料"
        >
          <option value="">全部资料</option>
          {documents.map((document) => <option value={document.id} key={document.id}>{document.name}</option>)}
        </select>
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
        <button className="text-button knowledge-filter-more" type="button" onClick={() => setShowAdvanced((expanded) => !expanded)} aria-expanded={showAdvanced || hasPageFilter}>
          <SlidersHorizontal size={14} />
          更多筛选
          <ChevronDown size={14} className={showAdvanced || hasPageFilter ? "rotated" : ""} />
        </button>
        <button className="icon-button quiet" type="button" onClick={() => {
          setShowAdvanced(false);
          onChange?.({ ...emptyKnowledgeSearchFilters });
        }} title="清除筛选" aria-label="清除筛选">
          <RotateCcw size={15} />
        </button>
      </div>
      {showAdvanced || hasPageFilter ? (
        <div className="knowledge-filter-advanced">
          <label className="knowledge-page-filter">
            <span>页码范围</span>
            <input
              type="number"
              min="1"
              value={value.pageFrom ?? ""}
              onChange={(event) => update({ pageFrom: event.target.value })}
              placeholder="起始"
              aria-label="起始页"
            />
            <span>至</span>
            <input
              type="number"
              min="1"
              value={value.pageTo ?? ""}
              onChange={(event) => update({ pageTo: event.target.value })}
              placeholder="结束"
              aria-label="结束页"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export { emptyKnowledgeSearchFilters };
export default KnowledgeSearchFilters;

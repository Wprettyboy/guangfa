import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Image, Info, Loader2, MapPin, Maximize2, Search, X } from "lucide-react";
import useApiAssetUrl from "../../hooks/useApiAssetUrl.js";
import { readKnowledgeTableEvidence } from "../../services/knowledgeBase.js";
import KnowledgeSourceLink from "./KnowledgeSourceLink.jsx";
import KnowledgeSourceViewer from "./KnowledgeSourceViewer.jsx";
import KnowledgeSearchFilters from "./KnowledgeSearchFilters.jsx";

const degradedReasonLabels = {
  encode_timeout: "查询编码超时",
  encode_circuit_open: "查询编码服务暂时不可用",
  sparse_invalid: "稀疏向量响应无效",
  reranker_timeout: "重排序超时，已使用融合结果",
  reranker_circuit_open: "重排序服务暂时不可用",
  retrieval_oom: "检索模型显存不足",
  zvec_unavailable: "向量索引不可用",
  index_version_mismatch: "索引版本不一致",
};

function KnowledgeSearchPreview({
  selectedBase,
  searchTerm,
  appliedSearch,
  searchFilters,
  searchResults,
  searchDiagnostics,
  searchError,
  searching,
  searchDirty,
  selectedResult,
  onSearchTermChange,
  onSearchFiltersChange,
  onSearch,
  onSelectResult,
  onOpenImageEvidence,
}) {
  const appliedTerm = appliedSearch?.term || searchTerm;
  const hasSearched = Boolean(appliedSearch);

  return (
    <section className="knowledge-search-preview" aria-label="检索预览">
      <form className="knowledge-search-form" onSubmit={onSearch}>
        <div className="search-box editable">
          <Search size={16} />
          <input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="搜索项目名称、评审办法、业绩要求" />
        </div>
        <button className="tool-button solid" type="submit" disabled={searching}>
          {searching ? <Loader2 size={16} className="spin" /> : null}
          {searching ? "检索中" : searchDirty ? "重新检索" : "检索"}
        </button>
      </form>
      <KnowledgeSearchFilters
        documents={selectedBase?.documents || []}
        value={searchFilters}
        onChange={onSearchFiltersChange}
      />
      {searchDirty ? <div className="knowledge-search-pending">筛选条件已修改，当前结果仍基于上一次检索。请点击“重新检索”应用条件。</div> : null}
      {searchDiagnostics ? <KnowledgeSearchDiagnostics diagnostics={searchDiagnostics} resultCount={searchResults.length} /> : null}
      {searchError ? <div className="knowledge-search-error">{searchError}</div> : null}
      <div className="knowledge-search-content">
        <div className="knowledge-result-list-pane">
          <div className="knowledge-result-summary">
            {searching ? "正在更新检索结果..." : hasSearched ? `共 ${searchResults.length} 条结果` : "尚未检索"}
          </div>
          <div className="knowledge-result-list">
            {searchResults.length ? (
              searchResults.map((result, index) => (
                <button
                  className={result.id === selectedResult?.id ? "knowledge-result-row selected" : "knowledge-result-row"}
                  key={result.id}
                  onClick={() => onSelectResult(result.id)}
                >
                  <span className="knowledge-result-rank">{index + 1}</span>
                  <div>
                    <strong>{getResultTitle(result)}</strong>
                    <span>{getResultMetadata(result)}</span>
                    <p>{isTableResult(result) ? "表格证据 · 点击查看结构化内容" : renderKnowledgeText(getKnowledgePreview(result.sourceText || result.text, appliedTerm), appliedTerm)}</p>
                  </div>
                </button>
              ))
            ) : (
              <SearchEmptyState searching={searching} hasSearched={hasSearched} />
            )}
          </div>
        </div>
        <KnowledgeResultDetail result={selectedResult} query={appliedTerm} onOpenImageEvidence={onOpenImageEvidence} />
      </div>
    </section>
  );
}

function SearchEmptyState({ searching, hasSearched }) {
  if (searching) {
    return <div className="empty-state compact"><Loader2 size={17} className="spin" /><span>正在检索</span></div>;
  }
  return <div className="empty-state compact"><Info size={17} /><span>{hasSearched ? "没有匹配结果" : "尚未检索"}</span></div>;
}

function KnowledgeResultDetail({ result, query, onOpenImageEvidence }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  if (!result) {
    return <div className="knowledge-result-detail empty-state compact"><Info size={17} /><span>选择检索结果后查看证据</span></div>;
  }
  const content = (
    <KnowledgeResultDetailContent
      result={result}
      query={query}
      onOpenImageEvidence={onOpenImageEvidence}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onClose={() => setExpanded(false)}
    />
  );
  if (!expanded) return content;
  return (
    <>
      <div className="knowledge-result-detail knowledge-result-detail-expanded-placeholder">
        <Maximize2 size={18} />
        <span>详情已在浮窗中打开</span>
        <button className="text-button" type="button" onClick={() => setExpanded(false)}>返回详情</button>
      </div>
      {createPortal(
        <div className="knowledge-table-backdrop knowledge-detail-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
          <section className="knowledge-result-detail-modal" role="dialog" aria-modal="true" aria-label="放大查看检索详情" onMouseDown={(event) => event.stopPropagation()}>
            {content}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function KnowledgeResultDetailContent({ result, query, onOpenImageEvidence, expanded, onExpand, onClose }) {
  const imageUrl = result?.sourceAssetId ? `/api/knowledge-document-images/${encodeURIComponent(result.sourceAssetId)}/file` : "";
  const asset = useApiAssetUrl(imageUrl);
  return (
    <article className={expanded ? "knowledge-result-detail knowledge-result-detail-modal-content" : "knowledge-result-detail"}>
      <header className="knowledge-result-detail-header">
        <div>
          <span className="knowledge-result-type">{getResultTypeLabel(result)}</span>
          <strong>{result.headingPath || result.documentName}</strong>
          <span>{result.documentName} · {getSourceLabel(result)} · {getLocatorLabel(result)}</span>
        </div>
        <div className="knowledge-result-actions">
          <KnowledgeSourceLink documentId={result.documentId} page={result.physicalPage || result.page} available={result.sourcePdfAvailable} />
          <KnowledgeSourceViewer result={result} />
          {result.sourceAssetId ? (
            <button className="tool-button" type="button" onClick={() => onOpenImageEvidence(result.sourceAssetId)}>
              <Image size={15} />
              打开原图
            </button>
          ) : null}
          <button className="icon-button quiet" type="button" onClick={expanded ? onClose : onExpand} aria-label={expanded ? "关闭详情浮窗" : "展开详情浮窗"} title={expanded ? "关闭详情浮窗" : "展开详情浮窗"}>
            {expanded ? <X size={18} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </header>
      <KnowledgeSourceTrace result={result} />
      {result.sourceAssetId ? <ImageEvidence asset={asset} documentName={result.documentName} /> : null}
      {isTableResult(result) ? <KnowledgeTableEvidence result={result} query={query} /> : <p>{renderKnowledgeText(result.sourceText || result.text, query)}</p>}
    </article>
  );
}

function KnowledgeSourceTrace({ result }) {
  const bbox = Array.isArray(result.locator?.bbox) && result.locator.bbox.length === 4 ? result.locator.bbox : null;
  const pageLabel = result.sourcePdfAvailable
    ? result.page ? `第${result.page}页` : "未记录页码"
    : result.physicalPage
      ? `第${result.physicalPage}页`
      : result.page ? `标题映射中（解析页序 ${result.page}）` : "标题映射中";
  const statusLabel = result.sourcePdfAvailable ? "可查看分页原文" : result.physicalPage ? "标题物理页" : "等待页码映射";
  return (
    <section className="knowledge-source-trace" aria-label="原文溯源信息">
      <div className="knowledge-source-trace-title">
        <span><MapPin size={15} /> 原文溯源</span>
        <em>{statusLabel}</em>
      </div>
      <dl>
        <div>
            <dt>{result.physicalPage ? "章节起始页" : "页码"}</dt>
            <dd>{pageLabel}</dd>
        </div>
        <div>
          <dt>定位精度</dt>
          <dd>{getLocatorLabel(result)}</dd>
        </div>
        {bbox ? (
          <div>
            <dt>解析区域</dt>
            <dd>{bbox.map((value) => formatLocatorNumber(value)).join("，")}</dd>
          </div>
        ) : null}
        {result.headingPath ? (
          <div>
            <dt>标题路径</dt>
            <dd>{result.headingPath}</dd>
          </div>
        ) : null}
      </dl>
      <p>
        {result.sourcePdfAvailable
          ? "当前结果包含可分页原文，可使用右上角入口打开对应页。"
          : result.physicalPage
          ? "页码来自 OnlyOffice 对原始 DOCX 的标题映射，表示章节起始页；打开原文时仍会按标题定位。"
          : "当前结果已保留标题定位；物理页码映射完成后会显示，打开原文时仍可按标题定位。"}
      </p>
    </section>
  );
}

function KnowledgeTableEvidence({ result, query }) {
  const [state, setState] = useState({ status: "loading", table: null, error: "" });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: "loading", table: null, error: "" });
    readKnowledgeTableEvidence(result.id)
      .then((table) => {
        if (active) setState({ status: "ready", table, error: "" });
      })
      .catch((error) => {
        if (active) setState({ status: "error", table: null, error: error.message || "表格原始结构读取失败" });
      });
    return () => { active = false; };
  }, [result.id]);

  if (state.status === "loading") {
    return <div className="knowledge-table-evidence-status"><Loader2 size={16} className="spin" />正在读取原始表格结构</div>;
  }
  if (state.status === "error" || !state.table) {
    return <><div className="knowledge-table-evidence-status error">{state.error}</div><p>{renderKnowledgeText(result.sourceText || result.text, query)}</p></>;
  }
  const { table } = state;
  return (
    <>
      <div className="knowledge-table-evidence-toolbar">
        <span>{table.rows.length} 行 · {table.columnCount} 列</span>
        <button className="tool-button" type="button" onClick={() => setExpanded(true)}>
          <Maximize2 size={15} />
          放大查看
        </button>
      </div>
      <div className="knowledge-result-table-scroll" aria-label={`表格证据，共${table.rows.length}行${table.columnCount}列`}>
        <KnowledgeTableGrid table={table} query={query} />
      </div>
      {expanded ? <KnowledgeTableEvidenceModal result={result} table={table} query={query} onClose={() => setExpanded(false)} /> : null}
    </>
  );
}

function KnowledgeTableGrid({ table, query }) {
  return (
    <table>
      {table.header?.length ? <thead><tr>{table.header.map((cell, index) => <th key={`header-${index}`} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{renderKnowledgeText(cell.text, query)}</th>)}</tr></thead> : null}
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => <td key={`row-${rowIndex}-cell-${cellIndex}`} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{renderKnowledgeText(cell.text, query)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KnowledgeTableEvidenceModal({ result, table, query, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="knowledge-table-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="knowledge-table-evidence-modal" role="dialog" aria-modal="true" aria-label="放大查看表格证据" onMouseDown={(event) => event.stopPropagation()}>
        <header className="knowledge-table-evidence-modal-header">
          <div>
            <span>表格证据 · {table.rows.length} 行 · {table.columnCount} 列</span>
            <strong>{result.headingPath || result.documentName}</strong>
            <em>{result.documentName} · {getSourceLabel(result)}</em>
          </div>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭表格放大查看" title="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="knowledge-table-evidence-modal-body">
          <div className="knowledge-result-table-scroll knowledge-table-evidence-modal-scroll">
            <KnowledgeTableGrid table={table} query={query} />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ImageEvidence({ asset, documentName }) {
  if (asset.loading) return <div className="knowledge-image-evidence loading"><Loader2 size={17} className="spin" />正在加载图片证据</div>;
  if (asset.error) return <div className="knowledge-image-evidence error">{asset.error}</div>;
  if (!asset.url) return null;
  return <div className="knowledge-image-evidence"><img src={asset.url} alt={`${documentName} 图片证据`} /></div>;
}

function KnowledgeSearchDiagnostics({ diagnostics, resultCount }) {
  const [expanded, setExpanded] = useState(false);
  const degraded = diagnostics.degradedReasons || [];
  const mode = diagnostics.channels?.keyword
    ? "关键词降级"
    : diagnostics.channels?.sparse
      ? "Dense + Sparse + FTS"
      : "Dense + FTS";
  return (
    <div className={degraded.length ? "knowledge-search-diagnostics degraded" : "knowledge-search-diagnostics"}>
      <span>{degraded.length ? "检索已降级" : "检索正常"}</span>
      <span>{resultCount} 条结果</span>
      <span>{diagnostics.elapsedMs || 0}ms</span>
      {degraded.length ? <strong>{degraded.map((reason) => degradedReasonLabels[reason] || reason).join("；")}</strong> : null}
      <button className="text-button knowledge-diagnostics-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        检索详情
        <ChevronDown size={14} className={expanded ? "rotated" : ""} />
      </button>
      {expanded ? (
        <div className="knowledge-diagnostics-detail">
          <span>索引 {diagnostics.indexVersion || "不可用"}</span>
          <span>{mode}</span>
          <span>候选 {diagnostics.candidateCount || 0} / 返回 {diagnostics.finalCount || 0}</span>
          <span>重排序 {diagnostics.reranker || "skipped"}</span>
          <span>上下文约 {diagnostics.contextTokensEstimated || 0} tokens</span>
        </div>
      ) : null}
    </div>
  );
}

function getResultTitle(result) {
  const type = getResultTypeLabel(result);
  return result.headingPath ? `${type} · ${result.headingPath}` : `${type} · ${result.documentName}`;
}

function getResultMetadata(result) {
  return `${result.scope === "global" ? "全局库" : "项目库"} · ${getSourceLabel(result)}`;
}

function getResultTypeLabel(result) {
  if (result.evidenceType === "image") return "图片证据";
  if (result.evidenceType === "table" || String(result.blockType || "").startsWith("table")) return "表格";
  return "正文";
}

function isTableResult(result) {
  return getResultTypeLabel(result) === "表格";
}

function getSourceLabel(result) {
  if (result.sourcePdfAvailable) return result.sourceLocation || `第${result.page}页`;
  if (result.physicalPage) return `第${result.physicalPage}页（章节起始）`;
  if (result.page) return `解析页序 ${result.page}`;
  return "结构定位";
}

function getLocatorLabel(result) {
  return result.locatorGrade === "exact" ? "精确定位" : "上下文定位";
}

function formatLocatorNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : "-";
}

function getKnowledgePreview(text, query, maxLength = 220) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  const terms = createKnowledgeDisplayTerms(query);
  const hitIndex = terms.reduce((best, term) => {
    const index = value.toLowerCase().indexOf(term.toLowerCase());
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const start = hitIndex >= 0 ? Math.max(0, hitIndex - 70) : 0;
  const end = Math.min(value.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${value.slice(start, end).trim()}${end < value.length ? "..." : ""}`;
}

function renderKnowledgeText(text, query) {
  const value = String(text || "");
  const terms = createKnowledgeDisplayTerms(query);
  if (!value || terms.length === 0) return value;
  const escapedTerms = terms.map(escapeKnowledgeRegExp).filter(Boolean);
  if (escapedTerms.length === 0) return value;
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  return value.split(pattern).map((part, index) => {
    if (!part) return null;
    return terms.some((term) => part.toLowerCase() === term.toLowerCase())
      ? <mark className="knowledge-hit" key={`${part}-${index}`}>{part}</mark>
      : part;
  });
}

function createKnowledgeDisplayTerms(query) {
  return [...new Set(String(query || "").trim().split(/[\s,，。；;、:：()（）]+/).map((term) => term.trim()).filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length);
}

function escapeKnowledgeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default KnowledgeSearchPreview;

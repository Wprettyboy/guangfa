import React, { useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { apiRequest } from "../services/apiClient.js";

function KnowledgeBaseManagement({
  canEdit = true,
  knowledgeBases,
  selectedKnowledgeBaseId,
  projectId,
  onSelectKnowledgeBase,
  onCreateKnowledgeBase,
  onUploadDocuments,
  onDeleteKnowledgeBase,
  onDeleteDocument,
  onRefresh,
}) {
  const fileInputRef = useRef(null);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseScope, setNewBaseScope] = useState("project");
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [expandedKnowledgeGroups, setExpandedKnowledgeGroups] = useState({ project: true, global: true });
  const selectedBase = knowledgeBases.find((base) => base.id === selectedKnowledgeBaseId) || knowledgeBases[0];
  const selectedResult = searchResults.find((item) => item.id === selectedResultId) || searchResults[0];
  const totalDocuments = knowledgeBases.reduce((sum, base) => sum + (base.documentCount || 0), 0);
  const totalChunks = knowledgeBases.reduce((sum, base) => sum + (base.chunkCount || 0), 0);
  const knowledgeTreeGroups = [
    {
      id: "project",
      name: "专项数据库",
      description: "按专题归集法规资料",
      items: knowledgeBases.filter((base) => base.scope !== "global"),
    },
    {
      id: "global",
      name: "全局库",
      description: "填充时需点名引用",
      items: knowledgeBases.filter((base) => base.scope === "global"),
    },
  ];

  useEffect(() => {
    if (!selectedKnowledgeBaseId && selectedBase?.id) {
      onSelectKnowledgeBase(selectedBase.id);
    }
  }, [onSelectKnowledgeBase, selectedBase, selectedKnowledgeBaseId]);

  async function handleCreateBase(event) {
    event.preventDefault();
    await onCreateKnowledgeBase({
      name: newBaseName,
      scope: newBaseScope,
      projectId,
    });
    setNewBaseName("");
  }

  async function handleUploadChange(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    await uploadSelectedFiles(files);
  }

  async function uploadSelectedFiles(files) {
    const fileList = [...(files || [])];
    if (!selectedBase || fileList.length === 0 || uploading) return;
    setUploading(true);
    setUploadError("");
    setUploadMessage(`正在解析并入库 ${fileList.length} 个资料...`);
    try {
      const count = await onUploadDocuments(selectedBase.id, fileList);
      setUploadMessage(`已完成 ${count} 个资料入库，可在右侧检索预览中搜索验证。`);
    } catch (error) {
      setUploadError(error.message || "资料入库失败，请检查文件格式或后端配置。");
      setUploadMessage("");
    } finally {
      setUploading(false);
    }
  }

  function handleDropUpload(event) {
    event.preventDefault();
    uploadSelectedFiles([...(event.dataTransfer.files || [])]);
  }

  async function handleDeleteBase(base) {
    const documentCount = base.documentCount || 0;
    const chunkCount = base.chunkCount || 0;
    const message = `确定删除知识库“${base.name}”吗？\n\n将同时删除 ${documentCount} 个资料、${chunkCount} 个切片，此操作不可恢复。`;
    if (!window.confirm(message)) return;
    await onDeleteKnowledgeBase(base.id);
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setSelectedResultId("");
      return;
    }
    setSearching(true);
    try {
      const results = await searchKnowledge(searchTerm, projectId, selectedBase);
      setSearchResults(results);
      setSelectedResultId(results[0]?.id || "");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="knowledge-manager">
      <div className="manager-toolbar">
        <div>
          <h2>知识库管理</h2>
          <p>项目资料与全局资料统一入库，AI 填充时自动召回相关片段作为证据。</p>
        </div>
        <button className="tool-button" onClick={onRefresh}>
          <RotateCcw size={17} />
          刷新
        </button>
      </div>

      <div className="manager-summary">
        <div className="summary-card">
          <span>知识库</span>
          <strong>{knowledgeBases.length}</strong>
          <em>专项数据库 / 全局库</em>
        </div>
        <div className="summary-card">
          <span>资料</span>
          <strong>{totalDocuments}</strong>
          <em>已入库</em>
        </div>
        <div className="summary-card">
          <span>切片</span>
          <strong>{totalChunks}</strong>
          <em>可检索片段</em>
        </div>
      </div>

      <div className="knowledge-grid">
        <aside className="knowledge-sidebar panel-section">
          <div className="panel-title">
            <h2>知识库</h2>
            <span className="soft-count">{knowledgeBases.length} 个</span>
          </div>
          {canEdit ? <form className="knowledge-create" onSubmit={handleCreateBase}>
            <input value={newBaseName} onChange={(event) => setNewBaseName(event.target.value)} placeholder="新建知识库名称" />
            <select value={newBaseScope} onChange={(event) => setNewBaseScope(event.target.value)}>
              <option value="project">专项数据库</option>
              <option value="global">全局库</option>
            </select>
            <button className="tool-button solid" type="submit">
              <BookOpenText size={16} />
              新建
            </button>
          </form> : null}
          <div className="knowledge-base-tree" role="tree" aria-label="知识库树">
            {knowledgeTreeGroups.map((group) => (
              <div className="knowledge-tree-group" key={group.id}>
                <button
                  className="knowledge-tree-heading"
                  type="button"
                  aria-expanded={expandedKnowledgeGroups[group.id]}
                  onClick={() => setExpandedKnowledgeGroups((value) => ({ ...value, [group.id]: !value[group.id] }))}
                >
                  {expandedKnowledgeGroups[group.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <FolderOpen size={15} />
                  <div>
                    <strong>{group.name}</strong>
                    <span>{group.description}</span>
                  </div>
                  <em>{group.items.length}</em>
                </button>
                {expandedKnowledgeGroups[group.id] ? (
                  <div className="knowledge-tree-children">
                    {group.items.length ? (
                      group.items.map((base) => (
                        <div className={base.id === selectedBase?.id ? "knowledge-tree-node selected" : "knowledge-tree-node"} key={base.id} role="treeitem" aria-selected={base.id === selectedBase?.id}>
                          <span className="knowledge-tree-line" />
                          <button className="knowledge-tree-select" type="button" onClick={() => onSelectKnowledgeBase(base.id)}>
                            <BookOpenText size={15} />
                            <div>
                              <strong>{base.name}</strong>
                              <span>{base.indexStatus} · {base.documentCount || 0} 资料 / {base.chunkCount || 0} 片段</span>
                            </div>
                          </button>
                          {canEdit ? (
                            <button className="knowledge-tree-delete" type="button" aria-label={`删除${base.name}`} onClick={() => handleDeleteBase(base)}>
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="knowledge-tree-empty">
                        <span className="knowledge-tree-line" />
                        <em>暂无知识库</em>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <section className="knowledge-documents panel-section">
          <div className="panel-title align-top">
            <div>
              <h2>{selectedBase?.name || "未选择知识库"}</h2>
              <p>{selectedBase?.scope === "global" ? "全局资料会参与所有项目召回。" : "项目资料仅参与当前项目召回。"}</p>
            </div>
            {canEdit ? (
              <>
                <input
                  className="visually-hidden"
                  type="file"
                  accept=".docx,.txt,.md,.json,.csv"
                  multiple
                  ref={fileInputRef}
                  onChange={handleUploadChange}
                />
                <button className="tool-button primary" onClick={() => fileInputRef.current?.click()} disabled={!selectedBase || uploading}>
                  {uploading ? <Loader2 size={17} className="spin" /> : <Upload size={17} />}
                  {uploading ? "入库中" : "上传资料"}
                </button>
              </>
            ) : null}
          </div>
          {canEdit ? <div
            className={uploading ? "knowledge-upload-zone busy" : "knowledge-upload-zone"}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropUpload}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            {uploading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            <div>
              <strong>{uploading ? "正在入库资料" : "点击或拖拽资料入库"}</strong>
              <span>支持 DOCX、TXT、MD、JSON、CSV；资料会切片后进入当前知识库。</span>
            </div>
          </div> : null}
          {uploadMessage ? <div className="knowledge-upload-message ok">{uploadMessage}</div> : null}
          {uploadError ? <div className="knowledge-upload-message error">{uploadError}</div> : null}
          <div className="knowledge-document-table">
            {selectedBase?.documents?.length ? (
              selectedBase.documents.map((document) => (
                <div className="knowledge-document-row" key={document.id}>
                  <FileText size={17} />
                  <div>
                    <strong>{document.name}</strong>
                    <span>{document.size || "--"} · {document.chunkCount || 0} 片段 · {document.status}</span>
                    {document.error ? <em>{document.error}</em> : null}
                  </div>
                  {canEdit ? (
                    <button className="icon-button quiet" onClick={() => onDeleteDocument(selectedBase.id, document.id)} aria-label={`删除${document.name}`}>
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Database size={18} />
                <span>当前知识库暂无资料</span>
              </div>
            )}
          </div>
        </section>

        <aside className="knowledge-search panel-section">
          <div className="panel-title align-top">
            <div>
              <h2>检索预览</h2>
              <p>{selectedBase ? `仅检索当前选中的知识库：${selectedBase.name}` : "请选择知识库后检索。"}</p>
            </div>
          </div>
          <form className="knowledge-search-form" onSubmit={handleSearch}>
            <div className="search-box editable">
              <Search size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索项目名称、评审办法、业绩要求" />
            </div>
            <button className="tool-button solid" type="submit" disabled={searching}>
              {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              检索
            </button>
          </form>
          {searchTerm.trim() ? (
            <div className="knowledge-result-summary">
              {searching ? "正在检索..." : `共 ${searchResults.length} 条结果`}
            </div>
          ) : null}
          <div className="knowledge-result-list">
            {searchResults.length === 0 ? (
              <div className="empty-state compact">
                <Info size={17} />
                <span>暂无检索结果</span>
              </div>
            ) : (
              searchResults.map((result) => (
                <button
                  className={result.id === selectedResult?.id ? "knowledge-result-row selected" : "knowledge-result-row"}
                  key={result.id}
                  onClick={() => setSelectedResultId(result.id)}
                >
                  <strong>{result.documentName}</strong>
                  <span>{result.scope === "global" ? "全局库" : "项目库"} · {result.sourceLocation || `片段${result.chunkIndex}`} · {result.mode} · 相关度 {result.score}</span>
                  <p>{renderKnowledgeText(getKnowledgePreview(result.sourceText || result.text, searchTerm), searchTerm)}</p>
                </button>
              ))
            )}
          </div>
          {selectedResult ? (
            <div className="knowledge-result-detail">
              <strong>{selectedResult.documentName}</strong>
              <span>{selectedResult.sourceLocation || "旧资料缺少原文页码"} · 相关度 {selectedResult.score} · {selectedResult.scope === "global" ? "全局库" : "项目库"}</span>
              <p>{renderKnowledgeText(selectedResult.sourceText || selectedResult.text, searchTerm)}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
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
    return terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark className="knowledge-hit" key={`${part}-${index}`}>{part}</mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    );
  });
}
function createKnowledgeDisplayTerms(query) {
  const raw = String(query || "").trim();
  const normalized = raw.replace(/\s+/g, "");
  const stripped = normalized
    .replace(/^(请|帮我|根据|自动|获取|提取|生成|填写|填充|查询|搜索|查找)+/g, "")
    .replace(/(是什么|是啥|怎么写|如何写|怎么填|如何填|填写什么|填什么|多少天|多少|有哪些|是什么内容|的内容|内容|要求)$/g, "");
  const terms = [raw, normalized, stripped, ...raw.split(/[\s,，。；;、:：()（）]+/)];

  if (/项目名称|工程名称|项目名|工程名/.test(stripped)) terms.push("项目名称", "工程名称", "名称统一使用");
  if (/评审办法|评标办法|综合评分|综合评估|采购方式|招采方式/.test(stripped)) terms.push("综合评估法", "询比采购", "招采方式");
  if (/业绩|类似项目|合同金额|发票/.test(stripped)) terms.push("业绩要求", "类似项目业绩", "合同金额", "合同发票");
  if (/人员|技术负责人|安全员|专职安全/.test(stripped)) terms.push("人员要求", "技术负责人", "专职安全生产管理人员", "C2", "C3");
  if (/付款|支付|进度款|结算款|质保金/.test(stripped)) terms.push("付款方式", "进度款", "结算款", "质保金");
  if (/工期|日历天|进场通知/.test(stripped)) terms.push("工期", "日历天", "进场通知");
  if (/控制价|最高限价|预算金额/.test(stripped)) terms.push("采购控制价", "控制价", "最高限价");

  return [...new Set(terms.map((term) => String(term || "").trim()).filter((term) => term.length >= 2))]
    .sort((a, b) => b.length - a.length);
}
function escapeKnowledgeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function searchKnowledge(query, projectId, knowledgeBase) {
  const kbId = knowledgeBase?.id || "";
  const result = await apiRequest("/api/knowledge-bases/search", {
    method: "POST",
    json: {
      query,
      projectId,
      kbIds: kbId ? [kbId] : [],
      includeGlobal: false,
      topK: 8,
    },
    fallbackMessage: "知识库检索失败",
  });
  return Array.isArray(result) ? result : [];
}

export default KnowledgeBaseManagement;

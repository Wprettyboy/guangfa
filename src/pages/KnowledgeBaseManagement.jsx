import { useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import KnowledgeSearchPreview from "../features/knowledge/KnowledgeSearchPreview.jsx";
import { emptyKnowledgeSearchFilters } from "../features/knowledge/KnowledgeSearchFilters.jsx";
import { openKnowledgeImageEvidence, retryKnowledgeDocumentImages, searchKnowledgeBase } from "../services/knowledgeBase.js";

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
  const refreshRef = useRef(onRefresh);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseScope, setNewBaseScope] = useState("project");
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchDiagnostics, setSearchDiagnostics] = useState(null);
  const [searchFilters, setSearchFilters] = useState({ ...emptyKnowledgeSearchFilters });
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [appliedSearch, setAppliedSearch] = useState(null);
  const [activeKnowledgeView, setActiveKnowledgeView] = useState("documents");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [retryingDocumentId, setRetryingDocumentId] = useState("");
  const [expandedKnowledgeGroups, setExpandedKnowledgeGroups] = useState({ project: true, global: true });
  const selectedBase = knowledgeBases.find((base) => base.id === selectedKnowledgeBaseId) || knowledgeBases[0];
  const selectedResult = searchResults.find((item) => item.id === selectedResultId) || searchResults[0];
  const currentSearchSignature = createSearchSignature(searchTerm, toSearchFilters(searchFilters));
  const searchDirty = Boolean(appliedSearch && appliedSearch.signature !== currentSearchSignature);
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
  const hasActiveDocuments = knowledgeBases.some((base) =>
    base.documents?.some((document) => Boolean(document.processingStage)));

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!hasActiveDocuments) return undefined;
    let refreshing = false;
    const timer = window.setInterval(async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await refreshRef.current?.();
      } catch {
        // A later poll can recover from a transient refresh failure.
      } finally {
        refreshing = false;
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasActiveDocuments]);

  useEffect(() => {
    if (!selectedKnowledgeBaseId && selectedBase?.id) {
      onSelectKnowledgeBase(selectedBase.id);
    }
  }, [onSelectKnowledgeBase, selectedBase, selectedKnowledgeBaseId]);

  useEffect(() => {
    setSearchFilters({ ...emptyKnowledgeSearchFilters });
    setSearchResults([]);
    setSearchDiagnostics(null);
    setSelectedResultId("");
    setAppliedSearch(null);
    setSearchError("");
  }, [selectedBase?.id]);

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
    setUploadMessage(`正在上传 ${fileList.length} 个资料...`);
    try {
      const count = await onUploadDocuments(selectedBase.id, fileList);
      setUploadMessage(`已接收 ${count} 个资料，解析和图片识别将在后台继续。`);
    } catch (error) {
      setUploadError(error.message || "资料入库失败，请检查文件格式或后端配置。");
      setUploadMessage("");
    } finally {
      setUploading(false);
    }
  }

  async function handleRetryImages(document) {
    if (!selectedBase || retryingDocumentId) return;
    setRetryingDocumentId(document.id);
    setUploadError("");
    try {
      await retryKnowledgeDocumentImages(selectedBase.id, document.id);
      await onRefresh();
    } catch (error) {
      setUploadError(error.message || "图片语义解析重试失败");
    } finally {
      setRetryingDocumentId("");
    }
  }

  async function handleOpenImageEvidence(imageId) {
    try {
      await openKnowledgeImageEvidence(imageId);
    } catch (error) {
      setSearchError(error.message || "图片证据读取失败");
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
    const query = searchTerm.trim();
    if (!query) {
      setSearchResults([]);
      setSearchDiagnostics(null);
      setSelectedResultId("");
      setAppliedSearch(null);
      setSearchError("");
      return;
    }
    const filters = toSearchFilters(searchFilters);
    const searchSnapshot = { term: query, signature: createSearchSignature(query, filters) };
    setSearching(true);
    setSearchError("");
    try {
      const result = await searchKnowledgeBase({
        query,
        projectId: selectedBase?.scope === "global" ? projectId : selectedBase?.projectId || projectId,
        kbIds: selectedBase?.id ? [selectedBase.id] : [],
        includeGlobal: false,
        topK: 8,
        filters,
      });
      setSearchResults(result.items);
      setSearchDiagnostics(result.diagnostics);
      setSelectedResultId(result.items[0]?.id || "");
      setAppliedSearch(searchSnapshot);
    } catch (error) {
      setSearchError(error.message || "知识库检索失败");
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

        <section className="knowledge-workspace panel-section">
          <div className="panel-title align-top">
            <div>
              <h2>{selectedBase?.name || "未选择知识库"}</h2>
              <p>{selectedBase?.scope === "global" ? "全局资料会参与所有项目召回。" : "项目资料仅参与当前项目召回。"}</p>
            </div>
            <div className="knowledge-workspace-tabs" role="tablist" aria-label="知识库工作区">
              <button className={activeKnowledgeView === "documents" ? "active" : ""} type="button" role="tab" aria-selected={activeKnowledgeView === "documents"} onClick={() => setActiveKnowledgeView("documents")}>资料管理</button>
              <button className={activeKnowledgeView === "search" ? "active" : ""} type="button" role="tab" aria-selected={activeKnowledgeView === "search"} onClick={() => setActiveKnowledgeView("search")}>检索预览</button>
            </div>
          </div>
          {activeKnowledgeView === "documents" ? (
            <section className="knowledge-documents">
              <div className="knowledge-document-toolbar">
                <span>{selectedBase?.documentCount || 0} 份资料</span>
                {canEdit ? (
                  <>
                    <input
                      className="visually-hidden"
                      type="file"
                      accept=".pdf,.docx,.pptx,.xlsx,.txt"
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
                  <span>支持 PDF、DOCX、PPTX、XLSX、TXT；资料会经 MinerU 解析后进入当前知识库。</span>
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
                        <span>{formatDocumentStatus(document)}</span>
                        {document.error ? <em>{document.error}</em> : null}
                      </div>
                      {canEdit ? (
                        <div className="knowledge-document-actions">
                          {document.imageFailedCount > 0 && !document.processingStage ? (
                            <button className="icon-button quiet" onClick={() => handleRetryImages(document)} disabled={Boolean(retryingDocumentId)} aria-label={`重试${document.name}的图片解析`} title="重试失败图片">
                              {retryingDocumentId === document.id ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                            </button>
                          ) : null}
                          <button className="icon-button quiet" onClick={() => onDeleteDocument(selectedBase.id, document.id)} aria-label={`删除${document.name}`}>
                            <Trash2 size={16} />
                          </button>
                        </div>
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
          ) : (
            <KnowledgeSearchPreview
              selectedBase={selectedBase}
              searchTerm={searchTerm}
              appliedSearch={appliedSearch}
              searchFilters={searchFilters}
              searchResults={searchResults}
              searchDiagnostics={searchDiagnostics}
              searchError={searchError}
              searching={searching}
              searchDirty={searchDirty}
              selectedResult={selectedResult}
              onSearchTermChange={setSearchTerm}
              onSearchFiltersChange={setSearchFilters}
              onSearch={handleSearch}
              onSelectResult={setSelectedResultId}
              onOpenImageEvidence={handleOpenImageEvidence}
            />
          )}
        </section>
      </div>
    </section>
  );
}
function toSearchFilters(filters) {
  return {
    documentIds: filters.documentIds || [],
    pageFrom: filters.pageFrom === "" ? null : Number(filters.pageFrom),
    pageTo: filters.pageTo === "" ? null : Number(filters.pageTo),
    isTable: filters.isTable,
    hasStar: filters.hasStar ? true : null,
    blockTypes: filters.blockTypes || [],
  };
}

function createSearchSignature(query, filters) {
  return JSON.stringify({ query: String(query || "").trim(), filters });
}

function formatDocumentStatus(document) {
  const parts = [document.size || "--", `${document.chunkCount || 0} 片段`, document.processingStage || document.status];
  if (document.imageCount > 0) parts.push(`图片 ${document.imageCaptionCount || 0}/${document.imageCount}`);
  return parts.join(" · ");
}

export default KnowledgeBaseManagement;

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, Search, Table2, X } from "lucide-react";
import { searchKnowledgeTables } from "../../services/knowledgeBase.js";

function KnowledgeTablePicker({
  open,
  knowledgeBases = [],
  selectedProjectKnowledgeBaseIds = [],
  selectedGlobalKnowledgeBaseIds = [],
  onInsert,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [tables, setTables] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [insertStatus, setInsertStatus] = useState("");
  const selectedIds = useMemo(
    () => [...selectedProjectKnowledgeBaseIds, ...selectedGlobalKnowledgeBaseIds],
    [selectedGlobalKnowledgeBaseIds, selectedProjectKnowledgeBaseIds],
  );
  const documents = useMemo(() => groupTablesByDocument(tables), [tables]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || documents[0] || null;
  const documentTables = selectedDocument ? tables.filter((table) => table.documentId === selectedDocument.id) : [];
  const selectedTable = documentTables.find((table) => table.id === selectedTableId) || documentTables[0] || null;

  useEffect(() => {
    if (!open) return;
    loadTables("");
  }, [open, selectedIds.join("|")]);

  if (!open) return null;

  async function loadTables(keyword = query) {
    setStatus("loading");
    setError("");
    setInsertStatus("");
    try {
      const nextTables = await searchKnowledgeTables({
        query: keyword,
        kbIds: selectedProjectKnowledgeBaseIds,
        globalKbIds: selectedGlobalKnowledgeBaseIds,
      });
      setTables(nextTables);
      setSelectedDocumentId(nextTables[0]?.documentId || "");
      setSelectedTableId(nextTables[0]?.id || "");
      setStatus("ready");
    } catch (loadError) {
      setTables([]);
      setSelectedDocumentId("");
      setSelectedTableId("");
      setStatus("error");
      setError(loadError?.message || "知识库表格读取失败");
    }
  }

  async function insertSelectedTable() {
    if (!selectedTable) return;
    setInsertStatus("inserting");
    const result = await onInsert?.(selectedTable);
    if (result?.ok) {
      setInsertStatus("done");
      return;
    }
    setInsertStatus(result?.error || "表格插入失败，请确认左侧文档已加载并把光标放到插入位置。");
  }

  const selectedKnowledgeBaseNames = knowledgeBases
    .filter((base) => selectedIds.includes(base.id))
    .map((base) => base.name);

  return createPortal(
    <div className="knowledge-table-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="knowledge-table-modal" role="dialog" aria-modal="true" aria-label="插入知识库表格" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>插入资料表格</h2>
          <button className="icon-button quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="knowledge-table-toolbar">
          <label className="knowledge-table-search">
            <Search size={15} />
            <input
              value={query}
              placeholder="搜索表格标题、文档名或表格内容"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadTables();
              }}
            />
          </label>
          <button className="tool-button" type="button" onClick={() => loadTables()} disabled={status === "loading" || selectedIds.length === 0}>
            {status === "loading" ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            检索
          </button>
        </div>
        <div className="knowledge-table-scope">
          {selectedIds.length === 0 ? "请先在填充工作台选择项目库或全局库。" : `当前范围：${selectedKnowledgeBaseNames.join("、")}`}
        </div>
        <div className="knowledge-table-body">
          <aside className="knowledge-table-documents">
            {status === "loading" ? (
              <div className="knowledge-table-empty"><Loader2 size={16} className="spin" /> 正在读取原文表格</div>
            ) : error ? (
              <div className="knowledge-table-empty error">{error}</div>
            ) : documents.length === 0 ? (
              <div className="knowledge-table-empty">未找到含表格的 Word 文档</div>
            ) : documents.map((document) => (
              <button
                className={document.id === selectedDocument?.id ? "knowledge-table-document active" : "knowledge-table-document"}
                type="button"
                key={document.id}
                onClick={() => {
                  setSelectedDocumentId(document.id);
                  setSelectedTableId(document.firstTableId);
                  setInsertStatus("");
                }}
              >
                <FileText size={16} />
                <span>
                  <strong title={document.name}>{document.name}</strong>
                  <em>{document.knowledgeBaseName} · {document.tableCount} 个表格</em>
                </span>
              </button>
            ))}
          </aside>
          <aside className="knowledge-table-list">
            {selectedDocument ? documentTables.map((table) => (
              <button
                className={table.id === selectedTable?.id ? "knowledge-table-item active" : "knowledge-table-item"}
                type="button"
                key={table.id}
                onClick={() => {
                  setSelectedTableId(table.id);
                  setInsertStatus("");
                }}
              >
                <Table2 size={16} />
                <span>
                  <strong>{table.title || `表格 ${table.tableIndex}`}</strong>
                  <em>{table.rowCount}行{table.columnCount}列{table.page ? ` · 第${table.page}页` : ""}</em>
                </span>
              </button>
            )) : <div className="knowledge-table-empty">请选择 Word 文档</div>}
          </aside>
          <main className="knowledge-table-preview">
            {selectedTable ? (
              <>
                <div className="knowledge-table-preview-head">
                  <div>
                    <strong>{selectedTable.title || `表格 ${selectedTable.tableIndex}`}</strong>
                    <span><FileText size={14} /> {selectedTable.documentName}{selectedTable.page ? ` · 第${selectedTable.page}页` : ""}</span>
                  </div>
                  <button className="tool-button primary" type="button" onClick={insertSelectedTable} disabled={insertStatus === "inserting"}>
                    {insertStatus === "inserting" ? <Loader2 size={15} className="spin" /> : <Table2 size={15} />}
                    插入到光标
                  </button>
                </div>
                <div className="knowledge-table-preview-scroll">
                  <table>
                    <tbody>
                      {selectedTable.rows.map((row, rowIndex) => (
                        <tr key={`${selectedTable.id}-R${rowIndex}`}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${selectedTable.id}-R${rowIndex}-C${cellIndex}`} colSpan={cell.colSpan || 1}>
                              {cell.text || " "}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {insertStatus && insertStatus !== "inserting" ? (
                  <div className={insertStatus === "done" ? "knowledge-table-status done" : "knowledge-table-status error"}>
                    {insertStatus === "done" ? "已插入当前光标位置" : insertStatus}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="knowledge-table-empty">请选择左侧表格</div>
            )}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function groupTablesByDocument(tables) {
  const byDocument = new Map();
  tables.forEach((table) => {
    const id = table.documentId || table.fileName || table.documentName || "unknown";
    if (!byDocument.has(id)) {
      byDocument.set(id, {
        id,
        name: table.documentName || table.fileName || "未命名文档",
        fileName: table.fileName || "",
        knowledgeBaseName: table.knowledgeBaseName || "",
        tableCount: 0,
        firstTableId: table.id,
      });
    }
    const document = byDocument.get(id);
    document.tableCount += 1;
  });
  return [...byDocument.values()];
}

export default KnowledgeTablePicker;

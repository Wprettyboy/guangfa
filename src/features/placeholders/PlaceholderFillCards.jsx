import React, { useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2, Wand2 } from "lucide-react";
import StatusPill from "../../components/StatusPill.jsx";

function normalizeEvidenceText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getPlaceholderReason(card) {
  return normalizeEvidenceText(card.aiReason) || (card.status === "需补充资料" ? normalizeEvidenceText(card.evidence) : "");
}

function PlaceholderFillCards({
  cards,
  currentPage,
  generatingAll,
  onGenerate,
  onUpdateValue,
  onApplyValue,
  onJumpAnchor,
}) {
  const [collapsedCards, setCollapsedCards] = useState({});
  const [collapsedVariables, setCollapsedVariables] = useState({});

  function toggleCard(variableId) {
    setCollapsedCards((current) => ({
      ...current,
      [variableId]: !(current[variableId] ?? true),
    }));
  }

  function toggleVariable(variableId) {
    setCollapsedVariables((current) => ({
      ...current,
      [variableId]: !(current[variableId] ?? true),
    }));
  }

  if (cards.length === 0) {
    return (
      <section className="placeholder-fill-panel">
        <div className="empty-state compact">
          <Info size={17} />
          <span>当前模板暂无已插入的自动字段</span>
        </div>
      </section>
    );
  }

  return (
    <section className="placeholder-fill-panel">
      <div className="placeholder-fill-list">
        {cards.map((card) => {
          const cardExpanded = collapsedCards[card.id] === false;
          const expanded = collapsedVariables[card.id] === false;
          const listId = `placeholder-fill-anchor-list-${card.id}`;
          const isGenerating = card.status === "生成中";
          const canApply = Boolean(card.value.trim()) && !isGenerating && !generatingAll;
          return (
            <article className="placeholder-variable-card placeholder-fill-card" key={card.id}>
              <div className="placeholder-card-header">
                <div className="placeholder-card-title">
                  <strong title={card.name}>{card.name}</strong>
                  <button
                    className="placeholder-card-collapse-button"
                    type="button"
                    aria-expanded={cardExpanded}
                    onClick={() => toggleCard(card.id)}
                    title={cardExpanded ? "收起字段" : "展开字段"}
                  >
                    {cardExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                </div>
                <div className="placeholder-fill-actions">
                  <StatusPill status={card.status} />
                  <button
                    className="placeholder-insert-button"
                    type="button"
                    onClick={() => onGenerate?.(card.id)}
                    disabled={isGenerating || generatingAll}
                    title={`AI 填充 ${card.name}`}
                  >
                    {isGenerating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                    {isGenerating ? "填充中" : "AI填充"}
                  </button>
                </div>
              </div>
              {cardExpanded ? (
                <>
                  <div className="placeholder-fill-value">
                    <input
                      value={card.value}
                      placeholder="待一键填充"
                      onChange={(event) => onUpdateValue?.(card.id, event.target.value)}
                    />
                    <button className="text-button" type="button" onClick={() => onApplyValue?.(card.id)} disabled={!canApply}>
                      写入
                    </button>
                  </div>
                  {(card.aiReason || card.source || card.sourceSnippetText || card.evidence) && card.status !== "未填充" ? (
                    <div className="placeholder-fill-evidence">
                      <dl>
                        <div>
                          <dt>AI判断原因</dt>
                          <dd>{getPlaceholderReason(card) || "AI 未返回明确判断原因。"}</dd>
                        </div>
                        <div>
                          <dt>原文位置</dt>
                          <dd>{card.source || "未找到原文位置"}</dd>
                        </div>
                        <div>
                          <dt>相关原文</dt>
                          <dd>{card.sourceSnippetText || card.evidence || "暂无相关原文描述。"}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : null}
                  <button
                    className="placeholder-card-toggle"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() => toggleVariable(card.id)}
                  >
                    <span>已插入总数 {card.insertedCount}</span>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  {expanded ? (
                    <div className="placeholder-card-anchor-list" id={listId}>
                      <div className="placeholder-anchor-head">
                        <span>序号</span>
                        <span>页面</span>
                        <span>状态</span>
                      </div>
                      {card.anchors.map((anchor, index) => (
                        <div className="placeholder-anchor-row" key={anchor.bookmarkName || anchor.id}>
                          <span className="row-index">{index + 1}</span>
                          <button
                            className={Number(anchor.page) === Number(currentPage) ? "placeholder-page-link is-current" : "placeholder-page-link"}
                            type="button"
                            onClick={() => onJumpAnchor?.(anchor)}
                          >
                            {anchor.pageLabel}
                          </button>
                          <span className="placeholder-anchor-state">书签</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default PlaceholderFillCards;

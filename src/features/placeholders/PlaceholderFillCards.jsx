import React, { useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2, Wand2 } from "lucide-react";
import StatusPill from "../../components/StatusPill.jsx";

function PlaceholderFillCards({
  cards,
  currentPage,
  generatingAll,
  onGenerate,
  onUpdateValue,
  onApplyValue,
  onJumpAnchor,
}) {
  const [collapsedVariables, setCollapsedVariables] = useState({});

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
          const expanded = collapsedVariables[card.id] === false;
          const listId = `placeholder-fill-anchor-list-${card.id}`;
          const isGenerating = card.status === "生成中";
          const canApply = Boolean(card.value.trim()) && !isGenerating && !generatingAll;
          return (
            <article className="placeholder-variable-card placeholder-fill-card" key={card.id}>
              <div className="placeholder-card-header">
                <strong title={card.name}>{card.name}</strong>
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
              {card.evidence ? <p className="placeholder-fill-evidence" title={card.evidence}>{card.evidence}</p> : null}
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
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default PlaceholderFillCards;

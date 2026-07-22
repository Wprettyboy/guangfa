import React, { useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2, Wand2 } from "lucide-react";
import StatusPill from "../../components/StatusPill.jsx";
import { useFillWorkspaceActions, useFillWorkspaceState } from "../fill/FillWorkspaceContext.jsx";

function ComplexFillCards() {
  const { complexFillCards: cards, currentPage, generatingAll } = useFillWorkspaceState();
  const {
    onGenerateComplexFill: onGenerate,
    onUpdateComplexFillValue: onUpdateValue,
    onApplyComplexFillValue: onApplyValue,
    onJumpComplexFillAnchor: onJumpAnchor,
  } = useFillWorkspaceActions();
  const [collapsedCards, setCollapsedCards] = useState({});
  const [collapsedFields, setCollapsedFields] = useState({});

  function toggleCard(fieldId) {
    setCollapsedCards((current) => ({
      ...current,
      [fieldId]: !(current[fieldId] ?? false),
    }));
  }

  function toggleField(fieldId) {
    setCollapsedFields((current) => ({
      ...current,
      [fieldId]: !(current[fieldId] ?? false),
    }));
  }

  if (cards.length === 0) {
    return (
      <section className="placeholder-fill-panel">
        <div className="empty-state compact">
          <Info size={17} />
          <span>当前模板暂无已选区的复杂类填充字段</span>
        </div>
      </section>
    );
  }

  return (
    <section className="placeholder-fill-panel">
      <div className="placeholder-fill-list">
        {cards.map((card) => {
          const cardExpanded = collapsedCards[card.id] !== true;
          const listExpanded = collapsedFields[card.id] !== true;
          const listId = `complex-fill-card-anchor-list-${card.id}`;
          const isGenerating = card.status === "生成中";
          const canApply = Boolean(card.value.trim()) && !isGenerating && !generatingAll;
          return (
            <article className="placeholder-variable-card placeholder-fill-card complex-fill-work-card" key={card.id}>
              <div className="placeholder-card-header">
                <div className="placeholder-card-title">
                  <strong title={card.fieldSummary}>{card.fieldSummary}</strong>
                  <button
                    className="placeholder-card-collapse-button"
                    type="button"
                    aria-expanded={cardExpanded}
                    onClick={() => toggleCard(card.id)}
                    title={cardExpanded ? "收起卡片" : "展开卡片"}
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
                    title={`AI 填充 ${card.fieldSummary}`}
                  >
                    {isGenerating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                    {isGenerating ? "填充中" : "AI填充"}
                  </button>
                </div>
              </div>
              {cardExpanded ? (
                <>
                  <div className="placeholder-fill-value complex-fill-value">
                    <textarea
                      value={card.value}
                      placeholder="待一键填充"
                      rows={3}
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
                    aria-expanded={listExpanded}
                    aria-controls={listId}
                    onClick={() => toggleField(card.id)}
                  >
                    <span>已选区总数 {card.selectedCount}</span>
                    {listExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  {listExpanded ? (
                    <div className="placeholder-card-anchor-list" id={listId}>
                      <div className="placeholder-anchor-head complex-fill-work-anchor-head">
                        <span>序号</span>
                        <span>页面</span>
                        <span>状态</span>
                      </div>
                      {card.anchors.map((anchor, index) => (
                        <div className="placeholder-anchor-row complex-fill-work-anchor-row" key={anchor.bookmarkName || anchor.id}>
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

export default ComplexFillCards;

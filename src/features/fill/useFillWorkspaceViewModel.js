import { useEffect, useMemo, useState } from "react";
import { getFillFieldDisplayPage } from "../docx/runtime.jsx";

function useFillWorkspaceViewModel({ fields, placeholderCards, complexFillCards, currentPage, fieldPageMap, generatingAll, editorReady }) {
  const [activeFillType, setActiveFillType] = useState("auto");
  const hasDynamicFieldPages = Object.keys(fieldPageMap || {}).length > 0;
  const pageFields = useMemo(
    () => fields.filter((field) => getFillFieldDisplayPage(field, fieldPageMap, hasDynamicFieldPages) === currentPage),
    [currentPage, fieldPageMap, fields, hasDynamicFieldPages],
  );
  const currentPagePlaceholderCount = useMemo(
    () => placeholderCards.reduce((count, card) => count + card.anchors.filter((anchor) => Number(anchor.page) === Number(currentPage)).length, 0),
    [currentPage, placeholderCards],
  );
  const currentPageComplexFillCount = useMemo(
    () => complexFillCards.reduce((count, card) => count + card.anchors.filter((anchor) => Number(anchor.page) === Number(currentPage)).length, 0),
    [complexFillCards, currentPage],
  );
  const fillableCount = fields.filter((field) => field.status !== "已确认" && field.status !== "生成中").length;
  const placeholderFillableCount = placeholderCards.filter((card) => card.status !== "已确认" && card.status !== "生成中").length;
  const complexFillableCount = complexFillCards.filter((card) => card.status !== "已确认" && card.status !== "生成中").length;
  const activeFillableCount = activeFillType === "auto" ? placeholderFillableCount : activeFillType === "complex" ? complexFillableCount : fillableCount;

  useEffect(() => {
    const counts = { auto: placeholderCards.length, complex: complexFillCards.length, other: fields.length };
    if (counts[activeFillType] > 0) return;
    const nextType = ["auto", "complex", "other"].find((type) => counts[type] > 0);
    if (nextType) setActiveFillType(nextType);
  }, [activeFillType, complexFillCards.length, fields.length, placeholderCards.length]);

  return {
    activeFillType,
    setActiveFillType,
    hasDynamicFieldPages,
    pageFields,
    currentPagePlaceholderCount,
    currentPageComplexFillCount,
    activeFillableCount,
    generateAllLabel: `一键填充${activeFillableCount > 0 ? ` ${activeFillableCount}` : ""}`,
    currentPageCount: activeFillType === "auto" ? currentPagePlaceholderCount : activeFillType === "complex" ? currentPageComplexFillCount : pageFields.length,
    bulkDisabled: !editorReady || generatingAll || activeFillableCount === 0,
    tabItems: [
      { id: "auto", label: "自动字段填充", count: placeholderCards.length },
      { id: "complex", label: "复杂类填充", count: complexFillCards.length },
      { id: "other", label: "其他类型填充", count: fields.length },
    ],
  };
}

export { useFillWorkspaceViewModel };

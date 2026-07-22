import { getFieldSetupIssue, sortFieldsByDocumentOrder } from "../../utils/fields.js";

function useFillWorkflow({
  generatingAll,
  runFillTask,
  captureFillDocumentIdentity,
  isCurrentFillDocumentIdentity,
  placeholderFillCardsRef,
  complexFillCardsRef,
  enrichedFillFields,
  enrichedFillFieldsRef,
  templateFields,
  fillPreviewPage,
  fillPreviewPageLockRef,
  setFillPreviewPage,
  setShowCitations,
  setFillFields,
  fillFields,
  fillPlaceholderWithAI,
  fillComplexFillWithAI,
  fillFieldWithAI,
  queueFilledOfficeDocumentSync,
  clearFillSync,
}) {
  async function generateAllPlaceholderFills() {
    const fillIdentity = captureFillDocumentIdentity();
    if (!isCurrentFillDocumentIdentity(fillIdentity)) return;
    const pendingCards = placeholderFillCardsRef.current.filter((card) => card.status !== "已确认" && card.status !== "生成中");
    if (pendingCards.length === 0 || generatingAll) return;
    await runFillTask(pendingCards.length, async ({ signal, isCurrent, setProgress }) => {
      for (let index = 0; index < pendingCards.length; index += 1) {
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
        setProgress(index + 1);
        await fillPlaceholderWithAI(pendingCards[index].id, { fillIdentity, syncDocument: false, signal });
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
      }
      if (isCurrent() && isCurrentFillDocumentIdentity(fillIdentity)) {
        queueFilledOfficeDocumentSync(enrichedFillFieldsRef.current, fillIdentity);
      }
    });
  }

  async function generateAllComplexFills() {
    const fillIdentity = captureFillDocumentIdentity();
    if (!isCurrentFillDocumentIdentity(fillIdentity)) return;
    const pendingCards = complexFillCardsRef.current.filter((card) => card.status !== "已确认" && card.status !== "生成中");
    if (pendingCards.length === 0 || generatingAll) return;
    await runFillTask(pendingCards.length, async ({ signal, isCurrent, setProgress }) => {
      for (let index = 0; index < pendingCards.length; index += 1) {
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
        setProgress(index + 1);
        await fillComplexFillWithAI(pendingCards[index].id, { fillIdentity, syncDocument: false, signal });
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
      }
      if (isCurrent() && isCurrentFillDocumentIdentity(fillIdentity)) {
        queueFilledOfficeDocumentSync(enrichedFillFieldsRef.current, fillIdentity);
      }
    });
  }

  async function generateAllFields() {
    const fillIdentity = captureFillDocumentIdentity();
    if (!isCurrentFillDocumentIdentity(fillIdentity)) return;
    const pendingFields = sortFieldsByDocumentOrder(enrichedFillFields.filter((field) => field.status !== "已确认" && field.status !== "生成中"));
    if (pendingFields.length === 0 || generatingAll) return;
    const preservedFillPreviewPage = fillPreviewPage;
    const blockedFields = pendingFields
      .map((field) => {
        const templateField = templateFields.find((item) => item.id === field.id);
        return { field, issue: getFieldSetupIssue({ ...field, ...templateField }) };
      })
      .filter((item) => item.issue);
    const runnableFields = pendingFields.filter((field) => !blockedFields.some((item) => item.field.id === field.id));

    fillPreviewPageLockRef.current = preservedFillPreviewPage;
    setShowCitations(false);
    clearFillSync();
    let fieldsSnapshot = blockedFields.length
      ? fillFields.map((field) => {
          const blocked = blockedFields.find((item) => item.field.id === field.id);
          return blocked
            ? { ...field, status: "需补充资料", confidence: 0, source: "字段定位校验", evidence: blocked.issue, sourceSnippetText: "" }
            : field;
        })
      : fillFields;
    if (blockedFields.length > 0) {
      enrichedFillFieldsRef.current = fieldsSnapshot;
      setFillFields((fields) => fields.map((field) => {
        const blocked = blockedFields.find((item) => item.field.id === field.id);
        return blocked
          ? { ...field, status: "需补充资料", confidence: 0, source: "字段定位校验", evidence: blocked.issue, sourceSnippetText: "" }
          : field;
      }));
      window.alert(`有 ${blockedFields.length} 个字段缺少输入点或标注范围不完整，已跳过 AI 填充。`);
    }

    await runFillTask(runnableFields.length, async ({ signal, isCurrent, setProgress }) => {
      for (let index = 0; index < runnableFields.length; index += 1) {
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
        const field = runnableFields[index];
        setProgress(index + 1);
        fieldsSnapshot = await fillFieldWithAI(field.id, fieldsSnapshot, {
          fillIdentity,
          syncDocument: false,
          suppressPageSync: true,
          signal,
        }) || fieldsSnapshot;
        if (!isCurrent() || !isCurrentFillDocumentIdentity(fillIdentity)) break;
      }
      if (isCurrent() && isCurrentFillDocumentIdentity(fillIdentity)) {
        queueFilledOfficeDocumentSync(fieldsSnapshot, fillIdentity);
      }
    });
    if (isCurrentFillDocumentIdentity(fillIdentity)) {
      setFillPreviewPage(preservedFillPreviewPage);
      window.setTimeout(() => {
        if (isCurrentFillDocumentIdentity(fillIdentity) && fillPreviewPageLockRef.current === preservedFillPreviewPage) {
          fillPreviewPageLockRef.current = null;
        }
      }, 2200);
    } else if (fillPreviewPageLockRef.current === preservedFillPreviewPage) {
      fillPreviewPageLockRef.current = null;
    }
  }

  return { generateAllPlaceholderFills, generateAllComplexFills, generateAllFields };
}

export { useFillWorkflow };

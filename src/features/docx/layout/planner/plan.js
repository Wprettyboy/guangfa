function getDefaultSelectedFindingIds(report) {
  return (report?.findings || [])
    .filter((finding) => finding.fixable && finding.status !== "blocked")
    .map((finding) => finding.id);
}

function buildLayoutRepairPlan(standard, report, selectedFindingIds) {
  const selected = new Set(selectedFindingIds);
  const ruleById = new Map(standard.rules.map((rule) => [rule.id, rule]));
  const selectedFindings = (report?.findings || []).filter((finding) => selected.has(finding.id));
  const actionsById = new Map();
  const manualItems = [];

  selectedFindings.forEach((finding) => {
    const rule = ruleById.get(finding.ruleId);
    if (!rule?.fixAction || !finding.fixable) {
      manualItems.push(finding);
      return;
    }
    const existing = actionsById.get(rule.fixAction);
    actionsById.set(rule.fixAction, {
      id: rule.fixAction,
      title: existing?.title || actionTitle(rule.fixAction),
      summary: existing?.summary || actionSummary(rule.fixAction),
      payload: { ...(existing?.payload || {}), ...(rule.payload || {}) },
      ruleIds: [...new Set([...(existing?.ruleIds || []), rule.id])],
    });
  });

  return {
    standardId: standard.id,
    standardName: standard.name,
    documentType: report?.documentType || "unknown",
    selectedFindingIds: [...selected],
    actions: [...actionsById.values()],
    manualItems,
    summary: `已生成 ${actionsById.size} 个 OnlyOffice 自动修复动作，${manualItems.length} 项需人工确认。`,
  };
}

function actionTitle(actionId) {
  if (actionId === "page") return "基础版面修复";
  if (actionId === "body") return "正文格式修复";
  if (actionId === "headings") return "标题层级修复";
  if (actionId === "signature") return "落款日期候选修复";
  return "格式修复";
}

function actionSummary(actionId) {
  if (actionId === "page") return "设置 A4、页边距和版心相关尺寸。";
  if (actionId === "body") return "设置正文仿宋三号、首行缩进和行距。";
  if (actionId === "headings") return "设置标题和结构层级字体。";
  if (actionId === "signature") return "对疑似落款和成文日期段落进行右对齐。";
  return "执行 OnlyOffice 格式调整。";
}

export { buildLayoutRepairPlan, getDefaultSelectedFindingIds };

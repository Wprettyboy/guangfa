function buildPendingLayoutReport(standard) {
  const findings = standard.rules.map((rule) => ({
    id: rule.id,
    ruleId: rule.id,
    domainId: rule.domainId,
    clause: rule.clause,
    title: rule.title,
    standard: rule.standard,
    severity: rule.severity,
    fixMode: rule.fixMode,
    fixable: rule.fixMode === "auto",
    status: rule.fixMode === "auto" ? "needs-scan" : "needs-confirmation",
    finding: rule.fixMode === "auto" ? "等待 OnlyOffice 读取文档后检测。" : "该规则需要识别文档语义或人工确认后处理。",
    evidence: "",
  }));
  return normalizeLayoutReport({ ok: true, documentType: "unknown", findings }, standard);
}

function normalizeLayoutReport(rawReport, standard) {
  const ruleById = new Map(standard.rules.map((rule) => [rule.id, rule]));
  const findingsByRuleId = new Map();
  (rawReport?.findings || []).forEach((item) => {
    const rule = ruleById.get(item.ruleId || item.id);
    if (!rule) return;
    findingsByRuleId.set(rule.id, normalizeFinding(item, rule));
  });

  standard.rules.forEach((rule) => {
    if (findingsByRuleId.has(rule.id)) return;
    findingsByRuleId.set(rule.id, normalizeFinding({}, rule));
  });

  const findings = [...findingsByRuleId.values()];
  return {
    ok: rawReport?.ok !== false,
    standardId: standard.id,
    standardName: standard.name,
    documentType: rawReport?.documentType || "unknown",
    summary: rawReport?.summary || summarizeFindings(findings),
    findings,
  };
}

function normalizeFinding(item, rule) {
  return {
    id: item.id || rule.id,
    ruleId: rule.id,
    domainId: rule.domainId,
    clause: rule.clause,
    title: rule.title,
    standard: rule.standard,
    severity: rule.severity,
    fixMode: rule.fixMode,
    fixable: item.fixable ?? rule.fixMode === "auto",
    status: item.status || (rule.fixMode === "auto" ? "needs-fix" : "needs-confirmation"),
    finding: item.finding || item.message || (rule.fixMode === "auto" ? "可由 OnlyOffice 自动检查和修复。" : "需要人工确认后处理。"),
    evidence: item.evidence || "",
    page: item.page || 0,
    currentValue: item.currentValue || "",
  };
}

function summarizeFindings(findings) {
  const fixable = findings.filter((item) => item.fixable).length;
  const confirmation = findings.filter((item) => item.status === "needs-confirmation").length;
  const blocked = findings.filter((item) => item.status === "blocked").length;
  return `共 ${findings.length} 项标准规则，${fixable} 项可生成自动修复计划，${confirmation} 项需人工确认，${blocked} 项暂不可自动处理。`;
}

function groupFindingsByDomain(findings, domains) {
  return domains.map((domain) => ({
    ...domain,
    findings: findings.filter((item) => item.domainId === domain.id),
  }));
}

export { buildPendingLayoutReport, groupFindingsByDomain, normalizeLayoutReport };

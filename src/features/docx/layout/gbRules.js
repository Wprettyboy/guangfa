import { gbt9704Standard } from "./standards/gbt9704-2012.js";
import { buildLayoutRepairPlan } from "./planner/plan.js";

const gbOfficialDocumentRule = {
  id: gbt9704Standard.id,
  name: gbt9704Standard.name,
  actions: gbt9704Standard.rules,
};

function buildGbLayoutPlan(actionIds = gbt9704Standard.rules.map((rule) => rule.id)) {
  const findings = gbt9704Standard.rules
    .filter((rule) => actionIds.includes(rule.id))
    .map((rule) => ({ id: rule.id, ruleId: rule.id, fixable: rule.fixMode === "auto" }));
  return buildLayoutRepairPlan(gbt9704Standard, { findings }, actionIds);
}

export { buildGbLayoutPlan, gbOfficialDocumentRule };

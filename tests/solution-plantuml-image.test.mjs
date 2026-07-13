import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlantumlUserPrompt,
  normalizePlantumlSource,
  resolveDiagramPolicy,
  validatePlantumlPolicy,
} from "../server/solution-writing/plantuml-image.js";

const activitySource = `@startuml
skinparam defaultFontName SimHei
skinparam defaultFontSize 20
start
:提交申请;
if (审核通过?) then (是)
  :进入办理;
else (否)
  :退回修改;
endif
stop
@enduml`;

const wbsSource = `@startwbs
skinparam defaultFontName SimHei
skinparam defaultFontSize 20
* 业务系统
** 业务管理
*** 申请受理
*** 审核办理
** 统计分析
@endwbs`;

test("AI image policy maps flows to activity and function composition to WBS", () => {
  assert.equal(resolveDiagramPolicy({ prompt: "生成业务流程图", selectedTitle: "业务说明" }).type, "activity");
  assert.equal(resolveDiagramPolicy({ prompt: "生成功能组成图", selectedTitle: "业务流程" }).type, "wbs");
  assert.equal(resolveDiagramPolicy({ prompt: "生成总体架构图", selectedTitle: "业务流程" }).type, "single");
  assert.equal(resolveDiagramPolicy({ prompt: "生成本节配图", selectedTitle: "功能结构图" }).type, "wbs");
  assert.equal(resolveDiagramPolicy({ prompt: "生成总体架构图，展示功能组成和业务流程", selectedTitle: "功能结构图" }).type, "single");
  assert.equal(resolveDiagramPolicy({ prompt: "生成业务流程图，不要组合展示" }).allowCombined, false);
});

test("flow prompt requires one activity diagram and rejects the former component composition", () => {
  const policy = resolveDiagramPolicy({ prompt: "生成相关业务流程图" });
  const prompt = buildPlantumlUserPrompt({
    prompt: "生成相关业务流程图",
    selectedTitle: "业务流程",
    selectedBodyText: "申请、审核、办理、反馈。",
    outlineText: "业务流程",
    errors: [],
    diagramPolicy: policy,
  });
  assert.match(prompt, /流程图强制使用 PlantUML 活动图/);
  assert.match(prompt, /不得用 component、rectangle、node、package/);
  assert.doesNotMatch(prompt, /优先使用 component/);
  assert.deepEqual(validatePlantumlPolicy(activitySource, policy), { ok: true });

  const formerBadSource = `@startuml
skinparam defaultFontName SimHei
skinparam defaultFontSize 20
package "业务流程闭环" {
  component "值班排班流程"
  rectangle "工单流转流程"
}
@enduml`;
  assert.match(validatePlantumlPolicy(formerBadSource, policy).error, /活动图语法|不得混入/);
});

test("function composition prompt and normalization use a valid WBS envelope", () => {
  const policy = resolveDiagramPolicy({ prompt: "请生成功能组成图" });
  const prompt = buildPlantumlUserPrompt({
    prompt: "请生成功能组成图",
    selectedTitle: "功能组成",
    selectedBodyText: "业务系统包含业务管理和统计分析。",
    outlineText: "功能组成",
    errors: [],
    diagramPolicy: policy,
  });
  assert.match(prompt, /@startwbs/);
  assert.match(prompt, /Business Process Modelling WBS/);

  const normalized = normalizePlantumlSource(`@startwbs
skinparam defaultFontName Arial
skinparam defaultFontSize 10
* 业务系统
** 业务管理
@endwbs`, policy);
  assert.match(normalized, /^@startwbs/m);
  assert.match(normalized, /skinparam defaultFontName SimHei/);
  assert.match(normalized, /skinparam defaultFontSize 20/);
  assert.doesNotMatch(normalized, /@startuml/);
  assert.deepEqual(validatePlantumlPolicy(normalized, policy), { ok: true });
  assert.match(validatePlantumlPolicy(activitySource, policy).error, /@startwbs.*@endwbs/);
});

test("general diagrams keep a neutral UML example", () => {
  const policy = resolveDiagramPolicy({ prompt: "生成总体架构图，展示功能组成和业务流程" });
  const prompt = buildPlantumlUserPrompt({
    prompt: "生成总体架构图，展示功能组成和业务流程",
    selectedTitle: "总体架构",
    selectedBodyText: "业务层、能力层和数据层。",
    outlineText: "总体架构",
    errors: [],
    diagramPolicy: policy,
  });
  assert.equal(policy.type, "single");
  assert.match(prompt, /@startuml\\n\.\.\.\\n@enduml/);
  assert.doesNotMatch(prompt, /:处理动作;/);
});

test("diagram policy rejects multiple blocks, external includes and invalid WBS levels", () => {
  const activityPolicy = resolveDiagramPolicy({ prompt: "生成流程图" });
  assert.match(validatePlantumlPolicy(`${activitySource}\nnewpage\n${activitySource}`, activityPolicy).error, /只能包含一个完整图/);
  assert.match(validatePlantumlPolicy(activitySource.replace("\nstart\n", "\n!includeurl https://example.com/theme.puml\nstart\n"), activityPolicy).error, /include\/import/);

  const wbsPolicy = resolveDiagramPolicy({ prompt: "生成WBS功能组成图" });
  assert.deepEqual(validatePlantumlPolicy(wbsSource, wbsPolicy), { ok: true });
  assert.match(validatePlantumlPolicy(wbsSource.replace("** 业务管理", "*** 业务管理"), wbsPolicy).error, /不能跳过中间层级/);
  assert.match(validatePlantumlPolicy(wbsSource.replace("** 业务管理", "component 业务管理"), wbsPolicy).error, /不得混入其他图型/);
});

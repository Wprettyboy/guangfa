async function identifySolutionModules(payload) {
  return postSolutionWriting("/api/ai/solution-identify-modules", payload, "功能模块识别失败");
}

async function generateSolutionModuleSections(payload) {
  return postSolutionWriting("/api/ai/solution-generate-sections", payload, "方案章节生成失败");
}

async function postSolutionWriting(url, payload, fallbackMessage) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}

export {
  generateSolutionModuleSections,
  identifySolutionModules,
};

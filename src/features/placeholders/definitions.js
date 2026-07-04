const placeholderDefinitions = [
  { key: "projectName", label: "项目名称", token: "{{项目名称}}" },
  { key: "purchaser", label: "采购人", token: "{{采购人}}" },
  { key: "agency", label: "采购代理机构", token: "{{采购代理机构}}" },
  { key: "projectCode", label: "项目编号", token: "{{项目编号}}" },
  { key: "date", label: "日期", token: "{{日期}}" },
  { key: "supplier", label: "供应商", token: "{{供应商}}" },
];

function getPlaceholderDefinition(keyOrToken) {
  const value = String(keyOrToken || "");
  return placeholderDefinitions.find((item) => item.key === value || item.token === value) || null;
}

export {
  getPlaceholderDefinition,
  placeholderDefinitions,
};

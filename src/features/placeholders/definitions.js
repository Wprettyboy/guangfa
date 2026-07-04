const placeholderDefinitions = [
  { key: "projectName", label: "项目名称", token: "{{项目名称}}" },
];

function getPlaceholderDefinition(keyOrToken) {
  const value = String(keyOrToken || "");
  return placeholderDefinitions.find((item) => item.key === value || item.token === value) || null;
}

export {
  getPlaceholderDefinition,
  placeholderDefinitions,
};

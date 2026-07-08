import { normalizeFieldCategory } from "./fields.js";



function summarizeFieldTypes(fields = []) {
  const counts = fields.reduce((acc, field) => {
    const type = normalizeFieldCategory(field.type || field.category || "未分类");
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

function inferTemplateCategory(value = "") {
  const text = String(value || "");
  if (/合同|协议|采购合同|施工合同|服务合同/.test(text)) return "合同类";
  if (/方案|技术方案|响应文件|施工组织|实施方案/.test(text)) return "方案类";
  return "招标类";
}

function normalizeTemplateCategory(category) {
  const value = String(category || "").trim();
  if (!value || value === "全部") return "招标类";
  return value;
}

function getContractFolder(template = {}) {
  if (template.level1 && template.level2) return `${template.level1}/${template.level2}`;
  if (template.folder) return template.folder;
  if (template.subCategory) return `未分组/${template.subCategory}`;
  return "未分组/未分组";
}

function buildContractFolders(templates) {
  const folders = new Map();
  templates
    .filter((template) => template.category === "合同类")
    .forEach((template) => {
      const key = template.contractFolder || getContractFolder(template);
      const [level1 = "未分组", level2 = "未分组"] = key.split("/");
      const current = folders.get(key) || { key, level1, level2, count: 0 };
      current.count += 1;
      folders.set(key, current);
    });
  return [...folders.values()].sort((a, b) => a.level1.localeCompare(b.level1, "zh-CN") || a.level2.localeCompare(b.level2, "zh-CN"));
}

function groupContractFolders(folders) {
  const groups = new Map();
  folders.forEach((folder) => {
    const group = groups.get(folder.level1) || { level1: folder.level1, folders: [], count: 0 };
    group.folders.push(folder);
    group.count += folder.count;
    groups.set(folder.level1, group);
  });
  return [...groups.values()];
}

function getTemplateCategoryTone(category) {
  if (category === "合同类") return "green";
  if (category === "方案类") return "amber";
  return "blue";
}



export {
  summarizeFieldTypes,
  inferTemplateCategory,
  normalizeTemplateCategory,
  getContractFolder,
  buildContractFolders,
  groupContractFolders,
  getTemplateCategoryTone,
};


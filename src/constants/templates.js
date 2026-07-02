const documentSlots = [
  {
    id: "slot-project-code",
    label: "项目编号：",
    suggestedName: "项目编号",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目编号",
    answerFormat: "保留招标文件原始编号格式",
    aiInstruction: "从招标文件封面、项目基础信息或招标公告中提取项目编号，不要改写编号中的字母、短横线和年份。",
  },
  {
    id: "slot-project-name",
    label: "项目名称：",
    suggestedName: "项目名称",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目名称",
    answerFormat: "使用完整项目名称",
    aiInstruction: "从招标公告、技术方案封面或项目概况中提取完整项目名称，避免使用简称。",
  },
  {
    id: "slot-tenderer",
    label: "招 标 人：",
    suggestedName: "招标人",
    defaultType: "填空",
    required: true,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写本项目招标人",
    answerFormat: "单位全称",
    aiInstruction: "优先使用招标公告中的招标人单位全称，不要补充联系人、地址等无关信息。",
  },
  {
    id: "slot-agency",
    label: "招标代理机构：",
    suggestedName: "招标代理机构",
    defaultType: "填空",
    required: false,
    page: 1,
    path: "封面 / 项目基本信息",
    suggestedQuestion: "请填写招标代理机构",
    answerFormat: "单位全称；没有则留空",
    aiInstruction: "从招标公告或投标人须知中提取招标代理机构名称，若资料没有明确写出则返回需补充资料。",
  },
  {
    id: "slot-date",
    label: "日　　期：",
    suggestedName: "日期",
    defaultType: "日期",
    required: true,
    page: 1,
    path: "封面 / 日期",
    suggestedQuestion: "请填写文件编制日期",
    answerFormat: "YYYY年MM月DD日",
    aiInstruction: "根据投标文件编制日期或用户指定日期填写，必须使用中文年月日格式。",
  },
  {
    id: "slot-bond",
    label: "投标保证金：",
    suggestedName: "投标保证金金额",
    defaultType: "金额",
    required: false,
    page: 5,
    path: "第二章 / 投标人须知前附表",
    suggestedQuestion: "请填写投标保证金金额",
    answerFormat: "人民币金额，保留单位",
    aiInstruction: "从投标人须知前附表中提取投标保证金金额；如果资料缺失或金额不唯一，标记为需补充资料。",
  },
];

const initialTemplateFile = null;

const initialTemplateFields = [];

const currentProjectId = "default-project";

const templateCategories = ["全部", "招标类", "合同类", "方案类"];

const initialFillFields = [
  {
    id: "F-001",
    slotId: "slot-project-code",
    name: "项目编号",
    value: "",
    status: "未填充",
    confidence: 0,
    source: "招标文件首页.docx 第 1 页",
    evidence: "项目编号：GF-SZDL-2026-042。该编号位于招标文件首页基本信息区。",
  },
  {
    id: "F-002",
    slotId: "slot-project-name",
    name: "项目名称",
    value: "XX市政道路改造工程项目",
    status: "待确认",
    confidence: 92,
    source: "技术方案.docx 第 12 页",
    evidence: "本项目名称为 XX市政道路改造工程项目，位于XX市XX区，项目建设内容包含道路、雨污水管网及照明改造。",
  },
  {
    id: "F-003",
    slotId: "slot-tenderer",
    name: "招标人",
    value: "XX市住房和城乡建设局",
    status: "已确认",
    confidence: 96,
    source: "招标公告.pdf 第 2 页",
    evidence: "招标人为 XX市住房和城乡建设局，联系人及地址详见招标公告第二页。",
  },
  {
    id: "F-004",
    slotId: "slot-agency",
    name: "招标代理机构",
    value: "XX工程咨询有限公司",
    status: "待确认",
    confidence: 88,
    source: "招标公告.pdf 第 2 页",
    evidence: "招标代理机构：XX工程咨询有限公司，负责本项目招标代理工作。",
  },
  {
    id: "F-005",
    slotId: "slot-date",
    name: "日期",
    value: "2026年06月26日",
    status: "已确认",
    confidence: 94,
    source: "投标文件编制说明.docx 第 4 页",
    evidence: "文件编制日期为 2026年06月26日。",
  },
  {
    id: "F-006",
    slotId: "slot-bond",
    name: "投标保证金金额",
    value: "",
    status: "需补充资料",
    confidence: 38,
    source: "未找到可靠来源",
    evidence: "现有资料中未检索到投标保证金金额的明确描述，需要补充商务文件或招标须知原件。",
  },
];



export {
  documentSlots,
  initialTemplateFile,
  initialTemplateFields,
  currentProjectId,
  templateCategories,
  initialFillFields,
};


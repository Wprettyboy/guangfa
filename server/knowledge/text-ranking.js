function rankKeywordChunks(chunks, query) {
  const exactTokens = createExactSearchTokens(query);
  const tokens = createSearchTokens(query);
  return chunks
    .map((chunk) => {
      const normalizedText = normalizeForSearch(chunk.text);
      const exactScore = exactTokens.reduce((sum, token) => sum + (normalizedText.includes(token) ? Math.max(20, token.length * 4) : 0), 0);
      const keywordScore = tokens.reduce((sum, token) => sum + (normalizedText.includes(token) ? Math.max(1, token.length) : 0), 0);
      return { ...chunk, exactScore, keywordScore, score: (exactScore + keywordScore) / 100, mode: exactScore > 0 ? "exact" : "keyword" };
    })
    .filter((chunk) => chunk.exactScore > 0 || chunk.keywordScore >= 4)
    .sort((a, b) => b.exactScore - a.exactScore || b.score - a.score || a.text.length - b.text.length);
}

function createSearchTokens(query) {
  const raw = String(query || "");
  const normalized = normalizeForSearch(raw);
  const stripped = stripQueryNoise(normalized);
  const parts = raw
    .split(/[\s,，。；;、:：()（）]+/)
    .map(normalizeForSearch)
    .map(stripQueryNoise)
    .filter((item) => item.length >= 2);
  return [...new Set([normalized, stripped, ...parts, ...expandDomainSearchTokens(stripped)].filter((item) => item.length >= 2))];
}

function createExactSearchTokens(query) {
  const raw = String(query || "");
  const normalized = stripQueryNoise(normalizeForSearch(raw));
  const parts = raw
    .split(/[\s,，。；;、:：()（）]+/)
    .map(normalizeForSearch)
    .map(stripQueryNoise)
    .filter((item) => item.length >= 2);
  return [...new Set([normalized, ...parts].filter((item) => item.length >= 2))];
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function stripQueryNoise(value) {
  return String(value || "")
    .replace(/^(请|帮我|根据|自动|获取|提取|生成|填写|填充|查询|搜索|查找)+/g, "")
    .replace(/(是什么|是啥|怎么写|如何写|怎么填|如何填|填写什么|填什么|多少天|多少|有哪些|是什么内容|的内容|内容|要求)$/g, "")
    .replace(/[?？。.!！]+$/g, "");
}

function expandDomainSearchTokens(value) {
  const tokens = [];
  const add = (...items) => tokens.push(...items.map(normalizeForSearch));

  if (/项目名称|工程名称|项目名|工程名|采购项目/.test(value)) {
    add("项目名称", "工程名称", "名称统一使用", "项目位于");
  }
  if (/项目概况|工程概况|建设规模|工程建设规模|建筑面积|建设内容/.test(value)) {
    add("项目概况", "工程概况", "工程建设规模", "总建筑面积", "新增规划床位", "建设内容", "服务内容", "技术要求", "商务要求");
  }
  if (/采购范围|实施范围|服务范围|主要施工内容|工作内容|包括但不限于/.test(value)) {
    add("采购范围", "实施范围", "服务范围", "主要施工内容", "施工图范围内", "工作内容", "包括但不限于", "分项内容");
  }
  if (/采购控制价|控制价|最高限价|预算金额|采购金额/.test(value)) {
    add("采购控制价", "控制价", "最高限价");
  }
  if (/招采方式|采购方式|招标方式|评审办法|评标办法|综合评分|综合评估|最低投标价/.test(value)) {
    add("招采方式", "采购方式", "综合评估法", "询比采购", "评审条件");
  }
  if (/业绩|类似项目|合同金额|发票/.test(value)) {
    add("业绩要求", "类似项目业绩", "合同金额", "合同发票");
  }
  if (/人员|技术负责人|安全员|项目负责人|专职安全/.test(value)) {
    add("人员要求", "技术负责人", "专职安全生产管理人员", "安全生产考核合格证", "c2", "c3");
  }
  if (/资质|资格|安全生产许可证|劳务资质/.test(value)) {
    add("资质要求", "施工劳务资质", "安全生产许可证");
  }
  if (/工期|合同工期|日历天|进场通知/.test(value)) {
    add("工期", "合同工期", "日历天", "进场通知");
  }
  if (/付款|支付|进度款|结算款|质保金|缺陷责任/.test(value)) {
    add("付款方式", "进度款", "结算款", "质保金", "缺陷责任期");
  }
  if (/甲供|材料|机具|设备/.test(value)) {
    add("甲供材料", "甲供机具", "钢筋", "混凝土", "模板", "木方");
  }

  return tokens;
}

export { createSearchTokens, normalizeForSearch, rankKeywordChunks };

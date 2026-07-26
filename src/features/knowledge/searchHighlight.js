// 检索结果里的命中词高亮。中文查询没有空格，按分隔符切出来的整句几乎不可能在原文逐字出现，
// 因此中文按“查询片段与原文的最长公共子串”匹配，只标真实重合的部分，不做同义扩展或模糊匹配。
const cjkPattern = /[㐀-䶿一-鿿豈-﫿]/;
const separatorPattern = /[\s,，。；;、:：()（）【】《》“”"'?？!！]+/;
const minTermLength = 2;

// 只用来挡掉“的了是什么”这类纯功能词造成的噪声高亮；片段里只要有一个实词字符就保留。
const stopwordChars = new Set([..."的了是在和与及对中为并请问什么哪些如何怎多少吗呢这那我你他它个也就都很不还能会被把从向且或者其之于以"]);

function isStopwordFragment(fragment) {
  return [...String(fragment || "")].every((char) => stopwordChars.has(char));
}

function createKnowledgeDisplayTerms(query) {
  const segments = String(query || "")
    .trim()
    .split(separatorPattern)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= minTermLength && !isStopwordFragment(segment));
  return [...new Set(segments)].sort((left, right) => right.length - left.length);
}

function collectPlainRanges(text, term) {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  const ranges = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    ranges.push([index, index + needle.length]);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return ranges;
}

// 逐位取“原文中最长的、同时是查询片段子串的一段”，长度不足 minTermLength 或纯功能词就跳过。
function collectCjkRanges(text, term) {
  const ranges = [];
  let index = 0;
  while (index < text.length) {
    const maxLength = Math.min(term.length, text.length - index);
    let matched = 0;
    for (let length = maxLength; length >= minTermLength; length -= 1) {
      const fragment = text.slice(index, index + length);
      if (term.includes(fragment) && !isStopwordFragment(fragment)) {
        matched = length;
        break;
      }
    }
    if (matched) {
      ranges.push([index, index + matched]);
      index += matched;
    } else {
      index += 1;
    }
  }
  return ranges;
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  return merged;
}

function collectKnowledgeHighlightRanges(text, query) {
  const value = String(text || "");
  const terms = createKnowledgeDisplayTerms(query);
  if (!value || terms.length === 0) return [];
  const ranges = terms.flatMap((term) => (cjkPattern.test(term) ? collectCjkRanges(value, term) : collectPlainRanges(value, term)));
  return mergeRanges(ranges);
}

// 把原文切成 { text, hit } 段，交给渲染层决定用什么标签，匹配逻辑本身与 React 无关。
function splitKnowledgeHighlightParts(text, query) {
  const value = String(text || "");
  const ranges = collectKnowledgeHighlightRanges(value, query);
  if (ranges.length === 0) return value ? [{ text: value, hit: false }] : [];
  const parts = [];
  let cursor = 0;
  ranges.forEach(([start, end]) => {
    if (start > cursor) parts.push({ text: value.slice(cursor, start), hit: false });
    parts.push({ text: value.slice(start, end), hit: true });
    cursor = end;
  });
  if (cursor < value.length) parts.push({ text: value.slice(cursor), hit: false });
  return parts;
}

function getKnowledgePreview(text, query, maxLength = 220) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  const [firstRange] = collectKnowledgeHighlightRanges(value, query);
  // 前导量必须小于窗口长度，否则命中会被挤到窗口之外；默认 maxLength 下仍是原来的 70 字符。
  const lead = Math.min(70, Math.floor(maxLength / 3));
  const start = firstRange ? Math.max(0, firstRange[0] - lead) : 0;
  const end = Math.min(value.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${value.slice(start, end).trim()}${end < value.length ? "..." : ""}`;
}

export {
  collectKnowledgeHighlightRanges,
  createKnowledgeDisplayTerms,
  getKnowledgePreview,
  splitKnowledgeHighlightParts,
};

import { resolveChunkContext } from "./source-resolver.js";

const defaultTotalTokens = 6_000;
const defaultItemTokens = 1_600;
const defaultMaxChars = 12_000;

function applyKnowledgeContextBudget(database, items, {
  totalTokens = positiveNumber(process.env.KNOWLEDGE_CONTEXT_MAX_TOKENS, defaultTotalTokens),
  itemTokens = defaultItemTokens,
  maxChars = positiveNumber(process.env.KNOWLEDGE_CONTEXT_MAX_CHARS, defaultMaxChars),
} = {}) {
  if (!items.length) return { items: [], contextTokensEstimated: 0, contextTruncated: false, droppedExpansionCount: 0 };
  const baseItemBudget = Math.max(1, Math.min(itemTokens, Math.floor(totalTokens / items.length)));
  const baseCharBudget = Math.max(1, Math.floor(maxChars / items.length));
  let contextTruncated = false;
  let droppedExpansionCount = 0;

  const bounded = items.map((item) => {
    const sourceText = String(item.sourceText || item.text || "").trim();
    const text = truncateToBudget(sourceText, baseItemBudget, baseCharBudget);
    const truncated = text.length < sourceText.length;
    contextTruncated ||= truncated;
    return {
      ...item,
      text,
      contextTokensEstimated: estimateKnowledgeTokens(text),
      contextTruncated: truncated,
    };
  });

  let usedTokens = bounded.reduce((sum, item) => sum + item.contextTokensEstimated, 0);
  let usedChars = bounded.reduce((sum, item) => sum + item.text.length, 0);
  for (let index = 0; index < bounded.length; index += 1) {
    const item = bounded[index];
    const expandedText = resolveChunkContext(database, item, maxChars);
    if (!expandedText || expandedText === item.text) continue;
    const expandedTokens = estimateKnowledgeTokens(expandedText);
    const nextTokens = usedTokens - item.contextTokensEstimated + expandedTokens;
    const nextChars = usedChars - item.text.length + expandedText.length;
    if (expandedTokens > itemTokens || nextTokens > totalTokens || nextChars > maxChars) {
      droppedExpansionCount += 1;
      contextTruncated = true;
      bounded[index] = { ...item, contextTruncated: true };
      continue;
    }
    usedTokens = nextTokens;
    usedChars = nextChars;
    bounded[index] = { ...item, text: expandedText, contextTokensEstimated: expandedTokens };
  }

  return {
    items: bounded,
    contextTokensEstimated: usedTokens,
    contextTruncated,
    droppedExpansionCount,
  };
}

function estimateKnowledgeTokens(value) {
  const text = String(value || "");
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latinTokens = (text.match(/[A-Za-z0-9]+/g) || []).reduce((sum, run) => sum + Math.ceil(run.length / 4), 0);
  const punctuationCount = (text.match(/[^\sA-Za-z0-9\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const lineCount = (text.match(/\n/g) || []).length;
  return Math.ceil(cjkCount + latinTokens + punctuationCount / 2 + lineCount);
}

function truncateToBudget(value, maxTokens, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars && estimateKnowledgeTokens(text) <= maxTokens) return text;
  let low = 0;
  let high = Math.min(text.length, maxChars);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateKnowledgeTokens(text.slice(0, middle)) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low).trimEnd();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export {
  applyKnowledgeContextBudget,
  defaultItemTokens,
  defaultMaxChars,
  defaultTotalTokens,
  estimateKnowledgeTokens,
  truncateToBudget,
};

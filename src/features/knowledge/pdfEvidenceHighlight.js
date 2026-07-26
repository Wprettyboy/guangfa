// MinerU content list 的 bbox 归一化到 0-1000 画布，每轴独立、左上原点：
// bbox = middle.json 的页点坐标 / page_size * 1000（8 页测试样本上横版页同样成立）。
// react-pdf-highlighter 的 scaledToViewport 按 viewportWidth * x1 / width 换算，
// 因此把参考尺寸固定成 1000 就能直接复用 MinerU 坐标，不需要页面尺寸，也不做任何文本匹配。
const minerUBboxScale = 1000;

function normalizeMinerUBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const values = bbox.map(Number);
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= minerUBboxScale)) return null;
  const [left, top, right, bottom] = values;
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function createMinerUEvidenceHighlight({ page, bbox, id = "knowledge-evidence", text = "" } = {}) {
  const pageNumber = Math.floor(Number(page) || 0);
  if (pageNumber < 1) return null;
  const normalized = normalizeMinerUBbox(bbox);
  if (!normalized) return null;
  const boundingRect = {
    x1: normalized.left,
    y1: normalized.top,
    x2: normalized.right,
    y2: normalized.bottom,
    width: minerUBboxScale,
    height: minerUBboxScale,
    pageNumber,
  };
  return {
    id,
    position: { boundingRect, rects: [boundingRect], pageNumber, usePdfCoordinates: false },
    content: { text: String(text || "") },
  };
}

// 没有可用 bbox 时只把视图滚到权威页码，不画任何框，也不猜测区域。
function createMinerUPageAnchor(page, id = "knowledge-evidence-page") {
  const pageNumber = Math.floor(Number(page) || 0);
  if (pageNumber < 1) return null;
  const boundingRect = { x1: 0, y1: 0, x2: minerUBboxScale, y2: 1, width: minerUBboxScale, height: minerUBboxScale, pageNumber };
  return { id, position: { boundingRect, rects: [], pageNumber, usePdfCoordinates: false }, content: { text: "" } };
}

export { createMinerUEvidenceHighlight, createMinerUPageAnchor, minerUBboxScale, normalizeMinerUBbox };

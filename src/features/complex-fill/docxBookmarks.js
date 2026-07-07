import JSZip from "jszip";

async function readDocxBookmarkNames(buffer) {
  if (!buffer) return new Set();
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return new Set();
  const names = [...documentXml.matchAll(/<w:bookmarkStart\b[^>]*w:name="([^"]+)"[^>]*>/g)]
    .map((match) => match[1])
    .filter(Boolean);
  return new Set(names);
}

async function validateComplexFillAnchorsInDocx(buffer, anchors = []) {
  const bookmarkNames = await readDocxBookmarkNames(buffer);
  const missingAnchors = [];
  const validAnchors = [];

  anchors.forEach((anchor) => {
    const bookmarkName = String(anchor?.bookmarkName || "");
    const selectionBookmarkName = String(anchor?.selectionBookmarkName || anchor?.rangeBookmarkName || "");
    const hasSelectionBookmark = selectionBookmarkName && bookmarkNames.has(selectionBookmarkName);
    const hasBusinessBookmark = bookmarkName && bookmarkNames.has(bookmarkName);
    if (hasSelectionBookmark && hasBusinessBookmark) {
      validAnchors.push(anchor);
    } else {
      missingAnchors.push({
        ...anchor,
        missingBookmarkName: hasBusinessBookmark ? "" : bookmarkName,
        missingSelectionBookmarkName: hasSelectionBookmark ? "" : selectionBookmarkName,
      });
    }
  });

  return {
    ok: missingAnchors.length === 0,
    validAnchors,
    missingAnchors,
    bookmarkNames,
  };
}

async function validatePlaceholderAnchorsInDocx(buffer, anchors = []) {
  const bookmarkNames = await readDocxBookmarkNames(buffer);
  const missingAnchors = [];
  const validAnchors = [];

  anchors.forEach((anchor) => {
    const bookmarkName = String(anchor?.bookmarkName || "");
    if (bookmarkName && bookmarkNames.has(bookmarkName)) {
      validAnchors.push(anchor);
    } else {
      missingAnchors.push({
        ...anchor,
        missingBookmarkName: bookmarkName,
      });
    }
  });

  return {
    ok: missingAnchors.length === 0,
    validAnchors,
    missingAnchors,
    bookmarkNames,
  };
}

export {
  readDocxBookmarkNames,
  validateComplexFillAnchorsInDocx,
  validatePlaceholderAnchorsInDocx,
};

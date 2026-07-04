import { requestOnlyOfficeDocumentDownloadAs, requestOnlyOfficeDocumentSave } from "./bridge.jsx";
import { resolveOfficeDocumentBuffer } from "./documentSync.js";
import { formatFileSize } from "../../../utils/files.js";

async function buildAutosavedAnnotateDraft(snapshot, options = {}) {
  const { officeDocId, baselineBuffer } = options;
  const sourceFile = snapshot.templateFile;
  if (!officeDocId || !sourceFile?.buffer) return { snapshot, buffer: null };
  try {
    const buffer = await resolveOfficeDocumentBuffer(officeDocId, baselineBuffer || sourceFile.buffer, {
      downloadAs: requestOnlyOfficeDocumentDownloadAs,
      requestSave: requestOnlyOfficeDocumentSave,
      saveTrigger: "draft-autosave",
    });
    if (!buffer) return { snapshot, buffer: null };
    return {
      buffer,
      snapshot: {
        ...snapshot,
        templateFile: {
          ...sourceFile,
          buffer: buffer.slice(0),
          size: formatFileSize(buffer.byteLength),
        },
      },
    };
  } catch {
    return { snapshot, buffer: null };
  }
}

async function buildAutosavedFillDraft(snapshot, options = {}) {
  const { officeDocId, baselineBuffer } = options;
  const sourceFile = snapshot.filledTemplateFile || snapshot.templateFile;
  if (!officeDocId || !sourceFile?.buffer) return { snapshot, buffer: null, filledFile: null };
  try {
    const buffer = await resolveOfficeDocumentBuffer(officeDocId, baselineBuffer || sourceFile.buffer, {
      downloadAs: requestOnlyOfficeDocumentDownloadAs,
      requestSave: requestOnlyOfficeDocumentSave,
      saveTrigger: "draft-autosave",
    });
    if (!buffer) return { snapshot, buffer: null, filledFile: null };
    const filledFile = {
      ...sourceFile,
      buffer: buffer.slice(0),
      size: formatFileSize(buffer.byteLength),
      supported: true,
    };
    return {
      buffer,
      filledFile,
      snapshot: {
        ...snapshot,
        filledTemplateFile: filledFile,
      },
    };
  } catch {
    return { snapshot, buffer: null, filledFile: null };
  }
}

export {
  buildAutosavedAnnotateDraft,
  buildAutosavedFillDraft,
};

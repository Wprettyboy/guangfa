async function waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer, options = {}) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const intervalMs = options.intervalMs ?? 700;
  const start = Date.now();
  await delay(options.initialDelayMs ?? 900);
  while (Date.now() - start < timeoutMs) {
    const buffer = await fetchOfficeDocumentBuffer(officeDocId);
    if (buffer && (!baselineBuffer || !arrayBuffersEqual(buffer, baselineBuffer))) return buffer;
    await delay(intervalMs);
  }
  return null;
}

async function resolveOfficeDocumentBuffer(officeDocId, baselineBuffer, options = {}) {
  const downloadAs = options.downloadAs;
  if (typeof downloadAs === "function") {
    try {
      const buffer = await downloadAs("docx", options.downloadTimeoutMs ?? 15000);
      if (buffer) return buffer;
    } catch {}
  }

  try {
    options.requestSave?.(options.saveTrigger || "office-sync");
  } catch {}

  return (
    (await waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer, {
      timeoutMs: options.timeoutMs ?? 10000,
      intervalMs: options.intervalMs ?? 500,
      initialDelayMs: options.initialDelayMs ?? 600,
    })) ||
    (await fetchOfficeDocumentBuffer(officeDocId))
  );
}

async function fetchOfficeDocumentBuffer(officeDocId) {
  if (!officeDocId) return null;
  try {
    return await apiRequest(`/api/office/documents/${officeDocId}/file?t=${Date.now()}`, {
      cache: "no-store",
      responseType: "arrayBuffer",
      fallbackMessage: "OnlyOffice 文档读取失败",
    });
  } catch {
    return null;
  }
}

function arrayBuffersEqual(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export {
  arrayBuffersEqual,
  delay,
  fetchOfficeDocumentBuffer,
  resolveOfficeDocumentBuffer,
  waitForChangedOfficeDocumentBuffer,
};
import { apiRequest } from "../../../services/apiClient.js";

import { ApiClientError, apiRequest } from "./apiClient.js";

const templateDbName = "tender-agent-template-db";

const templateStoreName = "templates";
const currentDraftVersion = 3;
const defaultTemplateTypeNames = ["招标类", "合同类", "方案类"];
let templateRevisionEtag = "";

async function openTemplateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(templateDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(templateStoreName)) {
        db.createObjectStore(templateStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredTemplates() {
  const serverResult = await readServerTemplates();
  if (serverResult.succeeded) return serverResult.value;

  try {
    const db = await openTemplateDb();
    const templates = await readAllFromTemplateDb(db);
    db.close();
    if (templates.length > 0) {
      return templates.sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
    }
    return migrateLegacyTemplates();
  } catch {
    return migrateLegacyTemplates();
  }
}

async function readStoredTemplate(templateId) {
  const serverResult = await readServerTemplate(templateId);
  if (serverResult.succeeded) return serverResult.value;

  try {
    const db = await openTemplateDb();
    const template = await new Promise((resolve, reject) => {
      const transaction = db.transaction(templateStoreName, "readonly");
      const store = transaction.objectStore(templateStoreName);
      const request = store.get(templateId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return template;
  } catch {
    return null;
  }
}

async function storeTemplates(templates) {
  const cleanTemplates = templates.map(sanitizeTemplateForStorage);
  await storeServerTemplates(cleanTemplates);
  try {
    const db = await openTemplateDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(templateStoreName, "readwrite");
      const store = transaction.objectStore(templateStoreName);
      store.clear();
      cleanTemplates.forEach((template) => store.put(template));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  } catch {
    // The backend file library is authoritative; IndexedDB is only a browser cache.
  }
}

async function readServerTemplates() {
  try {
    const response = await apiRequest("/api/templates", {
      responseType: "response",
      fallbackMessage: "后端模板库读取失败",
    });
    const templates = await response.json();
    templateRevisionEtag = response.headers.get("ETag") || "";
    return {
      succeeded: true,
      value: Array.isArray(templates) ? templates.map(deserializeTemplate).sort(sortTemplatesBySavedAt) : [],
    };
  } catch {
    return { succeeded: false, value: [] };
  }
}

async function readServerTemplate(templateId) {
  try {
    const template = await apiRequest(`/api/templates/${encodeURIComponent(templateId)}`, {
      fallbackMessage: "模板读取失败",
    });
    return { succeeded: true, value: template ? deserializeTemplate(template) : null };
  } catch (error) {
    return {
      succeeded: error instanceof ApiClientError && error.status === 404,
      value: null,
    };
  }
}

async function storeServerTemplates(templates) {
  await requestTemplateMutation("/api/templates", {
    method: "POST",
    json: templates.map(serializeTemplate),
    timeoutMs: 120_000,
    fallbackMessage: "后端模板库保存失败",
  });
}

async function readDraftState() {
  try {
    const draft = await apiRequest("/api/draft", {
      fallbackMessage: "草稿读取失败",
    });
    const restoredDraft = deserializeDraft(draft);
    if (!restoredDraft && draft?.templateFile?.fileBase64) {
      await clearDraftState();
    }
    return restoredDraft;
  } catch {
    return null;
  }
}

async function readTemplateTypes() {
  try {
    const response = await apiRequest("/api/template-types", {
      responseType: "response",
      fallbackMessage: "模板类别读取失败",
    });
    templateRevisionEtag = response.headers.get("ETag") || templateRevisionEtag;
    const types = await response.json();
    const normalized = normalizeTemplateTypes(types);
    return normalized.length > 0 ? normalized : defaultTemplateTypeNames.map(createFallbackTemplateType);
  } catch {
    return defaultTemplateTypeNames.map(createFallbackTemplateType);
  }
}

async function createTemplateType(payload) {
  const response = await requestTemplateMutation("/api/template-types", {
    method: "POST",
    json: payload || {},
    fallbackMessage: "模板类别新增失败",
  });
  return response.json();
}

async function updateTemplateType(typeId, payload) {
  const response = await requestTemplateMutation(`/api/template-types/${encodeURIComponent(typeId)}`, {
    method: "PUT",
    json: payload || {},
    fallbackMessage: "模板类别修改失败",
  });
  return response.json();
}

async function deleteTemplateType(typeId) {
  const response = await requestTemplateMutation(`/api/template-types/${encodeURIComponent(typeId)}`, {
    method: "DELETE",
    fallbackMessage: "模板类别删除失败",
  });
  return response.json();
}

async function requestTemplateMutation(path, options) {
  const expectedEtag = templateRevisionEtag;
  try {
    const response = await apiRequest(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(expectedEtag ? { "If-Match": expectedEtag } : {}),
      },
      responseType: "response",
    });
    templateRevisionEtag = response.headers.get("ETag") || expectedEtag;
    return response;
  } catch (error) {
    if (!(error instanceof ApiClientError) || ![412, 428].includes(error.status)) throw error;
    const latestTemplates = await readServerTemplates();
    const conflict = new Error(
      error.status === 428
        ? "模板库写入缺少有效版本，请刷新模板库后重新执行本次操作。"
        : "模板库已被其他用户或标签页更新，请刷新后重新执行本次操作。",
      { cause: error },
    );
    conflict.code = error.status === 428 ? "TEMPLATE_PRECONDITION_REQUIRED" : "TEMPLATE_WRITE_CONFLICT";
    conflict.latestTemplates = latestTemplates.succeeded ? latestTemplates.value : null;
    throw conflict;
  }
}

async function saveDraftState(draft) {
  if (!draft.templateFile?.buffer) return;
  try {
    await apiRequest("/api/draft", {
      method: "POST",
      json: serializeDraft(draft),
      timeoutMs: 120_000,
      fallbackMessage: "草稿保存失败",
    });
  } catch {
    // Draft autosave should never block the workspace.
  }
}

async function clearDraftState() {
  try {
    await apiRequest("/api/draft", {
      method: "POST",
      json: {},
      fallbackMessage: "草稿清理失败",
    });
  } catch {
    // Draft cleanup should never block creating a new template.
  }
}

function shouldRestoreDraftState(draft, templates = []) {
  if (!draft?.templateFile?.buffer) return false;
  if (draft.activeWorkspace === "annotate" && isDraftForStoredTemplate(draft, templates)) return false;
  return true;
}

function shouldSaveWorkspaceDraft(draft, templates = []) {
  if (!draft?.templateFile?.buffer) return false;
  if (draft.activeWorkspace === "annotate" && storedTemplateMatchesFile(draft.templateFile, templates)) return false;
  return true;
}

function isDraftForStoredTemplate(draft, templates = []) {
  return storedTemplateMatchesFile(draft?.templateFile, templates);
}

function storedTemplateMatchesFile(file, templates = []) {
  if (!file) return false;
  const sourceTemplateId = String(file.sourceTemplateId || "");
  const fileName = normalizeTemplateFileIdentity(file.fileName || file.name);
  return templates.some((template) => {
    if (sourceTemplateId && sourceTemplateId === String(template.id || "")) return true;
    return fileName && fileName === normalizeTemplateFileIdentity(template.fileName || template.name);
  });
}

function normalizeTemplateFileIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function serializeDraft(draft) {
  const cleanDraft = {
    ...draft,
    templateFields: sanitizeTemplateFields(draft.templateFields),
    fillFields: sanitizeTemplateFields(draft.fillFields),
  };
  return {
    ...cleanDraft,
    draftVersion: currentDraftVersion,
    templateFile: cleanDraft.templateFile
      ? {
          ...cleanDraft.templateFile,
          buffer: undefined,
          fileBase64: cleanDraft.templateFile.buffer ? arrayBufferToBase64(cleanDraft.templateFile.buffer) : null,
        }
      : null,
    filledTemplateFile: cleanDraft.filledTemplateFile
      ? {
          ...cleanDraft.filledTemplateFile,
          buffer: undefined,
          fileBase64: cleanDraft.filledTemplateFile.buffer ? arrayBufferToBase64(cleanDraft.filledTemplateFile.buffer) : null,
        }
      : null,
    savedAt: new Date().toISOString(),
  };
}

function deserializeDraft(draft) {
  if (!draft?.templateFile?.fileBase64) return null;
  if (draft.draftVersion !== currentDraftVersion) return null;
  return {
    ...draft,
    templateFields: sanitizeTemplateFields(draft.templateFields),
    fillFields: sanitizeTemplateFields(draft.fillFields),
    templateFile: {
      ...draft.templateFile,
      buffer: base64ToArrayBuffer(draft.templateFile.fileBase64),
    },
    filledTemplateFile: draft.filledTemplateFile?.fileBase64
      ? {
          ...draft.filledTemplateFile,
          buffer: base64ToArrayBuffer(draft.filledTemplateFile.fileBase64),
        }
      : null,
  };
}

function normalizeKnowledgeBaseIds(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function readAllFromTemplateDb(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(templateStoreName, "readonly");
    const store = transaction.objectStore(templateStoreName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

function serializeTemplate(template) {
  const cleanTemplate = sanitizeTemplateForStorage(template);
  return {
    ...cleanTemplate,
    fileBuffer: undefined,
    fileBase64: cleanTemplate.fileBuffer ? arrayBufferToBase64(cleanTemplate.fileBuffer) : cleanTemplate.fileBase64,
  };
}

function deserializeTemplate(template) {
  if (!template) return template;
  const cleanTemplate = sanitizeTemplateForStorage(template);
  return {
    ...cleanTemplate,
    fileBuffer: cleanTemplate.fileBuffer || (cleanTemplate.fileBase64 ? base64ToArrayBuffer(cleanTemplate.fileBase64) : null),
  };
}

function sanitizeTemplateForStorage(template) {
  if (!template) return template;
  return {
    ...template,
    fields: sanitizeTemplateFields(template.fields),
  };
}

function sanitizeTemplateFields(fields) {
  return Array.isArray(fields) ? fields.map(stripSelectionStateFromField) : fields;
}

function stripSelectionStateFromField(field) {
  if (!field?.marker?.selectionState) return field;
  const { selectionState, ...marker } = field.marker;
  return { ...field, marker };
}

function sortTemplatesBySavedAt(a, b) {
  return (b.savedAtMs || 0) - (a.savedAtMs || 0);
}

function normalizeTemplateTypes(types) {
  const seen = new Set();
  return (Array.isArray(types) ? types : [])
    .map((type, index) => ({
      id: String(type?.id || `TYPE-FALLBACK-${index + 1}`),
      name: String(type?.name || "").trim(),
      description: String(type?.description || ""),
      sortOrder: Number(type?.sortOrder || index),
      templateCount: Number(type?.templateCount || 0),
    }))
    .filter((type) => {
      if (!type.name || seen.has(type.name)) return false;
      seen.add(type.name);
      return true;
    });
}

function createFallbackTemplateType(name, index) {
  return {
    id: `TYPE-FALLBACK-${index + 1}`,
    name,
    description: "",
    sortOrder: index,
    templateCount: 0,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function migrateLegacyTemplates() {
  try {
    const raw = localStorage.getItem("tender-agent-template-library");
    const templates = raw ? JSON.parse(raw) : [];
    if (templates.length > 0) {
      await storeTemplates(templates);
    }
    return templates;
  } catch {
    return [];
  }
}



export {
  templateDbName,
  templateStoreName,
  openTemplateDb,
  readStoredTemplates,
  readStoredTemplate,
  storeTemplates,
  readServerTemplates,
  readServerTemplate,
  storeServerTemplates,
  readTemplateTypes,
  createTemplateType,
  updateTemplateType,
  deleteTemplateType,
  readDraftState,
  saveDraftState,
  clearDraftState,
  shouldRestoreDraftState,
  shouldSaveWorkspaceDraft,
  serializeDraft,
  deserializeDraft,
  normalizeKnowledgeBaseIds,
  readAllFromTemplateDb,
  serializeTemplate,
  deserializeTemplate,
  sanitizeTemplateForStorage,
  sanitizeTemplateFields,
  stripSelectionStateFromField,
  sortTemplatesBySavedAt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  migrateLegacyTemplates,
};


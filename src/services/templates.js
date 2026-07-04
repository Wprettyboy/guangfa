const templateDbName = "tender-agent-template-db";

const templateStoreName = "templates";
const currentDraftVersion = 3;

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
  const serverTemplates = await readServerTemplates();
  if (serverTemplates.length > 0) return serverTemplates;

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
  const serverTemplate = await readServerTemplate(templateId);
  if (serverTemplate) return serverTemplate;

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
    const response = await fetch("/api/templates");
    if (!response.ok) return [];
    const templates = await response.json();
    return Array.isArray(templates) ? templates.map(deserializeTemplate).sort(sortTemplatesBySavedAt) : [];
  } catch {
    return [];
  }
}

async function readServerTemplate(templateId) {
  try {
    const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`);
    if (!response.ok) return null;
    const template = await response.json();
    return template ? deserializeTemplate(template) : null;
  } catch {
    return null;
  }
}

async function storeServerTemplates(templates) {
  const response = await fetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(templates.map(serializeTemplate)),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "后端模板库保存失败");
  }
}

async function readDraftState() {
  try {
    const response = await fetch("/api/draft");
    if (!response.ok) return null;
    const draft = await response.json();
    const restoredDraft = deserializeDraft(draft);
    if (!restoredDraft && draft?.templateFile?.fileBase64) {
      await clearDraftState();
    }
    return restoredDraft;
  } catch {
    return null;
  }
}

async function saveDraftState(draft) {
  if (!draft.templateFile?.buffer) return;
  try {
    await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeDraft(draft)),
    });
  } catch {
    // Draft autosave should never block the workspace.
  }
}

async function clearDraftState() {
  try {
    await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
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


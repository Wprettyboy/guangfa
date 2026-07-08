let activeEditor = null;
let activeConnector = null;
let connectorStatus = {
  available: false,
  checked: false,
  reason: "not-initialized",
};

function registerOnlyOfficeEditor(editor) {
  activeEditor = editor || null;
  activeConnector = null;
  connectorStatus = {
    available: false,
    checked: Boolean(editor),
    reason: editor ? "not-created" : "missing-editor",
  };
  return ensureOnlyOfficeConnector();
}

function clearOnlyOfficeEditor(editor) {
  if (!editor || activeEditor === editor) {
    activeEditor = null;
    activeConnector = null;
    connectorStatus = {
      available: false,
      checked: false,
      reason: "cleared",
    };
  }
}

function ensureOnlyOfficeConnector() {
  if (activeConnector) return activeConnector;
  if (!activeEditor) {
    connectorStatus = { available: false, checked: true, reason: "missing-editor" };
    return null;
  }
  if (typeof activeEditor.createConnector !== "function") {
    connectorStatus = { available: false, checked: true, reason: "createConnector-unavailable" };
    return null;
  }
  try {
    activeConnector = activeEditor.createConnector();
    connectorStatus = activeConnector
      ? { available: true, checked: true, reason: "ready" }
      : { available: false, checked: true, reason: "createConnector-empty" };
  } catch (error) {
    activeConnector = null;
    connectorStatus = {
      available: false,
      checked: true,
      reason: error?.message || "createConnector-failed",
    };
  }
  return activeConnector;
}

function getOnlyOfficeConnectorStatus() {
  ensureOnlyOfficeConnector();
  return { ...connectorStatus };
}

function callOnlyOfficeConnectorCommand(command, options = {}) {
  const connector = ensureOnlyOfficeConnector();
  if (!connector || typeof connector.callCommand !== "function") {
    return Promise.resolve({ ok: false, skipped: true, source: "connector", reason: connectorStatus.reason });
  }
  const timeoutMs = Number(options.timeoutMs || 12000);
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve(result && typeof result === "object" ? result : { ok: true, source: "connector", value: result });
    };
    const timer = window.setTimeout(() => finish({ ok: false, timeout: true, source: "connector", reason: "timeout" }), timeoutMs);
    try {
      connector.callCommand(command, finish);
    } catch (error) {
      finish({ ok: false, source: "connector", reason: error?.message || "callCommand-failed" });
    }
  });
}

export {
  callOnlyOfficeConnectorCommand,
  clearOnlyOfficeEditor,
  getOnlyOfficeConnectorStatus,
  registerOnlyOfficeEditor,
};

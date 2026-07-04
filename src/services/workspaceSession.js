const workspaceSessionKey = "guangfa-workspace-session";

const validModules = new Set(["workspace", "template-management", "knowledge-management", "settings"]);
const validWorkspaces = new Set(["annotate", "fill", "audit"]);
const validAnnotatePanels = new Set(["fields", "placeholders"]);

function readWorkspaceSession() {
  try {
    return normalizeWorkspaceSession(JSON.parse(localStorage.getItem(workspaceSessionKey) || "{}"));
  } catch {
    return {};
  }
}

function saveWorkspaceSession(session = {}) {
  try {
    localStorage.setItem(workspaceSessionKey, JSON.stringify(normalizeWorkspaceSession({ ...session, updatedAt: Date.now() })));
  } catch {
    // Session restore is a convenience feature and should never block editing.
  }
}

function normalizeWorkspaceSession(session = {}) {
  const activeModule = validModules.has(session.activeModule) ? session.activeModule : "workspace";
  const activeWorkspace = validWorkspaces.has(session.activeWorkspace) ? session.activeWorkspace : "annotate";
  const annotateSidePanelMode = validAnnotatePanels.has(session.annotateSidePanelMode) ? session.annotateSidePanelMode : "fields";
  return {
    activeModule,
    activeWorkspace,
    annotateSidePanelMode,
    annotatePreviewPage: normalizePage(session.annotatePreviewPage),
    fillPreviewPage: normalizePage(session.fillPreviewPage),
    selectedTemplateFieldId: String(session.selectedTemplateFieldId || ""),
    selectedFieldId: String(session.selectedFieldId || ""),
    citationFieldId: String(session.citationFieldId || ""),
    workspaceNavOpen: session.workspaceNavOpen !== false,
    settingsNavOpen: session.settingsNavOpen !== false,
    updatedAt: Number(session.updatedAt || 0),
  };
}

function normalizePage(page) {
  const value = Math.floor(Number(page) || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export {
  readWorkspaceSession,
  saveWorkspaceSession,
};

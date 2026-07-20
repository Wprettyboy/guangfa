import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { runInNewContext } from "node:vm";
import JSZip from "jszip";
import { assertFillModelResult } from "../server/ai/fill.js";
import { normalizeFillModelResult } from "../server/ai/fill-rules.js";
import { parseModelJson } from "../server/ai/model.js";
import { isAllowedOrigin, readAllowedOrigins } from "../server/api/gateway.js";
import { assertOfficeDocumentId, createOfficeDocument, validateOnlyOfficeDocumentUrl } from "../server/office.js";
import { API_KEY_UNCHANGED, redactModelConfig, resolveApiKeyUpdate } from "../server/settings.js";
import { normalizeDraftFillState } from "../src/features/docx/fill/draftState.js";
import { clearOnlyOfficeEditor, registerOnlyOfficeEditor } from "../src/features/docx/office/connector.js";
import { insertSolutionWritingWithConnector } from "../src/features/docx/office/solutionConnector.js";
import { buildPlanningReplaceTarget, normalizePlanningSubtreeMetadata } from "../src/features/solution-writing/planningInsert.js";
import { normalizeWorkspaceSession } from "../src/services/workspaceSession.js";

test("workspace sessions restore standalone and annotation workspaces", () => {
  assert.equal(normalizeWorkspaceSession({ activeWorkspace: "solution-writing" }).activeWorkspace, "solution-writing");
  assert.equal(normalizeWorkspaceSession({ activeWorkspace: "layout" }).activeWorkspace, "layout");
  assert.equal(normalizeWorkspaceSession({ annotateSidePanelMode: "complex-fill" }).annotateSidePanelMode, "complex-fill");

  const legacySession = normalizeWorkspaceSession({
    activeWorkspace: "annotate",
    annotateSidePanelMode: "solution-writing",
  });
  assert.equal(legacySession.activeWorkspace, "solution-writing");
  assert.equal(legacySession.annotateSidePanelMode, "fields");
});

test("legacy solution-writing drafts migrate to the standalone workspace", () => {
  const draft = normalizeDraftFillState({
    activeWorkspace: "annotate",
    annotateSidePanelMode: "solution-writing",
  });

  assert.equal(draft.activeWorkspace, "solution-writing");
  assert.equal(draft.annotateSidePanelMode, "fields");
});

test("solution planning inserts preserve the selected template subtree target", () => {
  const target = buildPlanningReplaceTarget({
    title: "display title must not become the target",
    styleRef: {
      paragraphIndex: 12,
      outlineIndex: 4,
      title: "3.2 Detailed design",
      level: 1,
      styleName: "Heading 2",
    },
    subtreeEndRef: {
      paragraphIndex: 21,
      outlineIndex: 9,
      title: "3.3 Deployment",
      level: 1,
      styleName: "Heading 2",
    },
    subtreeParagraphCount: 9,
  });

  assert.deepEqual(target, {
    scope: "subtree",
    title: "3.2 Detailed design",
    styleRef: {
      paragraphIndex: 12,
      outlineIndex: 4,
      title: "3.2 Detailed design",
      text: "",
      level: 1,
      styleName: "Heading 2",
    },
    subtreeEndRef: {
      paragraphIndex: 21,
      outlineIndex: 9,
      title: "3.3 Deployment",
      text: "",
      level: 1,
      styleName: "Heading 2",
    },
    subtreeParagraphCount: 9,
  });
  assert.equal(buildPlanningReplaceTarget({ ...target, subtreeParagraphCount: 0 }), null);
  assert.equal(buildPlanningReplaceTarget({ ...target, subtreeEndRef: { ...target.subtreeEndRef, paragraphIndex: 20 } }), null);
  assert.equal(buildPlanningReplaceTarget({ ...target, subtreeEndRef: { title: "invalid boundary" } }), null);
  assert.equal(buildPlanningReplaceTarget({ ...target, styleRef: { ...target.styleRef, paragraphIndex: null } }), null);
  assert.equal(buildPlanningReplaceTarget({ ...target, subtreeEndRef: { paragraphIndex: 21 } }), null);
  const { subtreeEndRef, ...missingBoundaryTarget } = target;
  assert.equal(buildPlanningReplaceTarget(missingBoundaryTarget), null);
  assert.equal(buildPlanningReplaceTarget({ ...target, subtreeEndRef: null })?.subtreeEndRef, null);

  const missingBoundaryMetadata = normalizePlanningSubtreeMetadata({ subtreeParagraphCount: 9 });
  assert.equal(Object.hasOwn(missingBoundaryMetadata, "subtreeEndRef"), false);
  assert.equal(buildPlanningReplaceTarget({ ...missingBoundaryTarget, ...missingBoundaryMetadata }), null);
  const invalidBoundaryMetadata = normalizePlanningSubtreeMetadata({ subtreeParagraphCount: 9, subtreeEndRef: { title: "invalid" } });
  assert.equal(Object.hasOwn(invalidBoundaryMetadata, "subtreeEndRef"), true);
  assert.equal(buildPlanningReplaceTarget({ ...target, ...invalidBoundaryMetadata }), null);
});

test("OnlyOffice outline metadata dereferences the SDK outline entry paragraph", async () => {
  const source = await readFile(new URL("../scripts/onlyoffice-outline-probe.js", import.meta.url), "utf8");
  assert.match(source, /const outlineEntry = outlineElements\?\.\[item\.index\]/);
  assert.match(source, /paragraphIndexes\.get\(outlineEntry\?\.Paragraph\)/);
  assert.match(source, /title: found\.text/);
});

test("OnlyOffice probe replaces a precise subtree through the loaded Builder API", async () => {
  const source = await readFile(new URL("../scripts/onlyoffice-outline-probe.js", import.meta.url), "utf8");
  let messageHandler = null;
  let documentApi = null;
  let actionStarts = 0;
  let actionFinishes = 0;
  let cachedMainParagraphs = null;
  let paragraphCacheClears = 0;
  let numberedStyleApplications = 0;
  let resolveOutline;
  let resolveInsert;
  const outlined = new Promise((resolve) => { resolveOutline = resolve; });
  const inserted = new Promise((resolve) => { resolveInsert = resolve; });
  const numberedStyle = { numbered: true };
  const createParagraph = (text = "") => {
    const paragraph = {
      numbered: false,
      text,
      AddText(value) {
        this.text += String(value || "");
        return {};
      },
      Delete() {
        const index = mainParagraphs.indexOf(paragraph);
        if (index < 0) return false;
        mainParagraphs.splice(index, 1);
        return true;
      },
      GetParaPr() {
        return {
          GetStyle: () => (paragraph.numbered ? numberedStyle : null),
          SetStyle: (style) => paragraph.SetStyle(style),
        };
      },
      GetIndex() {
        return mainParagraphs.indexOf(paragraph);
      },
      GetText(options) {
        if (!options?.Numbering || !paragraph.numbered) return this.text;
        const paragraphIndex = mainParagraphs.indexOf(paragraph);
        const number = mainParagraphs.slice(0, paragraphIndex + 1).filter((item) => item.numbered).length;
        return `${number}. ${this.text}`;
      },
      private_GetImpl() {
        return paragraph;
      },
      SetStyle(style) {
        paragraph.numbered = Boolean(style?.numbered);
        if (paragraph.numbered) numberedStyleApplications += 1;
        return true;
      },
    };
    return paragraph;
  };
  const mainParagraphs = ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"].map(createParagraph);
  mainParagraphs[1].numbered = true;
  mainParagraphs[4].numbered = true;
  const wrapParagraph = (paragraph) => new Proxy(paragraph, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const headerParagraph = createParagraph("Header");
  const footnoteParagraph = createParagraph("Footnote");
  const logicDocument = {
    ClearListsCache() {
      cachedMainParagraphs = null;
      paragraphCacheClears += 1;
    },
    FinalizeAction() {
      actionFinishes += 1;
    },
    GetAllParagraphs(options) {
      if (!options?.OnlyMainDocument) return [...documentApi.paragraphs];
      if (cachedMainParagraphs === null) cachedMainParagraphs = [...mainParagraphs];
      return cachedMainParagraphs;
    },
    Recalculate() {},
    StartAction() {
      actionStarts += 1;
    },
    UpdateInterface() {},
    UpdateSelection() {},
  };
  documentApi = {
    get paragraphs() {
      return [headerParagraph, ...mainParagraphs, footnoteParagraph];
    },
    Document: logicDocument,
    AddElement(index, paragraph) {
      mainParagraphs.splice(index, 0, paragraph);
      return true;
    },
    GetAllParagraphs() {
      return this.paragraphs.map(wrapParagraph);
    },
    GetStyle(name) {
      return name === "Heading 2" ? numberedStyle : null;
    },
  };
  const parent = {
    postMessage(message) {
      if (message?.action === "onlyoffice-outline-probe") resolveOutline(message.outline);
      if (message?.action === "solution-writing-inserted") resolveInsert(message.result);
    },
  };
  const outlineRows = [
    { paragraph: mainParagraphs[1], level: 1, title: "Template root" },
    { paragraph: mainParagraphs[2], level: 2, title: "Template child" },
    { paragraph: mainParagraphs[4], level: 1, title: "Next chapter" },
  ];
  const outlineManager = {
    Elements: outlineRows.map((row) => ({ Paragraph: row.paragraph, Lvl: row.level })),
    get_ElementsCount: () => outlineRows.length,
    get_Level: (index) => outlineRows[index].level,
    get_Text: (index) => outlineRows[index].title,
    isEmptyItem: () => false,
    isFirstItemNotHeader: () => false,
  };
  const asc = {
    editor: {
      WordControl: { m_oLogicDocument: logicDocument },
      asc_Save() {},
    },
    scope: {},
  };
  const windowObject = {
    Asc: asc,
    AscBuilder: {
      Api: {
        CreateParagraph: () => createParagraph(),
        GetDocument: () => documentApi,
      },
    },
    AscDFH: { historydescription_BuilderScript: 1 },
    DE: {
      getController: () => ({ _navigationObject: outlineManager, api: asc.editor }),
    },
    addEventListener(type, handler) {
      if (type === "message") messageHandler = handler;
    },
    clearInterval() {},
    clearTimeout() {},
    parent,
    setInterval: () => 1,
    setTimeout: () => 1,
    top: parent,
  };
  const quietConsole = { error() {}, log() {}, table() {}, warn() {} };
  runInNewContext(source, { Asc: asc, console: quietConsole, window: windowObject });
  assert.equal(typeof messageHandler, "function");

  messageHandler({ data: { source: "guangfa-parent", action: "request-outline", requestId: "builder-api-outline" } });
  const outline = await outlined;
  const target = outline.items.find((item) => item.title === "Template root");
  assert.equal(target.paragraphIndex, 1);
  assert.equal(target.styleRef.paragraphIndex, 1);
  assert.equal(target.subtreeEndRef.paragraphIndex, 4);
  assert.equal(target.subtreeParagraphCount, 3);

  messageHandler({
    data: {
      source: "guangfa-parent",
      action: "insert-solution-writing-text",
      requestId: "builder-api-subtree",
      text: "New root\nNew body",
      paragraphs: [
        { type: "heading", text: "New root", styleName: "Heading 2" },
        { type: "body", text: "New body" },
      ],
      replaceTarget: {
        scope: "subtree",
        title: target.styleRef.title,
        styleRef: target.styleRef,
        subtreeEndRef: target.subtreeEndRef,
        subtreeParagraphCount: target.subtreeParagraphCount,
      },
    },
  });

  const result = await inserted;
  assert.equal(result.ok, true);
  assert.equal(result.source, "api-replace-heading-subtree");
  assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "New root", "New body", "Next chapter", "After", "Footnote"]);

  const outlinedEnd = new Promise((resolve) => { resolveOutline = resolve; });
  messageHandler({ data: { source: "guangfa-parent", action: "request-outline", requestId: "builder-api-end-outline" } });
  const endOutline = await outlinedEnd;
  const endTarget = endOutline.items.find((item) => item.title === "Next chapter");
  assert.equal(endTarget.styleRef.paragraphIndex, 3);
  assert.equal(endTarget.subtreeParagraphCount, 2);
  assert.equal(endTarget.subtreeEndRef, null);

  const insertedEnd = new Promise((resolve) => { resolveInsert = resolve; });
  messageHandler({
    data: {
      source: "guangfa-parent",
      action: "insert-solution-writing-text",
      requestId: "builder-api-end-subtree",
      text: "Final chapter",
      paragraphs: [{ type: "heading", text: "Final chapter", styleName: "Heading 2" }],
      replaceTarget: {
        scope: "subtree",
        title: endTarget.styleRef.title,
        styleRef: endTarget.styleRef,
        subtreeEndRef: null,
        subtreeParagraphCount: endTarget.subtreeParagraphCount,
      },
    },
  });
  const endResult = await insertedEnd;
  assert.equal(endResult.ok, true);
  assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "New root", "New body", "Final chapter", "Footnote"]);
  assert.equal(actionStarts, 2);
  assert.equal(actionFinishes, 2);
  assert.ok(paragraphCacheClears > 0);
  assert.equal(numberedStyleApplications, 2);
});

test("solution connector replaces only the selected template subtree", async () => {
  const previousWindow = globalThis.window;
  const previousApi = globalThis.Api;
  let documentApi;
  let addElementFailureAt = -1;
  let addElementCallCount = 0;
  let deleteFailureText = "";
  let mainParagraphs = [];
  let headerParagraph = null;
  let footnoteParagraph = null;
  let cachedMainParagraphs = null;
  let paragraphCacheClears = 0;
  let numberedStyleApplications = 0;
  const numberedStyle = { numbered: true };
  const createParagraph = (text = "") => {
    const paragraph = {
      numbered: false,
      text,
      AddText(value) {
        this.text += String(value || "");
      },
      Delete() {
        if (paragraph.text === deleteFailureText) return false;
        const index = mainParagraphs.indexOf(paragraph);
        if (index < 0) return false;
        mainParagraphs.splice(index, 1);
        return true;
      },
      GetParaPr() {
        return {
          GetStyle: () => (paragraph.numbered ? numberedStyle : null),
          SetStyle: (style) => paragraph.SetStyle(style),
        };
      },
      GetText(options) {
        if (!options?.Numbering || !paragraph.numbered) return this.text;
        const paragraphIndex = mainParagraphs.indexOf(paragraph);
        const number = mainParagraphs.slice(0, paragraphIndex + 1).filter((item) => item.numbered).length;
        return `${number}. ${this.text}`;
      },
      private_GetImpl() {
        return paragraph;
      },
      GetIndex() {
        return mainParagraphs.indexOf(paragraph);
      },
      SetStyle(style) {
        paragraph.numbered = Boolean(style?.numbered);
        if (paragraph.numbered) numberedStyleApplications += 1;
        return true;
      },
    };
    return paragraph;
  };
  const wrapParagraph = (paragraph) => new Proxy(paragraph, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const resetDocument = () => {
    addElementCallCount = 0;
    mainParagraphs = ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"].map(createParagraph);
    mainParagraphs[1].numbered = true;
    mainParagraphs[4].numbered = true;
    headerParagraph = createParagraph("Header");
    footnoteParagraph = createParagraph("Footnote");
    cachedMainParagraphs = null;
    documentApi = {
      get paragraphs() {
        return [headerParagraph, ...mainParagraphs, footnoteParagraph];
      },
      Document: {
        ClearListsCache() {
          cachedMainParagraphs = null;
          paragraphCacheClears += 1;
        },
        GetAllParagraphs() {
          if (cachedMainParagraphs === null) {
            cachedMainParagraphs = mainParagraphs.map((paragraph) => paragraph.private_GetImpl());
          }
          return cachedMainParagraphs;
        },
      },
      AddElement(index, paragraph) {
        if (addElementCallCount === addElementFailureAt) {
          addElementCallCount += 1;
          return false;
        }
        addElementCallCount += 1;
        mainParagraphs.splice(index, 0, paragraph);
        return true;
      },
      GetAllParagraphs() {
        return this.paragraphs.map(wrapParagraph);
      },
      GetStyle(name) {
        return name === "Heading 2" ? numberedStyle : null;
      },
      InsertContent(content) {
        mainParagraphs.push(...content);
        return true;
      },
    };
  };
  resetDocument();
  globalThis.window = { clearTimeout, setTimeout };
  globalThis.Api = {
    CreateParagraph: () => createParagraph(),
    GetDocument: () => documentApi,
  };
  const editor = {
    createConnector: () => ({
      callCommand(command, callback) {
        callback(command());
      },
    }),
  };
  registerOnlyOfficeEditor(editor);
  const replaceTarget = {
    scope: "subtree",
    title: "1. Template root",
    styleRef: { paragraphIndex: 1, title: "1. Template root" },
    subtreeEndRef: { paragraphIndex: 4, title: "2. Next chapter" },
    subtreeParagraphCount: 3,
  };

  try {
    const result = await insertSolutionWritingWithConnector({
      text: "New module\nNew planning body",
      paragraphs: [
        { type: "module-heading", text: "New module", styleName: "Heading 2" },
        { type: "body", text: "New planning body" },
      ],
      requestId: "subtree-regression",
      timeoutMs: 1000,
      replaceTarget,
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "connector-replace-heading-subtree");
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "New module", "New planning body", "Next chapter", "After", "Footnote"]);

    const endResult = await insertSolutionWritingWithConnector({
      text: "Final chapter",
      paragraphs: [{ type: "module-heading", text: "Final chapter", styleName: "Heading 2" }],
      requestId: "subtree-document-end",
      timeoutMs: 1000,
      replaceTarget: {
        scope: "subtree",
        title: "2. Next chapter",
        styleRef: { paragraphIndex: 3, title: "2. Next chapter" },
        subtreeEndRef: null,
        subtreeParagraphCount: 2,
      },
    });
    assert.equal(endResult.ok, true);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "New module", "New planning body", "Final chapter", "Footnote"]);

    resetDocument();
    const bodyResult = await insertSolutionWritingWithConnector({
      text: "New exact body",
      paragraphs: [{ type: "body", text: "New exact body" }],
      requestId: "body-exact-target",
      timeoutMs: 1000,
      replaceTarget: {
        title: "Template child",
        styleRef: { paragraphIndex: 2, title: "Template child" },
        bodyParagraphCount: 1,
      },
    });
    assert.equal(bodyResult.ok, true);
    assert.equal(bodyResult.source, "connector-replace-heading-body");
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "New exact body", "Next chapter", "After", "Footnote"]);

    resetDocument();
    const invalidResult = await insertSolutionWritingWithConnector({
      text: "Must not insert",
      paragraphs: [{ type: "body", text: "Must not insert" }],
      requestId: "subtree-invalid-boundary",
      timeoutMs: 1000,
      replaceTarget: { ...replaceTarget, subtreeEndRef: { paragraphIndex: 5, title: "Next chapter" } },
    });
    assert.equal(invalidResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);

    resetDocument();
    addElementFailureAt = 1;
    const rolledBackResult = await insertSolutionWritingWithConnector({
      text: "First inserted paragraph\nSecond inserted paragraph",
      paragraphs: [
        { type: "module-heading", text: "First inserted paragraph" },
        { type: "body", text: "Second inserted paragraph" },
      ],
      requestId: "subtree-insert-rollback",
      timeoutMs: 1000,
      replaceTarget,
    });
    assert.equal(rolledBackResult.ok, false);
    assert.equal(rolledBackResult.partial, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);
    addElementFailureAt = -1;

    resetDocument();
    deleteFailureText = "Old body";
    const deleteRolledBackResult = await insertSolutionWritingWithConnector({
      text: "New module\nNew planning body",
      paragraphs: [
        { type: "module-heading", text: "New module" },
        { type: "body", text: "New planning body" },
      ],
      requestId: "subtree-delete-rollback",
      timeoutMs: 1000,
      replaceTarget,
    });
    assert.equal(deleteRolledBackResult.ok, false);
    assert.equal(deleteRolledBackResult.partial, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);
    deleteFailureText = "";

    const titleOnlyResult = await insertSolutionWritingWithConnector({
      text: "Must not replace paragraph zero",
      paragraphs: [{ type: "body", text: "Must not replace paragraph zero" }],
      requestId: "subtree-title-only",
      timeoutMs: 1000,
      replaceTarget: {
        scope: "subtree",
        title: "Before",
        subtreeEndRef: { paragraphIndex: 1, title: "Template root" },
        subtreeParagraphCount: 1,
      },
    });
    assert.equal(titleOnlyResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);

    const bodyTitleOnlyResult = await insertSolutionWritingWithConnector({
      text: "Must not replace body by title only",
      paragraphs: [{ type: "body", text: "Must not replace body by title only" }],
      requestId: "body-title-only",
      timeoutMs: 1000,
      replaceTarget: {
        title: "Header",
        bodyParagraphCount: 0,
      },
    });
    assert.equal(bodyTitleOnlyResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);

    const emptyTargetResult = await insertSolutionWritingWithConnector({
      text: "Must not fall back to the cursor",
      paragraphs: [{ type: "body", text: "Must not fall back to the cursor" }],
      requestId: "subtree-empty-target",
      timeoutMs: 1000,
      replaceTarget: {},
    });
    assert.equal(emptyTargetResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);

    const mismatchedTitleResult = await insertSolutionWritingWithConnector({
      text: "Must not use inconsistent target metadata",
      paragraphs: [{ type: "body", text: "Must not use inconsistent target metadata" }],
      requestId: "subtree-mismatched-title",
      timeoutMs: 1000,
      replaceTarget: { ...replaceTarget, title: "Different root" },
    });
    assert.equal(mismatchedTitleResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Header", "Before", "Template root", "Template child", "Old body", "Next chapter", "After", "Footnote"]);
    assert.ok(paragraphCacheClears > 0);
    assert.equal(numberedStyleApplications, 2);
  } finally {
    clearOnlyOfficeEditor(editor);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousApi === undefined) delete globalThis.Api;
    else globalThis.Api = previousApi;
  }
});

test("API origins are limited to the local web app and OnlyOffice", () => {
  const request = {
    headers: { host: "127.0.0.1:5173" },
    socket: { encrypted: false },
  };

  const allowedOrigins = readAllowedOrigins(["http://127.0.0.1:8080"], { production: false });
  assert.equal(isAllowedOrigin(request, "http://127.0.0.1:5173", allowedOrigins, { production: false }), true);
  assert.equal(isAllowedOrigin(request, "http://localhost:8080", allowedOrigins, { production: false }), true);
  assert.equal(isAllowedOrigin(request, "https://example.com", allowedOrigins, { production: false }), false);
  assert.equal(isAllowedOrigin(request, "http://127.0.0.1:8000", allowedOrigins, { production: false }), false);
});

test("model settings redact every configured API key", () => {
  const redacted = redactModelConfig({
    provider: "cloud",
    local: { baseUrl: "http://127.0.0.1:8129/v1", model: "local", apiKey: "local-secret" },
    cloud: { baseUrl: "https://example.com/v1", model: "cloud", apiKey: "cloud-secret" },
    embedding: { baseUrl: "http://127.0.0.1:8000/v1", model: "embedding", apiKey: "embedding-secret" },
  });

  assert.equal(redacted.local.apiKey, API_KEY_UNCHANGED);
  assert.equal(redacted.cloud.apiKey, API_KEY_UNCHANGED);
  assert.equal(redacted.embedding.apiKey, API_KEY_UNCHANGED);
  assert.equal(JSON.stringify(redacted).includes("secret"), false);
  assert.equal(resolveApiKeyUpdate(`${API_KEY_UNCHANGED}\nnew-key`, "old-key"), "new-key");
});

test("Office document identifiers and download origins fail closed", () => {
  const configured = new URL(process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080");
  const configuredPort = configured.port || (configured.protocol === "https:" ? "443" : "80");
  const allowedPort = configured.port ? `:${configured.port}` : "";
  const blockedPort = configuredPort === "65535" ? "65534" : String(Number(configuredPort) + 1);
  assert.doesNotThrow(() => assertOfficeDocumentId("123e4567-e89b-42d3-a456-426614174000"));
  assert.throws(() => assertOfficeDocumentId("..%2F..%2Ftarget"), /ID/);
  assert.equal(validateOnlyOfficeDocumentUrl(`${configured.protocol}//localhost${allowedPort}/cache/files/document.docx`).port || configuredPort, configuredPort);
  assert.throws(() => validateOnlyOfficeDocumentUrl(`${configured.protocol}//localhost:${blockedPort}/v1/models`), /不允许下载/);
  assert.throws(() => validateOnlyOfficeDocumentUrl("https://example.com/document.docx"), /不允许下载/);
});

test("Office document creation returns a usable local editor config", async () => {
  const request = Readable.from([await buildMinimalDocx()]);
  request.headers = {};
  const result = await createOfficeDocument(
    request,
    new URLSearchParams({ title: "regression.docx", previewId: "regression" }),
  );

  try {
    assert.doesNotThrow(() => assertOfficeDocumentId(result.id));
    assert.equal(result.serverUrl, process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080");
    assert.equal(result.config.document.title, "regression.docx");
    assert.match(result.config.document.url, new RegExp(`/api/v1/office/documents/${result.id}/file`));
    assert.match(result.config.token, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(typeof result.available, "boolean");
  } finally {
    await Promise.all([
      rm(path.join(tmpdir(), "guangfa-office-documents", `${result.id}.docx`), { force: true }),
      rm(path.join(tmpdir(), "guangfa-office-documents", `${result.id}.json`), { force: true }),
    ]);
  }
});

async function buildMinimalDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("invalid model JSON and incomplete fill contracts are rejected", () => {
  assert.deepEqual(parseModelJson('{"ok":true}'), { ok: true });
  assert.throws(() => parseModelJson("not-json"), /有效 JSON/);
  assert.throws(() => assertFillModelResult({}, "short"), /缺少字段/);
  assert.throws(() => assertFillModelResult({
    value: null,
    status: "待确认",
    confidence: null,
    source: null,
    evidence: null,
  }, "short"), /类型无效/);
  const validFillResult = {
    value: "示例值",
    status: "待确认",
    confidence: 90,
    source: "测试资料",
    evidence: "测试依据",
  };
  for (const confidence of [null, "", false, [], "90"]) {
    assert.throws(
      () => assertFillModelResult({ ...validFillResult, confidence }, "short"),
      /置信度无效/,
    );
  }
  for (const confidence of [0, 90, 100]) {
    assert.doesNotThrow(() => assertFillModelResult({ ...validFillResult, confidence }, "short"));
  }
});

test("fill model status aliases normalize to the persisted field contract", () => {
  const base = { value: "项目付款方式", confidence: 90, source: "资料", evidence: "资料依据" };
  assert.equal(normalizeFillModelResult({ ...base, status: "已确认" }).status, "待确认");
  assert.equal(normalizeFillModelResult({ ...base, value: "", status: "已确认" }).status, "需补充资料");
  assert.equal(normalizeFillModelResult({ ...base, status: "待确认或需补充资料" }).status, "待确认");
  assert.equal(normalizeFillModelResult({ ...base, value: "", status: "待确认或需补充资料" }).status, "需补充资料");
  assert.equal(normalizeFillModelResult({ ...base, status: "资料不足" }).status, "需补充资料");
  assert.equal(normalizeFillModelResult({ ...base, status: "自定义状态" }).status, "自定义状态");
});

import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { assertFillModelResult } from "../server/ai/fill.js";
import { parseModelJson } from "../server/ai/model.js";
import { assertOfficeDocumentId, createOfficeDocument, validateOnlyOfficeDocumentUrl } from "../server/office.js";
import { API_KEY_UNCHANGED, redactModelConfig, resolveApiKeyUpdate } from "../server/settings.js";
import { normalizeDraftFillState } from "../src/features/docx/fill/draftState.js";
import { clearOnlyOfficeEditor, registerOnlyOfficeEditor } from "../src/features/docx/office/connector.js";
import { insertSolutionWritingWithConnector } from "../src/features/docx/office/solutionConnector.js";
import { buildPlanningReplaceTarget, normalizePlanningSubtreeMetadata } from "../src/features/solution-writing/planningInsert.js";
import { normalizeWorkspaceSession } from "../src/services/workspaceSession.js";
import { isAllowedApiOrigin } from "../vite.config.js";

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

test("solution connector replaces only the selected template subtree", async () => {
  const previousWindow = globalThis.window;
  const previousApi = globalThis.Api;
  let documentApi;
  let addElementFailureAt = -1;
  let addElementCallCount = 0;
  let deleteFailureText = "";
  const createParagraph = (text = "") => {
    const paragraph = {
      text,
      AddText(value) {
        this.text += String(value || "");
      },
      Delete() {
        if (paragraph.text === deleteFailureText) return false;
        const index = documentApi.paragraphs.indexOf(paragraph);
        if (index < 0) return false;
        documentApi.paragraphs.splice(index, 1);
        return true;
      },
      GetParaPr() {
        return { GetStyle: () => null, SetStyle: () => true };
      },
      GetText() {
        return this.text;
      },
      private_GetImpl() {
        return { GetIndex: () => documentApi.paragraphs.indexOf(paragraph) };
      },
      SetStyle() {
        return true;
      },
    };
    return paragraph;
  };
  const resetDocument = () => {
    addElementCallCount = 0;
    documentApi = {
      paragraphs: ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"].map(createParagraph),
      AddElement(index, paragraph) {
        if (addElementCallCount === addElementFailureAt) {
          addElementCallCount += 1;
          return false;
        }
        addElementCallCount += 1;
        this.paragraphs.splice(index, 0, paragraph);
        return true;
      },
      GetAllParagraphs() {
        return [...this.paragraphs];
      },
      GetStyle() {
        return null;
      },
      InsertContent(content) {
        this.paragraphs.push(...content);
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
    title: "Template root",
    styleRef: { paragraphIndex: 1, title: "Template root" },
    subtreeEndRef: { paragraphIndex: 4, title: "Next chapter" },
    subtreeParagraphCount: 3,
  };

  try {
    const result = await insertSolutionWritingWithConnector({
      text: "New module\nNew planning body",
      paragraphs: [
        { type: "module-heading", text: "New module" },
        { type: "body", text: "New planning body" },
      ],
      requestId: "subtree-regression",
      timeoutMs: 1000,
      replaceTarget,
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "connector-replace-heading-subtree");
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "New module", "New planning body", "Next chapter", "After"]);

    resetDocument();
    const invalidResult = await insertSolutionWritingWithConnector({
      text: "Must not insert",
      paragraphs: [{ type: "body", text: "Must not insert" }],
      requestId: "subtree-invalid-boundary",
      timeoutMs: 1000,
      replaceTarget: { ...replaceTarget, subtreeEndRef: { paragraphIndex: 5, title: "Next chapter" } },
    });
    assert.equal(invalidResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);

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
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);
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
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);
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
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);

    const emptyTargetResult = await insertSolutionWritingWithConnector({
      text: "Must not fall back to the cursor",
      paragraphs: [{ type: "body", text: "Must not fall back to the cursor" }],
      requestId: "subtree-empty-target",
      timeoutMs: 1000,
      replaceTarget: {},
    });
    assert.equal(emptyTargetResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);

    const mismatchedTitleResult = await insertSolutionWritingWithConnector({
      text: "Must not use inconsistent target metadata",
      paragraphs: [{ type: "body", text: "Must not use inconsistent target metadata" }],
      requestId: "subtree-mismatched-title",
      timeoutMs: 1000,
      replaceTarget: { ...replaceTarget, title: "Different root" },
    });
    assert.equal(mismatchedTitleResult.ok, false);
    assert.deepEqual(documentApi.paragraphs.map((paragraph) => paragraph.text), ["Before", "Template root", "Template child", "Old body", "Next chapter", "After"]);
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

  assert.equal(isAllowedApiOrigin(request, "http://127.0.0.1:5173", "http://127.0.0.1:8080"), true);
  assert.equal(isAllowedApiOrigin(request, "http://localhost:8080", "http://127.0.0.1:8080"), true);
  assert.equal(isAllowedApiOrigin(request, "https://example.com", "http://127.0.0.1:8080"), false);
  assert.equal(isAllowedApiOrigin(request, "http://127.0.0.1:8000", "http://127.0.0.1:8080"), false);
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
  const request = Readable.from([Buffer.from("office-config-regression")]);
  const result = await createOfficeDocument(
    request,
    new URLSearchParams({ title: "regression.docx", previewId: "regression" }),
  );

  try {
    assert.doesNotThrow(() => assertOfficeDocumentId(result.id));
    assert.equal(result.serverUrl, process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080");
    assert.equal(result.config.document.title, "regression.docx");
    assert.match(result.config.document.url, new RegExp(`/api/office/documents/${result.id}/file`));
    assert.equal(typeof result.available, "boolean");
  } finally {
    await unlink(path.join(tmpdir(), "guangfa-office-documents", `${result.id}.docx`));
  }
});

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

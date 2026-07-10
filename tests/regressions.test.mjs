import assert from "node:assert/strict";
import test from "node:test";
import { assertFillModelResult } from "../server/ai/fill.js";
import { parseModelJson } from "../server/ai/model.js";
import { assertOfficeDocumentId, validateOnlyOfficeDocumentUrl } from "../server/office.js";
import { API_KEY_UNCHANGED, redactModelConfig, resolveApiKeyUpdate } from "../server/settings.js";
import { isAllowedApiOrigin } from "../vite.config.js";

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

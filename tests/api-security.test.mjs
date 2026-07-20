import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import JSZip from "jszip";
import { requestJsonEndpoint, validateAiEndpoint, validateAiProxyUrl } from "../server/ai/chat-completions.js";
import { inspectRasterImage, loadSafeDocx, validateKnowledgeDocument } from "../server/document-security.js";
import { convertDocxToPdf } from "../server/knowledge/docx-convert.js";
import {
  createOfficeDocument,
  handleOfficeCallback,
  readOfficeDocumentFile,
  signOnlyOfficeJwt,
  verifyOnlyOfficeJwt,
} from "../server/office.js";
import { API_KEY_UNCHANGED, resolveModelConfigUpdate } from "../server/settings.js";

test("cloud model endpoints reject SSRF targets while local runtimes stay loopback-only", () => {
  assert.throws(() => validateAiEndpoint("http://169.254.169.254/latest/meta-data"), /HTTPS|元数据|内网/);
  assert.throws(() => validateAiEndpoint("https://127.0.0.1/v1"), /内网|本机/);
  assert.throws(() => validateAiEndpoint("https://198.18.0.85/v1"), /内网|本机/);
  assert.throws(() => validateAiEndpoint("http://192.168.1.9/v1", { allowLocal: true }), /回环地址/);
  assert.equal(validateAiEndpoint("http://127.0.0.1:8129/v1", { allowLocal: true }).hostname, "127.0.0.1");
  assert.equal(validateAiEndpoint("https://api.example.test/v1").protocol, "https:");
});

test("AI proxy URLs accept only origin-only HTTP(S) addresses", () => {
  assert.equal(validateAiProxyUrl("http://127.0.0.1:7890").href, "http://127.0.0.1:7890/");
  assert.equal(validateAiProxyUrl("https://proxy.example.test:8443").port, "8443");
  assert.equal(validateAiProxyUrl("off"), null);
  for (const value of [
    "",
    "socks5://127.0.0.1:7890",
    "http://user:password@127.0.0.1:7890",
    "http://127.0.0.1:7890/path",
    "http://127.0.0.1:7890/?bypass=false",
    "http://127.0.0.1:7890/#fragment",
    "http://127.0.0.1:70000",
  ]) {
    assert.throws(() => validateAiProxyUrl(value), /AI 代理地址/);
  }
});

test("HTTPS proxy tunneling sends CONNECT without resolving the target locally", async (context) => {
  const authorities = [];
  const proxy = createServer();
  proxy.on("connect", (request, socket) => {
    authorities.push(request.url);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())));

  const { port } = proxy.address();
  await assert.rejects(
    requestJsonEndpoint("https://target-that-does-not-resolve.invalid/v1", {
      proxyUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 2000,
    }),
  );
  assert.deepEqual(authorities, ["target-that-does-not-resolve.invalid:443"]);
});

test("direct Fake-IP model targets remain blocked when proxying is disabled", async () => {
  await assert.rejects(
    requestJsonEndpoint("https://198.18.0.85/v1", { proxyUrl: "off" }),
    (error) => error?.code === "EENDPOINTPOLICY" && error.statusCode === 400,
  );
});

test("changing a model Base URL never carries a masked saved API key to the new host", async () => {
  const uniqueHost = `https://model-${Date.now()}.example.test/v1`;
  const config = await resolveModelConfigUpdate({
    provider: "cloud",
    cloud: { baseUrl: uniqueHost, model: "test-model", apiKey: API_KEY_UNCHANGED },
  });
  assert.equal(config.cloud.baseUrl, uniqueHost);
  assert.equal(config.cloud.apiKey, "");
});

test("document inspection rejects active SVG and bounded DOCX expansion", async () => {
  assert.throws(
    () => inspectRasterImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image.svg"),
    /SVG/,
  );
  await assert.rejects(
    validateKnowledgeDocument(Buffer.from("not a document"), { fileName: "payload.exe" }),
    (error) => error.statusCode === 415,
  );

  const docx = await buildMinimalDocx("a".repeat(4096));
  await assert.rejects(
    loadSafeDocx(docx, { maxUncompressedBytes: 1024 }),
    (error) => error.statusCode === 413,
  );
});

test("OnlyOffice callbacks require a signed matching payload and are idempotent", async () => {
  const previousSecret = process.env.ONLYOFFICE_JWT_SECRET;
  const secret = "onlyoffice-test-secret-that-is-longer-than-32-bytes";
  process.env.ONLYOFFICE_JWT_SECRET = secret;
  const request = Readable.from([await buildMinimalDocx("callback")]);
  request.headers = {};
  const created = await createOfficeDocument(request, new URLSearchParams({ title: "callback.docx" }));
  const body = { key: created.config.document.key, status: 4 };
  const token = signOnlyOfficeJwt({ payload: body }, 300, secret);

  try {
    assert.equal(verifyOnlyOfficeJwt(token, secret).payload.key, body.key);
    assert.deepEqual(await handleOfficeCallback(created.id, body, token), { error: 0 });
    assert.deepEqual(await handleOfficeCallback(created.id, body, token), { error: 0 });
    await assert.rejects(
      handleOfficeCallback(created.id, { ...body, key: "wrong-key" }, token),
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      handleOfficeCallback(created.id, body, `${token.slice(0, -1)}x`),
      (error) => error.statusCode === 403,
    );
  } finally {
    if (previousSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousSecret;
    const base = path.join(tmpdir(), "guangfa-office-documents", created.id);
    await Promise.all([rm(`${base}.docx`, { force: true }), rm(`${base}.json`, { force: true })]);
  }
});

test("OnlyOffice callbacks reject an older save queued behind a newer save", async () => {
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.ONLYOFFICE_JWT_SECRET;
  const secret = "onlyoffice-order-test-secret-longer-than-32-bytes";
  process.env.ONLYOFFICE_JWT_SECRET = secret;
  const request = Readable.from([await buildMinimalDocx("initial")]);
  request.headers = {};
  const created = await createOfficeDocument(request, new URLSearchParams({ title: "ordered-callback.docx" }));
  const newerDocument = await buildMinimalDocx("newer-save");
  const olderDocument = await buildMinimalDocx("older-save");
  const newerBody = {
    key: created.config.document.key,
    status: 2,
    url: "http://127.0.0.1:8080/newer-save.docx",
  };
  const olderBody = {
    key: created.config.document.key,
    status: 6,
    url: "http://127.0.0.1:8080/older-save.docx",
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  const newerToken = signTestJwtAt({ payload: newerBody }, secret, issuedAt);
  const olderToken = signTestJwtAt({ payload: olderBody }, secret, issuedAt - 1);
  let releaseNewerFetch;
  let markNewerFetchStarted;
  const newerFetchStarted = new Promise((resolve) => { markNewerFetchStarted = resolve; });
  const newerFetchGate = new Promise((resolve) => { releaseNewerFetch = resolve; });
  let olderFetchCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === newerBody.url) {
      markNewerFetchStarted();
      await newerFetchGate;
      return new Response(newerDocument, { status: 200 });
    }
    if (String(url) === olderBody.url) {
      olderFetchCount += 1;
      return new Response(olderDocument, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const newerSave = handleOfficeCallback(created.id, newerBody, newerToken);
    await newerFetchStarted;
    const olderSave = handleOfficeCallback(created.id, olderBody, olderToken);
    const olderRejection = assert.rejects(olderSave, (error) => error.statusCode === 409);
    releaseNewerFetch();
    await newerSave;
    await olderRejection;
    const saved = await readOfficeDocumentFile(created.id, {
      principal: { id: "admin", roles: ["admin"], authentication: "bearer" },
    });
    assert.equal(Buffer.compare(saved.buffer, newerDocument), 0);
    assert.equal(olderFetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousSecret;
    const base = path.join(tmpdir(), "guangfa-office-documents", created.id);
    await Promise.all([rm(`${base}.docx`, { force: true }), rm(`${base}.json`, { force: true })]);
  }
});

test("Office documents are limited to their owner, administrators and the exact Document Server token", async () => {
  const previousSecret = process.env.ONLYOFFICE_JWT_SECRET;
  const previousLocalAiKey = process.env.LOCAL_LLM_API_KEY;
  const previousLocalAiModel = process.env.LOCAL_LLM_MODEL;
  const previousOnlyOfficeAiKey = process.env.ONLYOFFICE_AI_CLIENT_API_KEY;
  process.env.ONLYOFFICE_JWT_SECRET = "onlyoffice-owner-test-secret-longer-than-32-bytes";
  process.env.LOCAL_LLM_API_KEY = "sensitive-server-model-key";
  process.env.LOCAL_LLM_MODEL = "runtime-updated-model";
  process.env.ONLYOFFICE_AI_CLIENT_API_KEY = "public-local-placeholder";
  const request = Readable.from([await buildMinimalDocx("owner")]);
  request.headers = {};
  const owner = { id: "owner-user", roles: ["editor"], authentication: "bearer" };
  const created = await createOfficeDocument(request, new URLSearchParams({ title: "owner.docx" }), owner);

  try {
    const aiSettings = JSON.parse(created.config.editorConfig.aiPluginSettings);
    assert.equal(aiSettings.providers.OpenAI.key, "public-local-placeholder");
    assert.equal(aiSettings.models[0].id, "runtime-updated-model");
    assert.equal(JSON.stringify(created.config).includes("sensitive-server-model-key"), false);
    assert.ok((await readOfficeDocumentFile(created.id, { principal: owner })).buffer.length > 0);
    await assert.rejects(
      readOfficeDocumentFile(created.id, {
        principal: { id: "other-user", roles: ["editor"], authentication: "bearer" },
      }),
      (error) => error.statusCode === 403,
    );
    assert.ok((await readOfficeDocumentFile(created.id, {
      principal: { id: "admin-user", roles: ["admin"], authentication: "bearer" },
    })).buffer.length > 0);

    const signedQuery = new URL(created.config.document.url).searchParams;
    assert.ok((await readOfficeDocumentFile(created.id, {
      principal: { id: "anonymous", roles: [], authentication: "anonymous" },
      query: signedQuery,
    })).buffer.length > 0);
  } finally {
    if (previousSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousSecret;
    if (previousLocalAiKey == null) delete process.env.LOCAL_LLM_API_KEY;
    else process.env.LOCAL_LLM_API_KEY = previousLocalAiKey;
    if (previousLocalAiModel == null) delete process.env.LOCAL_LLM_MODEL;
    else process.env.LOCAL_LLM_MODEL = previousLocalAiModel;
    if (previousOnlyOfficeAiKey == null) delete process.env.ONLYOFFICE_AI_CLIENT_API_KEY;
    else process.env.ONLYOFFICE_AI_CLIENT_API_KEY = previousOnlyOfficeAiKey;
    const base = path.join(tmpdir(), "guangfa-office-documents", created.id);
    await Promise.all([rm(`${base}.docx`, { force: true }), rm(`${base}.json`, { force: true })]);
  }
});

test("OnlyOffice JWT rejects weak production secrets at the signing boundary", () => {
  const previousMode = process.env.API_DEPLOYMENT_MODE;
  const previousSecret = process.env.ONLYOFFICE_JWT_SECRET;
  process.env.API_DEPLOYMENT_MODE = "production";
  process.env.ONLYOFFICE_JWT_SECRET = "short";
  try {
    assert.throws(() => signOnlyOfficeJwt({ scope: "test" }), /至少需要 32 字节/);
  } finally {
    if (previousMode == null) delete process.env.API_DEPLOYMENT_MODE;
    else process.env.API_DEPLOYMENT_MODE = previousMode;
    if (previousSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousSecret;
  }
});

test("OnlyOffice conversion commands carry a signed inbox JWT", async () => {
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.ONLYOFFICE_JWT_SECRET;
  const secret = "onlyoffice-conversion-test-secret-longer-than-32-bytes";
  const outputPath = path.join(tmpdir(), `guangfa-conversion-${Date.now()}.pdf`);
  process.env.ONLYOFFICE_JWT_SECRET = secret;
  let conversionChecked = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/ConvertService.ashx")) {
      const { token, ...command } = JSON.parse(options.body);
      const claims = verifyOnlyOfficeJwt(token, secret);
      assert.equal(claims.key, command.key);
      assert.equal(claims.url, command.url);
      assert.match(command.url, /accessToken=/);
      conversionChecked = true;
      return new Response(JSON.stringify({ fileUrl: "http://onlyoffice.test/result.pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    assert.equal(String(url), "http://onlyoffice.test/result.pdf");
    return new Response(Buffer.from("%PDF-1.7\n"), { status: 200 });
  };

  try {
    const result = await convertDocxToPdf({
      documentId: "DOC-conversion-test",
      sourcePath: "conversion.docx",
      outputPath,
      title: "conversion.docx",
    });
    assert.equal(result.ok, true);
    assert.equal(conversionChecked, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret == null) delete process.env.ONLYOFFICE_JWT_SECRET;
    else process.env.ONLYOFFICE_JWT_SECRET = previousSecret;
    await rm(outputPath, { force: true });
  }
});

async function buildMinimalDocx(text = "") {
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
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function signTestJwtAt(payload, secret, issuedAt) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ ...payload, iat: issuedAt, exp: issuedAt + 300 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

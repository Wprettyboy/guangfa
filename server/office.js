import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DOCX_MIME, loadSafeDocx } from "./document-security.js";

const officeDocsDir = path.join(tmpdir(), "guangfa-office-documents");
const publicBaseUrl = process.env.OFFICE_PUBLIC_BASE_URL || "http://host.docker.internal:5173";
const maxOfficeDocumentBytes = 120 * 1024 * 1024;
const onlyOfficeFetchTimeoutMs = 20000;
const officeDocumentTtlMs = clampNumber(Number(process.env.OFFICE_DOCUMENT_TTL_MS || 24 * 60 * 60 * 1000), 15 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
const officeAccessTokenTtlSeconds = clampNumber(Number(process.env.OFFICE_ACCESS_TOKEN_TTL_SECONDS || 1800), 60, 3600);
const officeConfigTokenTtlSeconds = clampNumber(Number(process.env.OFFICE_CONFIG_TOKEN_TTL_SECONDS || 600), 60, 3600);
const officeCallbackMaxAgeMs = clampNumber(Number(process.env.OFFICE_CALLBACK_MAX_AGE_MS || 10 * 60 * 1000), 60000, 60 * 60 * 1000);
const maxOfficeDocuments = clampNumber(Number(process.env.OFFICE_MAX_DOCUMENTS || 200), 10, 2000);
const onlyOfficeLocalHosts = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);
const onlyOfficeCallbackStatuses = new Set([1, 2, 3, 4, 6, 7]);
const callbackOperations = new Map();
const completedCallbackTokens = new Map();
const documentCallbackQueues = new Map();
const developmentJwtSecret = randomBytes(32).toString("base64url");
let cleanupTimer = null;

async function getOfficeHealth() {
  const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
  return {
    serverUrl: onlyOfficeServerUrl,
    publicBaseUrl,
    available: await isOnlyOfficeAvailable(),
  };
}

async function createOfficeDocument(request, query, principal) {
  const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
  await mkdir(officeDocsDir, { recursive: true });
  await cleanupOfficeDocuments();
  scheduleOfficeCleanup();
  const id = randomUUID();
  const title = sanitizeFileName(query.get("title") || "document.docx");
  const previewId = query.get("previewId") || "";
  const filePath = getOfficeDocPath(id);
  try {
    await writeRequestBody(request, filePath);
    const [fileStat, fileBuffer] = await Promise.all([stat(filePath), readFile(filePath)]);
    await loadSafeDocx(fileBuffer, { maxArchiveBytes: maxOfficeDocumentBytes });
    const sha = createHash("sha256").update(fileBuffer).digest("hex").slice(0, 12);
    const key = createOfficeDocumentKey({ id, fileStat, previewId, sha });
    const now = Date.now();
    await writeOfficeDocumentMetadata({
      id,
      key,
      title,
      createdAt: now,
      expiresAt: now + officeDocumentTtlMs,
      lastCallbackAt: 0,
      lastCallbackIssuedAt: 0,
      lastStatus: 0,
      ownerId: normalizeOfficeOwnerId(principal),
    });
    console.log(`[office-doc] post id=${id} previewId=${previewId || "-"} title=${title} bytes=${fileStat.size} sha=${sha}`);
    return {
      id,
      config: buildOnlyOfficeConfig({ id, title, key }),
      serverUrl: onlyOfficeServerUrl,
      available: await isOnlyOfficeAvailable(),
    };
  } catch (error) {
    await removeOfficeDocument(id);
    throw error;
  }
}

async function downloadOfficeUrl(body) {
  const buffer = await fetchOnlyOfficeDocument(body?.url);
  return {
    kind: "buffer",
    buffer,
    contentType: DOCX_MIME,
    headers: { "Cache-Control": "no-store" },
  };
}

async function readOfficeDocumentFile(id, accessContext) {
  const metadata = await readActiveOfficeDocumentMetadata(id);
  const principal = accessContext?.principal;
  if (principal && principal.authentication !== "anonymous" && principal.authentication !== "public") {
    const admin = principal.roles?.includes("admin");
    if (!admin && (!metadata.ownerId || metadata.ownerId !== principal.id)) {
      throw createHttpError("当前身份无权读取该 Office 文档", 403);
    }
  } else {
    const accessToken = readAccessToken(accessContext);
    const claims = verifyOnlyOfficeJwt(accessToken, getOnlyOfficeJwtSecret());
    if (claims.scope !== "office-file" || claims.documentId !== id || claims.key !== metadata.key) {
      throw createHttpError("Office 文档访问令牌无效", 403);
    }
  }
  return {
    kind: "buffer",
    buffer: await readFile(getOfficeDocPath(id)),
    contentType: DOCX_MIME,
    headers: { "Cache-Control": "no-store" },
  };
}

async function handleOfficeCallback(id, body, requestOrToken) {
  assertOfficeDocumentId(id);
  const initialMetadata = await readActiveOfficeDocumentMetadata(id);
  const status = body?.status;
  if (!Number.isInteger(status) || !onlyOfficeCallbackStatuses.has(status)) {
    throw createHttpError("OnlyOffice callback status 无效", 400);
  }
  if (body?.key !== initialMetadata.key) throw createHttpError("OnlyOffice callback 文档键不匹配", 403);

  const token = readCallbackToken(body, requestOrToken);
  if (!token && !hasConfiguredOnlyOfficeJwtSecret() && !isProductionRuntime()) {
    return queueOfficeCallback(id, async () => {
      const metadata = await readActiveOfficeDocumentMetadata(id);
      if (body.key !== metadata.key) throw createHttpError("OnlyOffice callback 文档键不匹配", 403);
      return applyOfficeCallback(id, body, metadata);
    });
  }
  const claims = verifyOnlyOfficeJwt(token, getOnlyOfficeJwtSecret());
  validateOfficeCallbackClaims(claims, body, initialMetadata);
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  pruneCompletedCallbacks();
  if (completedCallbackTokens.has(tokenDigest)) return { error: 0 };
  if (callbackOperations.has(tokenDigest)) return callbackOperations.get(tokenDigest);

  const operation = queueOfficeCallback(id, async () => {
    const metadata = await readActiveOfficeDocumentMetadata(id);
    if (body.key !== metadata.key) throw createHttpError("OnlyOffice callback 文档键不匹配", 403);
    const issuedAt = validateOfficeCallbackClaims(claims, body, metadata);
    return applyOfficeCallback(id, body, metadata, issuedAt);
  })
    .then((result) => {
      completedCallbackTokens.set(tokenDigest, Date.now());
      return result;
    })
    .finally(() => {
      callbackOperations.delete(tokenDigest);
    });
  callbackOperations.set(tokenDigest, operation);
  return operation;
}

function queueOfficeCallback(id, callback) {
  const previous = documentCallbackQueues.get(id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(callback).finally(() => {
    if (documentCallbackQueues.get(id) === operation) documentCallbackQueues.delete(id);
  });
  documentCallbackQueues.set(id, operation);
  return operation;
}

async function applyOfficeCallback(id, body, metadata, issuedAt = 0) {
  const status = body.status;
  if (status === 2 || status === 6) {
    if (!body?.url) throw createHttpError("OnlyOffice callback 缺少文档地址", 400);
    const buffer = await fetchOnlyOfficeDocument(body.url);
    await loadSafeDocx(buffer, { maxArchiveBytes: maxOfficeDocumentBytes });
    const nextPath = `${getOfficeDocPath(id)}.next`;
    await writeFile(nextPath, buffer);
    await rename(nextPath, getOfficeDocPath(id));
    const sha = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    console.log(`[office-doc] callback id=${id} status=${status} bytes=${buffer.byteLength} sha=${sha}`);
  }
  await writeOfficeDocumentMetadata({
    ...metadata,
    lastCallbackAt: Date.now(),
    lastCallbackIssuedAt: issuedAt || Number(metadata.lastCallbackIssuedAt) || 0,
    lastStatus: status,
  });
  return { error: 0 };
}

function buildOnlyOfficeConfig({ id, title, key }) {
  const accessToken = signOnlyOfficeJwt({ scope: "office-file", documentId: id, key }, officeAccessTokenTtlSeconds);
  const fileUrl = `${publicBaseUrl}/api/v1/office/documents/${id}/file?accessToken=${encodeURIComponent(accessToken)}`;
  const config = {
    documentType: "word",
    type: "desktop",
    document: {
      fileType: "docx",
      key,
      title,
      url: fileUrl,
      permissions: {
        edit: true,
        review: true,
        download: true,
        print: true,
      },
    },
    editorConfig: {
      mode: "edit",
      lang: "zh-CN",
      callbackUrl: `${publicBaseUrl}/api/v1/office/callback/${id}`,
      aiPluginSettings: JSON.stringify(buildOnlyOfficeAiPluginSettings()),
      customization: {
        about: false,
        logo: { visible: false },
        customer: { name: "" },
        compactHeader: false,
        compactToolbar: false,
        toolbar: true,
        leftMenu: true,
        rightMenu: true,
        statusBar: true,
        layout: {
          toolbar: true,
          leftMenu: true,
          rightMenu: true,
          statusBar: true,
        },
        hideRightMenu: false,
        loaderName: "",
        loaderLogo: "",
        autosave: false,
      },
    },
  };
  return { ...config, token: signOnlyOfficeJwt(config, officeConfigTokenTtlSeconds) };
}

function buildOnlyOfficeAiPluginSettings() {
  const localAiBaseUrl = toOnlyOfficeReachableUrl(process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8129/v1");
  const localAiModel = process.env.LOCAL_LLM_MODEL || "qwen3.6-35b-a3b";
  const providerUrl = localAiBaseUrl.replace(/\/v1\/?$/i, "");
  const clientApiKey = process.env.ONLYOFFICE_AI_CLIENT_API_KEY || "sk-local";
  return {
    version: 4,
    providers: {
      OpenAI: {
        name: "OpenAI",
        url: providerUrl,
        key: clientApiKey,
        models: [
          {
            id: localAiModel,
            name: localAiModel,
            endpoints: [1],
            options: { max_input_tokens: 128000 },
          },
        ],
      },
    },
    models: [
      {
        name: `Local Qwen [${localAiModel}]`,
        id: localAiModel,
        provider: "OpenAI",
        capabilities: 1,
      },
    ],
    actions: {
      Chat: { model: localAiModel },
      Summarization: { model: localAiModel },
      Translation: { model: localAiModel },
      TextAnalyze: { model: localAiModel },
    },
    customProviders: {},
  };
}

function toOnlyOfficeReachableUrl(url) {
  return String(url || "").replace(/^http:\/\/(?:127\.0\.0\.1|localhost)(:\d+)/i, "http://host.docker.internal$1");
}

async function isOnlyOfficeAvailable() {
  try {
    const onlyOfficeServerUrl = getOnlyOfficeServerUrl();
    const response = await fetch(`${onlyOfficeServerUrl.replace(/\/$/, "")}/healthcheck`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

function getOnlyOfficeServerUrl() {
  return process.env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";
}

function getOfficeDocPath(id) {
  assertOfficeDocumentId(id);
  return path.join(officeDocsDir, `${id}.docx`);
}

function getOfficeMetadataPath(id) {
  assertOfficeDocumentId(id);
  return path.join(officeDocsDir, `${id}.json`);
}

function createOfficeDocumentKey({ id, fileStat, previewId, sha }) {
  return createHash("sha256")
    .update(`${id}:${Math.round(fileStat.mtimeMs)}:${previewId || "-"}:${sha || "-"}`)
    .digest("base64url")
    .slice(0, 48);
}

async function readActiveOfficeDocumentMetadata(id) {
  assertOfficeDocumentId(id);
  let metadata;
  try {
    metadata = JSON.parse(await readFile(getOfficeMetadataPath(id), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) throw createHttpError("Office 文档不存在或会话已失效", 404);
    throw error;
  }
  if (metadata.id !== id || !metadata.key || !Number.isFinite(Number(metadata.expiresAt))) {
    throw createHttpError("Office 文档会话元数据无效", 500);
  }
  if (Number(metadata.expiresAt) <= Date.now()) {
    await removeOfficeDocument(id);
    throw createHttpError("Office 文档会话已过期", 410);
  }
  return metadata;
}

async function writeOfficeDocumentMetadata(metadata) {
  const filePath = getOfficeMetadataPath(metadata.id);
  const temporaryPath = `${filePath}.next`;
  await writeFile(temporaryPath, JSON.stringify(metadata), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function removeOfficeDocument(id) {
  await Promise.all([
    rm(getOfficeDocPath(id), { force: true }),
    rm(getOfficeMetadataPath(id), { force: true }),
    rm(`${getOfficeDocPath(id)}.next`, { force: true }),
    rm(`${getOfficeMetadataPath(id)}.next`, { force: true }),
  ]);
}

async function cleanupOfficeDocuments() {
  await mkdir(officeDocsDir, { recursive: true });
  const names = await readdir(officeDocsDir);
  const ids = [...new Set(names.map((name) => name.match(/^([0-9a-f-]{36})\.(?:docx|json)(?:\.next)?$/i)?.[1]).filter(Boolean))];
  const sessions = [];
  for (const id of ids) {
    try {
      assertOfficeDocumentId(id);
      const [metadata, fileStat] = await Promise.all([
        readFile(getOfficeMetadataPath(id), "utf8").then(JSON.parse).catch(() => null),
        stat(getOfficeDocPath(id)).catch(() => null),
      ]);
      const expiresAt = Number(metadata?.expiresAt || (fileStat?.mtimeMs || 0) + officeDocumentTtlMs);
      sessions.push({ id, expiresAt, createdAt: Number(metadata?.createdAt || fileStat?.mtimeMs || 0) });
    } catch {
      await removeOfficeDocument(id).catch(() => {});
    }
  }
  const expired = sessions.filter((session) => !session.expiresAt || session.expiresAt <= Date.now());
  await Promise.all(expired.map((session) => removeOfficeDocument(session.id).catch(() => {})));
  const active = sessions.filter((session) => session.expiresAt > Date.now()).sort((left, right) => right.createdAt - left.createdAt);
  await Promise.all(active.slice(maxOfficeDocuments).map((session) => removeOfficeDocument(session.id).catch(() => {})));
}

function scheduleOfficeCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => cleanupOfficeDocuments().catch((error) => {
    console.warn("[office-doc] cleanup failed:", error?.message || error);
  }), Math.min(officeDocumentTtlMs, 30 * 60 * 1000));
  cleanupTimer.unref?.();
}

function assertOfficeDocumentId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""))) {
    throw createHttpError("Office 文档 ID 无效", 400);
  }
}

function signOnlyOfficeJwt(payload, expiresInSeconds = officeConfigTokenTtlSeconds, secret = getOnlyOfficeJwtSecret()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw createHttpError("OnlyOffice JWT payload 无效", 500);
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const body = encodeJwtPart({ ...payload, iat: now, exp: now + expiresInSeconds });
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyOnlyOfficeJwt(token, secret = getOnlyOfficeJwtSecret()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw createHttpError("OnlyOffice JWT 缺失或格式无效", 403);
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw createHttpError("OnlyOffice JWT 格式无效", 403);
  }
  if (header?.alg !== "HS256" || header?.typ && header.typ !== "JWT" || !claims || typeof claims !== "object") {
    throw createHttpError("OnlyOffice JWT 算法或载荷无效", 403);
  }
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], "base64url");
  } catch {
    throw createHttpError("OnlyOffice JWT 签名无效", 403);
  }
  if (
    actual.length !== expected.length
    || actual.toString("base64url") !== parts[2]
    || !timingSafeEqual(actual, expected)
  ) {
    throw createHttpError("OnlyOffice JWT 签名无效", 403);
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(Number(claims.nbf)) && now + 60 < Number(claims.nbf)) throw createHttpError("OnlyOffice JWT 尚未生效", 403);
  if (!Number.isFinite(Number(claims.exp)) || now - 60 >= Number(claims.exp)) throw createHttpError("OnlyOffice JWT 已过期", 403);
  if (Number.isFinite(Number(claims.iat)) && Number(claims.iat) > now + 60) throw createHttpError("OnlyOffice JWT 签发时间无效", 403);
  return claims;
}

function validateOfficeCallbackClaims(claims, body, metadata) {
  const payload = readCallbackClaimsPayload(claims);
  const issuedAt = Number(claims.iat || payload.iat);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt * 1000 > officeCallbackMaxAgeMs || issuedAt * 1000 > Date.now() + 60000) {
    throw createHttpError("OnlyOffice callback JWT 已陈旧", 403);
  }
  if (Number(metadata.lastCallbackIssuedAt) && issuedAt < Number(metadata.lastCallbackIssuedAt)) {
    throw createHttpError("OnlyOffice callback 顺序已失效", 409);
  }
  if (payload.key !== metadata.key || payload.key !== body.key || Number(payload.status) !== body.status) {
    throw createHttpError("OnlyOffice callback JWT 与请求内容不一致", 403);
  }
  if ((body.status === 2 || body.status === 6) && payload.url !== body.url) {
    throw createHttpError("OnlyOffice callback JWT 文档地址不匹配", 403);
  }
  return issuedAt;
}

function readCallbackClaimsPayload(claims) {
  if (claims?.payload && typeof claims.payload === "object" && !Array.isArray(claims.payload)) return claims.payload;
  if (typeof claims?.payload === "string") {
    try {
      const value = JSON.parse(claims.payload);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
  }
  return claims;
}

function readCallbackToken(body, requestOrToken) {
  if (body?.token) return String(body.token);
  if (typeof requestOrToken === "string") return stripBearerPrefix(requestOrToken);
  const headerName = String(process.env.ONLYOFFICE_JWT_HEADER || "Authorization").toLowerCase();
  const value = requestOrToken?.headers?.[headerName];
  return stripBearerPrefix(Array.isArray(value) ? value[0] : value);
}

function readAccessToken(accessContext) {
  if (!accessContext) return "";
  if (typeof accessContext === "string") {
    if (accessContext.includes(".") && !accessContext.includes("/")) return stripBearerPrefix(accessContext);
    try {
      return new URL(accessContext, "http://localhost").searchParams.get("accessToken") || "";
    } catch {
      return "";
    }
  }
  if (typeof accessContext.get === "function") return accessContext.get("accessToken") || "";
  if (accessContext.query) return readAccessToken(accessContext.query);
  if (accessContext.accessToken) return String(accessContext.accessToken);
  if (accessContext.url) return readAccessToken(accessContext.url);
  return "";
}

function normalizeOfficeOwnerId(principal) {
  const value = String(principal?.id || "local-development").trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._@:+|=-]{0,127}$/u.test(value) || Buffer.byteLength(value, "utf8") > 256) {
    throw createHttpError("Office 文档所有者身份无效", 400);
  }
  return value;
}

function stripBearerPrefix(value) {
  return String(value || "").replace(/^Bearer\s+/i, "").trim();
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function getOnlyOfficeJwtSecret() {
  const configured = readConfiguredOnlyOfficeJwtSecret();
  if (configured) {
    if (isProductionRuntime() && Buffer.byteLength(configured, "utf8") < 32) {
      throw createHttpError("ONLYOFFICE_JWT_SECRET 至少需要 32 字节", 500);
    }
    return configured;
  }
  if (isProductionRuntime()) throw createHttpError("生产环境必须配置 ONLYOFFICE_JWT_SECRET", 500);
  return developmentJwtSecret;
}

function hasConfiguredOnlyOfficeJwtSecret() {
  return Boolean(readConfiguredOnlyOfficeJwtSecret());
}

function readConfiguredOnlyOfficeJwtSecret() {
  const direct = String(process.env.ONLYOFFICE_JWT_SECRET || "").trim();
  if (direct) return direct;
  try {
    const raw = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const match = raw.match(/^ONLYOFFICE_JWT_SECRET=(.*)$/m);
    if (!match) return "";
    const value = match[1].trim();
    if (!value) return "";
    if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
    return value;
  } catch {
    return "";
  }
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.API_DEPLOYMENT_MODE === "production";
}

function pruneCompletedCallbacks() {
  const cutoff = Date.now() - officeCallbackMaxAgeMs;
  completedCallbackTokens.forEach((completedAt, digest) => {
    if (completedAt < cutoff) completedCallbackTokens.delete(digest);
  });
}

async function fetchOnlyOfficeDocument(value) {
  const target = validateOnlyOfficeDocumentUrl(value);
  try {
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(onlyOfficeFetchTimeoutMs),
    });
    if (!response.ok) {
      throw createHttpError(`OnlyOffice 文档下载失败：HTTP ${response.status}`, 502);
    }
    const buffer = await readLimitedResponseBody(response, maxOfficeDocumentBytes);
    if (!buffer.length) throw createHttpError("OnlyOffice 返回了空文档", 502);
    return buffer;
  } catch (error) {
    if (error?.statusCode) throw error;
    const suffix = ["AbortError", "TimeoutError"].includes(error?.name) ? "请求超时" : "连接失败";
    throw createHttpError(`OnlyOffice 文档下载${suffix}`, 502);
  }
}

function validateOnlyOfficeDocumentUrl(value) {
  const target = parseHttpUrl(value, "OnlyOffice 文档地址无效", 400);
  const configured = parseHttpUrl(getOnlyOfficeServerUrl(), "OnlyOffice 服务地址配置无效", 500);
  if (!onlyOfficeLocalHosts.has(normalizeHostname(configured.hostname))) {
    throw createHttpError("OnlyOffice 服务地址必须使用本地地址", 500);
  }
  if (
    !onlyOfficeLocalHosts.has(normalizeHostname(target.hostname))
    || target.protocol !== configured.protocol
    || getEffectivePort(target) !== getEffectivePort(configured)
    || target.hash
  ) {
    throw createHttpError("不允许下载该地址", 400);
  }
  return target;
}

function parseHttpUrl(value, message, statusCode) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url;
  } catch {
    throw createHttpError(message, statusCode);
  }
}

function normalizeHostname(value) {
  return String(value || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function getEffectivePort(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

async function readLimitedResponseBody(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpError("OnlyOffice 返回的文档过大", 502);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw createHttpError("OnlyOffice 返回的文档过大", 502);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeFileName(value) {
  const safe = String(value || "document.docx").replace(/[\\/:*?"<>|]/g, "_").trim();
  return /\.docx$/i.test(safe) ? safe : `${safe || "document"}.docx`;
}

function writeRequestBody(request, filePath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const stream = createWriteStream(filePath);
    const contentLength = Number(request.headers?.["content-length"]);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      request.unpipe(stream);
      stream.destroy();
      request.resume?.();
      reject(error);
    };
    if (Number.isFinite(contentLength) && contentLength > maxOfficeDocumentBytes) {
      const error = new Error("DOCX 文件过大");
      error.statusCode = 413;
      fail(error);
      return;
    }
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxOfficeDocumentBytes) {
        const error = new Error("DOCX 文件过大");
        error.statusCode = 413;
        fail(error);
      }
    });
    request.pipe(stream);
    stream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    stream.on("error", fail);
    request.on("aborted", () => fail(createHttpError("DOCX 上传已中断", 400)));
    request.on("error", fail);
  });
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export {
  assertOfficeDocumentId,
  createOfficeDocument,
  downloadOfficeUrl,
  getOfficeHealth,
  handleOfficeCallback,
  readOfficeDocumentFile,
  signOnlyOfficeJwt,
  validateOnlyOfficeDocumentUrl,
  verifyOnlyOfficeJwt,
};

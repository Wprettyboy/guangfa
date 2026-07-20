import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import tls from "node:tls";

const retryableKeyStatuses = new Set([401, 403, 429, 500, 502, 503, 504]);
const rotationState = new Map();
const blockedAddresses = buildBlockedAddressList();
const blockedCloudHostnames = new Set([
  "host.docker.internal",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata",
  "metadata.google.internal",
]);

async function requestChatCompletion(runtime, payload, options = {}) {
  const baseUrl = String(runtime?.baseUrl || "").trim();
  const model = String(runtime?.model || "").trim();
  const isLocal = isLocalEndpoint(baseUrl);
  const apiKeys = splitApiKeys(runtime?.apiKey);
  const timeoutMs = clampNumber(Number(runtime?.timeoutMs || (isLocal ? 10 * 60 * 1000 : 2 * 60 * 1000)), 1000, 10 * 60 * 1000);
  const allowLocal = options.allowLocal ?? (process.env.AI_PROVIDER !== "cloud" && isLocal);

  if (!apiKeys.length && !isLocal) {
    const error = new Error("缺少 AI API Key，请在系统设置中配置当前模型的 API Key。");
    error.statusCode = 500;
    throw error;
  }

  const keys = apiKeys.length ? orderedKeys(baseUrl, model, apiKeys) : [""];
  const body = normalizePayloadForRuntime(baseUrl, { ...payload, model });
  let lastErrorText = "";
  let lastStatus = 502;

  for (let index = 0; index < keys.length; index += 1) {
    let response;
    try {
      response = await requestEndpoint(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(keys[index] ? { Authorization: `Bearer ${keys[index]}` } : {}),
        },
        body: JSON.stringify(body),
        timeoutMs,
        allowLocal,
        proxyUrl: options.proxyUrl ?? runtime?.proxyUrl,
      });
    } catch (cause) {
      if (cause?.statusCode === 400) throw cause;
      const timedOut = cause?.code === "ETIMEDOUT" || cause?.name === "TimeoutError" || cause?.name === "AbortError";
      const error = new Error(timedOut
        ? `AI 服务请求超时：${baseUrl}。请检查模型负载或切换到可用模型。`
        : `AI 服务连接失败：${baseUrl}。请先启动本地模型服务，或在系统设置切换到可用云端模型。`);
      error.statusCode = 502;
      throw error;
    }

    if (response.ok) {
      try {
        return JSON.parse(response.text);
      } catch {
        const error = new Error(`AI 接口返回的响应不是有效 JSON：${response.status}`);
        error.statusCode = 502;
        throw error;
      }
    }

    lastStatus = response.status;
    lastErrorText = response.text;
    if (keys.length <= 1 || !retryableKeyStatuses.has(response.status)) {
      throwAiResponseError(response.status, lastErrorText);
    }
  }

  throwAiResponseError(lastStatus, `所有 API Key 均不可用：${lastErrorText}`);
}

function splitApiKeys(value) {
  return String(value || "")
    .split(/\r?\n|\\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function orderedKeys(baseUrl, model, apiKeys) {
  if (apiKeys.length <= 1) return apiKeys;
  const stateKey = `${baseUrl}|${model}|${apiKeys.length}`;
  const start = rotationState.get(stateKey) || 0;
  rotationState.set(stateKey, (start + 1) % apiKeys.length);
  return [...apiKeys.slice(start), ...apiKeys.slice(0, start)];
}

function normalizePayloadForRuntime(baseUrl, payload) {
  if (!isGeminiOpenAiEndpoint(baseUrl)) return payload;
  const next = { ...payload };
  delete next.response_format;
  return next;
}

function isGeminiOpenAiEndpoint(baseUrl) {
  return /generativelanguage\.googleapis\.com\/.*\/openai/i.test(String(baseUrl || ""));
}

function isLocalEndpoint(baseUrl) {
  try {
    const target = new URL(String(baseUrl || ""));
    return ["127.0.0.1", "localhost", "::1"].includes(normalizeHostname(target.hostname));
  } catch {
    return false;
  }
}

async function requestJsonEndpoint(url, options = {}) {
  const response = await requestEndpoint(url, options);
  if (!response.ok) {
    const error = new Error(`上游接口返回异常：${response.status} ${response.text.slice(0, 160)}`);
    error.statusCode = 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  try {
    return JSON.parse(response.text);
  } catch {
    const error = new Error("上游接口返回的响应不是有效 JSON");
    error.statusCode = 502;
    throw error;
  }
}

function requestEndpoint(value, options = {}) {
  const target = validateAiEndpoint(value, { allowLocal: Boolean(options.allowLocal) });
  const timeoutMs = clampNumber(Number(options.timeoutMs || 120000), 1000, 10 * 60 * 1000);
  const maxResponseBytes = clampNumber(Number(options.maxResponseBytes || 4 * 1024 * 1024), 1024, 16 * 1024 * 1024);
  const body = options.body == null ? "" : String(options.body);
  const proxy = resolveAiProxy(target, options);

  if (proxy) {
    return requestViaProxy(target, proxy, {
      ...options,
      body,
      maxResponseBytes,
      timeoutMs,
    });
  }

  return requestDirect(target, {
    ...options,
    body,
    maxResponseBytes,
    timeoutMs,
  });
}

function requestDirect(target, options) {
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: options.method || "GET",
      headers: buildRequestHeaders(options.headers, options.body),
      agent: false,
      lookup: createGuardedLookup(Boolean(options.allowLocal)),
      signal: AbortSignal.timeout(options.timeoutMs),
    }, createResponseHandler(resolve, reject, options.maxResponseBytes));
    request.on("error", reject);
    request.end(options.body || undefined);
  });
}

function requestViaProxy(target, proxy, options) {
  return openProxyTunnel(target, proxy, options.timeoutMs)
    .then((socket) => {
      if (target.protocol !== "https:") {
        return requestOverSocket(target, socket, options);
      }

      return new Promise((resolve, reject) => {
        const secureSocket = tls.connect({
          socket,
          servername: getTlsServername(target.hostname),
          rejectUnauthorized: true,
        });
        const handshakeTimer = setTimeout(() => {
          const error = new Error("AI 服务 TLS 握手超时");
          error.code = "ETIMEDOUT";
          secureSocket.destroy(error);
        }, options.timeoutMs);
        const onError = (error) => {
          clearTimeout(handshakeTimer);
          secureSocket.destroy();
          reject(error);
        };
        secureSocket.once("error", onError);
        secureSocket.once("secureConnect", () => {
          clearTimeout(handshakeTimer);
          secureSocket.removeListener("error", onError);
          requestOverSocket(target, secureSocket, options).then(resolve, reject);
        });
      });
    });
}

function openProxyTunnel(target, proxy, timeoutMs) {
  const transport = proxy.protocol === "https:" ? https : http;
  const authority = formatAuthority(target);

  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      const error = new Error("AI 代理连接超时");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, timeoutMs);
    const request = transport.request({
      protocol: proxy.protocol,
      hostname: normalizeHostname(proxy.hostname),
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: authority,
      headers: {
        Host: authority,
      },
      agent: false,
      servername: getTlsServername(proxy.hostname),
    });

    const fail = (error) => {
      clearTimeout(timer);
      timer = null;
      reject(error);
    };
    request.once("error", fail);
    request.once("connect", (response, socket, head) => {
      clearTimeout(timer);
      timer = null;
      if (Number(response.statusCode) !== 200) {
        socket.destroy();
        const error = new Error(`AI 代理拒绝建立隧道：${response.statusCode || 502}`);
        error.code = "EPROXYCONNECT";
        error.statusCode = 502;
        reject(error);
        return;
      }
      if (head?.length) socket.unshift(head);
      resolve(socket);
    });
    request.end();
  });
}

function requestOverSocket(target, socket, options) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: normalizeHostname(target.hostname),
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: `${target.pathname || "/"}${target.search || ""}`,
      method: options.method || "GET",
      headers: buildRequestHeaders(options.headers, options.body),
      createConnection: () => socket,
      timeout: options.timeoutMs,
    }, createResponseHandler(resolve, reject, options.maxResponseBytes));
    request.on("timeout", () => {
      const error = new Error("AI 服务请求超时");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    request.end(options.body || undefined);
  });
}

function createResponseHandler(resolve, reject, maxResponseBytes) {
  return (response) => {
    const chunks = [];
    let size = 0;
    response.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxResponseBytes) {
        response.destroy(Object.assign(new Error("上游响应过大"), { code: "ERESPONSETOOLARGE" }));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => resolve({
      ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
      status: Number(response.statusCode) || 502,
      text: Buffer.concat(chunks, size).toString("utf8"),
    }));
    response.on("error", reject);
  };
}

function resolveAiProxy(target, options = {}) {
  // Loopback services must stay direct; a cloud proxy should never become an
  // implicit route for the local runtime.
  if (options.allowLocal) return null;
  const explicit = String(options.proxyUrl || "").trim();
  const configured = explicit
    ? explicit
    : readProxyEnvironment(target.protocol);
  if (!configured || isDisabledProxyValue(configured)) return null;
  return validateAiProxyUrl(configured);
}

function readProxyEnvironment(protocol) {
  const names = ["AI_PROXY_URL"];
  if (protocol === "https:") names.push("HTTPS_PROXY", "https_proxy");
  else names.push("HTTP_PROXY", "http_proxy");
  names.push("ALL_PROXY", "all_proxy");
  return names.map((name) => process.env[name]).find((value) => String(value || "").trim()) || "";
}

function validateAiProxyUrl(value) {
  const text = String(value || "").trim();
  if (text && isDisabledProxyValue(text)) return null;
  let proxy;
  try {
    proxy = new URL(text);
  } catch {
    throw createEndpointError("AI 代理地址无效");
  }
  if (![
    "http:",
    "https:",
  ].includes(proxy.protocol) || proxy.hash || proxy.search || (proxy.pathname && proxy.pathname !== "/")) {
    throw createEndpointError("AI 代理地址仅允许无路径的 HTTP(S) URL");
  }
  if (!proxy.hostname) throw createEndpointError("AI 代理地址缺少主机名");
  if (proxy.username || proxy.password) {
    throw createEndpointError("AI 代理地址不得包含用户名或密码");
  }
  return proxy;
}

function buildRequestHeaders(value, body) {
  const headers = { ...(value || {}) };
  Object.keys(headers).forEach((name) => {
    if (["proxy-authorization", "proxy-connection"].includes(name.toLowerCase())) delete headers[name];
  });
  if (body) headers["Content-Length"] = Buffer.byteLength(body);
  return headers;
}

function formatAuthority(target) {
  const normalized = normalizeHostname(target.hostname);
  const hostname = isIP(normalized) === 6 ? `[${normalized}]` : normalized;
  return `${hostname}:${target.port || (target.protocol === "https:" ? 443 : 80)}`;
}

function getTlsServername(hostname) {
  const normalized = normalizeHostname(hostname);
  return isIP(normalized) ? undefined : normalized;
}

function isDisabledProxyValue(value) {
  return ["", "direct", "none", "off"].includes(String(value || "").trim().toLowerCase());
}

function validateAiEndpoint(value, { allowLocal = false } = {}) {
  let target;
  try {
    target = new URL(String(value || "").trim());
  } catch {
    throw createEndpointError("模型服务地址无效");
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.hash || target.search) {
    throw createEndpointError("模型服务地址仅允许无凭据的 HTTP(S) URL");
  }
  const hostname = normalizeHostname(target.hostname);
  if (allowLocal) {
    if (!isLocalEndpoint(target.href)) throw createEndpointError("本地模型服务地址必须使用回环地址");
  } else {
    if (target.protocol !== "https:") throw createEndpointError("云端模型服务必须使用 HTTPS");
    if (isBlockedCloudHostname(hostname) || isBlockedIpAddress(hostname)) {
      throw createEndpointError("云端模型服务地址不能指向本机、内网、链路本地或元数据服务");
    }
  }
  return target;
}

function createGuardedLookup(allowLocal) {
  return async (hostname, options, callback) => {
    try {
      const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
      if (!addresses.length) throw new Error("模型服务域名没有可用地址");
      const invalid = addresses.some(({ address }) => allowLocal ? !isLoopbackAddress(address) : isBlockedIpAddress(address));
      if (invalid) throw createEndpointError("模型服务域名解析到了不允许的网络地址");
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } catch (error) {
      callback(error);
    }
  };
}

function isBlockedCloudHostname(hostname) {
  return blockedCloudHostnames.has(hostname)
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa");
}

function isBlockedIpAddress(address) {
  const family = isIP(normalizeHostname(address));
  if (!family) return false;
  return blockedAddresses.check(normalizeHostname(address), family === 6 ? "ipv6" : "ipv4");
}

function isLoopbackAddress(address) {
  const normalized = normalizeHostname(address);
  return blockedAddresses.check(normalized, isIP(normalized) === 6 ? "ipv6" : "ipv4")
    && (normalized === "::1" || /^127\./.test(normalized));
}

function normalizeHostname(value) {
  return String(value || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function buildBlockedAddressList() {
  const list = new BlockList();
  [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ].forEach(([network, prefix]) => list.addSubnet(network, prefix, "ipv4"));
  [
    ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7],
    ["fe80::", 10], ["ff00::", 8], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ].forEach(([network, prefix]) => list.addSubnet(network, prefix, "ipv6"));
  list.addAddress("168.63.129.16", "ipv4");
  return list;
}

function createEndpointError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "EENDPOINTPOLICY";
  return error;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function throwAiResponseError(status, text) {
  const error = new Error(`AI 接口返回异常：${status} ${String(text || "").slice(0, 160)}`);
  error.statusCode = 502;
  throw error;
}

export {
  isLocalEndpoint,
  requestChatCompletion,
  requestJsonEndpoint,
  splitApiKeys,
  validateAiEndpoint,
  validateAiProxyUrl,
};

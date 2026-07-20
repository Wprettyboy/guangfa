import { ApiError } from "./errors.js";

function readJsonBody(request, { limitBytes = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new TypeError("JSON 请求体字节上限必须是正整数");
  }

  const declaredLength = Number(request.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    request.on("error", () => {});
    request.resume?.();
    return Promise.reject(payloadTooLargeError(limitBytes));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let settled = false;

    const onData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > limitBytes) {
        settled = true;
        chunks.length = 0;
        request.removeListener("data", onData);
        request.removeListener("end", onEnd);
        request.removeListener("aborted", onAborted);
        request.resume?.();
        reject(payloadTooLargeError(limitBytes));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const body = decodeUtf8(Buffer.concat(chunks, byteLength));
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new ApiError(400, "INVALID_JSON", "请求 JSON 格式错误", { cause: error }));
      }
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ApiError(400, "REQUEST_ABORTED", "请求在读取完成前已中止"));
    };

    function cleanup() {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function decodeUtf8(buffer) {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function payloadTooLargeError(limitBytes) {
  return new ApiError(413, "PAYLOAD_TOO_LARGE", `请求内容不能超过 ${limitBytes} 字节`);
}

function sendJson(response, statusCode, body, { head = false } = {}) {
  const json = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(json));
  response.end(head ? undefined : json);
}

function sendBuffer(response, { statusCode = 200, buffer, contentType = "application/octet-stream", headers = {} }, { head = false } = {}) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", buffer.byteLength);
  Object.entries(headers).forEach(([key, value]) => {
    if (value != null) response.setHeader(key, value);
  });
  response.end(head ? undefined : buffer);
}

export { readJsonBody, sendBuffer, sendJson };

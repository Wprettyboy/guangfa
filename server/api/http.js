function readJsonBody(request, { limitBytes = 80 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("请求 JSON 格式错误");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendBuffer(response, { statusCode = 200, buffer, contentType = "application/octet-stream", headers = {} }) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  Object.entries(headers).forEach(([key, value]) => {
    if (value != null) response.setHeader(key, value);
  });
  response.end(buffer);
}

export { readJsonBody, sendBuffer, sendJson };

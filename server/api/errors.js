const defaultMessages = {
  400: "请求无效",
  401: "身份认证失败",
  403: "没有接口访问权限",
  404: "接口不存在",
  405: "请求方法不允许",
  408: "请求响应超时",
  409: "请求与当前资源状态冲突",
  412: "资源前置条件校验失败",
  413: "请求内容过大",
  415: "请求内容类型不支持",
  422: "请求内容无法处理",
  428: "请求缺少必要的前置条件",
  429: "请求过于频繁",
  500: "接口处理失败",
  502: "上游服务请求失败",
  503: "服务暂不可用",
  504: "上游服务响应超时",
};

const defaultCodes = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_CONTENT",
  428: "PRECONDITION_REQUIRED",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

class ApiError extends Error {
  constructor(statusCode, code, message, { details, headers, cause } = {}) {
    super(message || defaultMessages[statusCode] || defaultMessages[500], { cause });
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code || defaultCodes[statusCode] || defaultCodes[500];
    this.details = details;
    this.headers = headers;
  }
}

function normalizeApiError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof URIError) {
    return new ApiError(400, "INVALID_PATH_ENCODING", "请求路径编码错误", { cause: error });
  }

  const statusCode = normalizeStatusCode(error?.statusCode);
  if (statusCode < 500) {
    const publicCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code || ""))
      ? String(error.code)
      : defaultCodes[statusCode] || "REQUEST_FAILED";
    return new ApiError(
      statusCode,
      publicCode,
      error?.message || defaultMessages[statusCode] || defaultMessages[400],
      { cause: error },
    );
  }
  return new ApiError(
    statusCode,
    defaultCodes[statusCode] || defaultCodes[500],
    defaultMessages[statusCode] || defaultMessages[500],
    { cause: error },
  );
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

export { ApiError, normalizeApiError };

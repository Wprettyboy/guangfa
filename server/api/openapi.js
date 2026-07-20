import { toOpenApiSchema } from "./schema.js";

const errorSchema = {
  type: "object",
  required: ["error", "code", "message", "requestId"],
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    message: { type: "string" },
    requestId: { type: "string" },
    details: { type: "array", items: { type: "object" } },
  },
};

function buildOpenApiDocument(routes, options = {}) {
  const paths = {};
  routes.forEach((route) => {
    const path = toPublicOpenApiPath(route.path, options.pathPrefix || "/api/v1");
    if (!paths[path]) paths[path] = {};
    const requestBody = buildRequestBody(route);
    paths[path][route.method.toLowerCase()] = compactObject({
      operationId: route.id,
      summary: route.summary || route.id,
      tags: route.tags || [],
      parameters: [
        ...extractPathParameters(route.path),
        ...buildQueryParameters(route.query),
        ...buildHeaderParameters(route.headers),
      ],
      requestBody,
      responses: buildResponses(route.responses, Boolean(requestBody)),
      security: buildSecurity(route, options.auth),
      "x-required-roles": route.auth === false ? undefined : route.roles,
    });
  });

  return {
    openapi: "3.0.3",
    info: {
      title: options.title || "广发项目 API",
      version: options.version || process.env.API_VERSION || "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: options.auth?.apiKeyHeader || "x-api-key",
        },
        resourceTokenAuth: {
          type: "apiKey",
          in: "query",
          name: "accessToken",
          description: "仅用于标记为可选认证的精确资源短期访问 URL",
        },
      },
      schemas: { ApiError: errorSchema },
    },
    servers: [{ url: "/" }],
    paths,
  };
}

function toOpenApiPath(path) {
  return String(path).replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function toPublicOpenApiPath(path, pathPrefix) {
  const canonical = String(path).replace(/^\/api(?=\/|$)/, String(pathPrefix || "/api/v1").replace(/\/$/, ""));
  return toOpenApiPath(canonical);
}

function buildRouteList(routes, options = {}) {
  return routes.map((route) => ({
    id: route.id,
    method: route.method,
    path: String(route.path).replace(/^\/api(?=\/|$)/, String(options.pathPrefix || "/api/v1").replace(/\/$/, "")),
    tags: route.tags || [],
    summary: route.summary || "",
    auth: route.auth === false ? false : route.auth === "optional" ? "optional" : true,
    roles: route.roles || [],
    body: route.body || null,
    requestBody: route.requestBody || null,
    query: route.query || null,
    headers: route.headers || null,
    responses: route.responses || null,
  }));
}

function buildRequestBody(route) {
  if (route.body) {
    const contentTypes = route.contentTypes || ["application/json"];
    return {
      required: true,
      content: Object.fromEntries(contentTypes.map((contentType) => [
        contentType,
        { schema: toOpenApiSchema(route.body) },
      ])),
    };
  }
  if (!route.requestBody) return undefined;

  const descriptor = typeof route.requestBody === "object" ? route.requestBody : { schema: route.requestBody };
  const contentTypes = descriptor.contentTypes || [descriptor.contentType || "application/octet-stream"];
  return {
    required: descriptor.required !== false,
    content: Object.fromEntries(contentTypes.map((contentType) => [
      contentType,
      { schema: toOpenApiSchema(descriptor.schema || "binary") },
    ])),
  };
}

function buildQueryParameters(query) {
  return query ? Object.entries(query).map(([rawName, schema]) => {
    const name = rawName.replace(/\?$/, "");
    const optional = rawName.endsWith("?") || String(schema).endsWith("?") || schema?.optional;
    return {
      name,
      in: "query",
      required: schema?.required === true || !optional,
      schema: toOpenApiSchema(schema),
    };
  }) : [];
}

function buildHeaderParameters(headers) {
  return headers ? Object.entries(headers).map(([rawName, schema]) => {
    const name = rawName.replace(/\?$/, "");
    const optional = rawName.endsWith("?") || String(schema).endsWith("?") || schema?.optional;
    return {
      name,
      in: "header",
      required: schema?.required === true || !optional,
      schema: toOpenApiSchema(schema),
      ...(schema?.description ? { description: schema.description } : {}),
    };
  }) : [];
}

function buildResponses(responses = {}, hasRequestBody = false) {
  const entries = Object.entries(responses).length ? Object.entries(responses) : [["200", "object"]];
  const result = Object.fromEntries(entries.map(([status, response]) => [status, buildResponse(status, response)]));
  const commonStatuses = ["400", "401", "403", "404", "405", "429", "500"];
  if (hasRequestBody) commonStatuses.push("413", "415");
  commonStatuses.forEach((status) => {
    if (!result[status]) result[status] = errorResponse(status);
  });
  return result;
}

function buildResponse(status, value) {
  const descriptor = isResponseDescriptor(value) ? value : { schema: value };
  const schema = descriptor.schema || "object";
  const contentType = descriptor.contentType || (schema === "binary" ? "application/octet-stream" : "application/json");
  const responseSchema = Number(status) >= 400 && contentType === "application/json" && schema === "object"
    ? { $ref: "#/components/schemas/ApiError" }
    : toOpenApiSchema(schema);
  return {
    description: descriptor.description || (String(status).startsWith("2") ? "Success" : "Response"),
    ...(descriptor.headers ? { headers: buildResponseHeaders(descriptor.headers) } : {}),
    content: {
      [contentType]: { schema: responseSchema },
    },
  };
}

function buildResponseHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, descriptor]) => [name, {
    ...(descriptor?.description ? { description: descriptor.description } : {}),
    schema: toOpenApiSchema(descriptor?.schema || descriptor || "string"),
  }]));
}

function isResponseDescriptor(value) {
  return Boolean(value && typeof value === "object" && (
    Object.hasOwn(value, "schema")
    || Object.hasOwn(value, "contentType")
    || Object.hasOwn(value, "description")
    || Object.hasOwn(value, "headers")
  ));
}

function errorResponse(status) {
  return {
    description: ({
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      412: "Precondition Failed",
      413: "Payload Too Large",
      415: "Unsupported Media Type",
      428: "Precondition Required",
      429: "Too Many Requests",
      500: "Internal Server Error",
    })[status] || "Error",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
  };
}

function buildSecurity(route, auth) {
  if (route.auth === false || auth?.mode === "disabled") return [];
  if (route.auth === "optional") {
    return [{ bearerAuth: [] }, { apiKeyAuth: [] }, { resourceTokenAuth: [] }];
  }
  return [{ bearerAuth: [] }, { apiKeyAuth: [] }];
}

function extractPathParameters(path) {
  return [...String(path).matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export { buildOpenApiDocument, buildRouteList };

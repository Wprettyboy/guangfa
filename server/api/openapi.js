function buildOpenApiDocument(routes) {
  const paths = {};
  routes.forEach((route) => {
    const path = toOpenApiPath(route.path);
    if (!paths[path]) paths[path] = {};
    paths[path][route.method.toLowerCase()] = {
      operationId: route.id,
      summary: route.summary || route.id,
      tags: route.tags || [],
      parameters: [
        ...extractPathParameters(route.path),
        ...(route.query ? Object.entries(route.query).map(([name, schema]) => ({
          name,
          in: "query",
          required: !String(schema).endsWith("?"),
          schema: toOpenApiSchema(schema),
        })) : []),
      ],
      requestBody: route.body ? {
        required: true,
        content: {
          "application/json": {
            schema: objectSchema(route.body),
          },
        },
      } : undefined,
      responses: buildResponses(route.responses),
    };
  });
  return {
    openapi: "3.0.3",
    info: {
      title: "广发项目本地 API",
      version: "0.1.0",
    },
    paths,
  };
}

function toOpenApiPath(path) {
  return String(path).replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function buildRouteList(routes) {
  return routes.map((route) => ({
    id: route.id,
    method: route.method,
    path: route.path,
    tags: route.tags || [],
    summary: route.summary || "",
    body: route.body || null,
    query: route.query || null,
    responses: route.responses || null,
  }));
}

function buildResponses(responses = {}) {
  const entries = Object.entries(responses).length ? Object.entries(responses) : [["200", "object"]];
  return entries.reduce((result, [status, schema]) => {
    result[status] = {
      description: status === "200" ? "OK" : "Response",
      content: schema === "binary" ? {
        "application/octet-stream": { schema: { type: "string", format: "binary" } },
      } : {
        "application/json": { schema: toOpenApiSchema(schema) },
      },
    };
    return result;
  }, {});
}

function extractPathParameters(path) {
  return [...String(path).matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

function objectSchema(shape) {
  const properties = {};
  const required = [];
  Object.entries(shape || {}).forEach(([key, value]) => {
    const optional = key.endsWith("?") || String(value).endsWith("?");
    const name = key.replace(/\?$/, "");
    properties[name] = toOpenApiSchema(value);
    if (!optional) required.push(name);
  });
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

function toOpenApiSchema(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return objectSchema(value);
  const raw = String(value || "string").replace(/\?$/, "");
  if (raw === "number") return { type: "number" };
  if (raw === "integer") return { type: "integer" };
  if (raw === "boolean") return { type: "boolean" };
  if (raw === "array") return { type: "array", items: { type: "object" } };
  if (raw === "binary") return { type: "string", format: "binary" };
  if (raw === "object") return { type: "object" };
  return { type: "string" };
}

export { buildOpenApiDocument, buildRouteList };

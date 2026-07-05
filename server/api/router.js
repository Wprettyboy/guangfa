import { buildOpenApiDocument, buildRouteList } from "./openapi.js";
import { findRoute, getRoutes } from "./registry.js";
import { readJsonBody, sendBuffer, sendJson } from "./http.js";

function createApiMiddleware({ notFoundPrefixes = [] } = {}) {
  return async function handleRegisteredApi(request, response, next) {
    const url = new URL(request.url || "/", "http://local");

    if (request.method === "GET" && url.pathname === "/api/_meta/routes") {
      sendJson(response, 200, buildRouteList(getRoutes()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/_meta/openapi.json") {
      sendJson(response, 200, buildOpenApiDocument(getRoutes()));
      return;
    }

    const match = findRoute(request.method, url.pathname);
    if (!match) {
      if (notFoundPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
        sendJson(response, 404, { error: "接口不存在" });
        return;
      }
      next();
      return;
    }

    const { route, params } = match;
    try {
      const body = route.body ? await readJsonBody(request, { limitBytes: route.bodyLimitBytes }) : {};
      const result = await route.handler({
        body,
        params,
        query: url.searchParams,
        request,
        response,
        url,
      });
      if (response.writableEnded) return;
      if (result?.kind === "buffer") {
        sendBuffer(response, result);
        return;
      }
      sendJson(response, result?.statusCode || 200, result?.body ?? result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "接口处理失败",
      });
    }
  };
}

export { createApiMiddleware };

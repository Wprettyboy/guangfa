import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiMiddleware } from "./server/api/index.js";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);
  const onlyOfficeServerUrl = env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";

  return {
    plugins: [
      react(),
      {
        name: "local-ai-fill-api",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith("/api/")) {
              next();
              return;
            }
            const origin = request.headers.origin;
            if (origin && !isAllowedApiOrigin(request, origin, onlyOfficeServerUrl)) {
              response.statusCode = 403;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ error: "不允许的请求来源" }));
              return;
            }
            if (origin) {
              response.setHeader("Access-Control-Allow-Origin", origin);
              response.setHeader("Vary", "Origin");
            }
            response.setHeader("Access-Control-Allow-Headers", "Content-Type");
            response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
            if (request.method === "OPTIONS") {
              response.statusCode = 204;
              response.end();
              return;
            }
            next();
          });
          server.middlewares.use(apiMiddleware());
        },
      },
    ],
  };
});

function isAllowedApiOrigin(request, origin, onlyOfficeServerUrl) {
  const originUrl = parseHttpUrl(origin);
  if (!originUrl || !isLoopbackHost(originUrl.hostname)) return false;

  const requestProtocol = request.socket?.encrypted ? "https:" : "http:";
  const requestUrl = parseHttpUrl(`${requestProtocol}//${request.headers.host || ""}`);
  if (requestUrl && isLoopbackHost(requestUrl.hostname) && originUrl.origin === requestUrl.origin) return true;

  const onlyOfficeUrl = parseHttpUrl(onlyOfficeServerUrl);
  return Boolean(
    onlyOfficeUrl
      && isLoopbackHost(onlyOfficeUrl.hostname)
      && originUrl.protocol === onlyOfficeUrl.protocol
      && getEffectivePort(originUrl) === getEffectivePort(onlyOfficeUrl),
  );
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  return loopbackHosts.has(String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase());
}

function getEffectivePort(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

export { isAllowedApiOrigin };

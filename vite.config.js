import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiMiddleware } from "./server/api/index.js";
import { officeMiddleware } from "./server/office.js";
import { outlineProbeMiddleware } from "./server/outline-probe.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

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
            response.setHeader("Access-Control-Allow-Origin", "*");
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
          server.middlewares.use(outlineProbeMiddleware());
          server.middlewares.use(officeMiddleware());
        },
      },
    ],
  };
});

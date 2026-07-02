import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { aiFillMiddleware } from "./server/ai.js";
import { docxPreviewMiddleware } from "./server/docx-preview.js";
import { draftMiddleware } from "./server/draft.js";
import { knowledgeBaseMiddleware } from "./server/knowledge-base.js";
import { officeMiddleware } from "./server/office.js";
import { outlineProbeMiddleware } from "./server/outline-probe.js";
import { settingsMiddleware } from "./server/settings.js";
import { templateLibraryMiddleware } from "./server/templates.js";

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
            response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
            if (request.method === "OPTIONS") {
              response.statusCode = 204;
              response.end();
              return;
            }
            next();
          });
          server.middlewares.use(draftMiddleware());
          server.middlewares.use(templateLibraryMiddleware());
          server.middlewares.use(knowledgeBaseMiddleware());
          server.middlewares.use(settingsMiddleware());
          server.middlewares.use(outlineProbeMiddleware());
          server.middlewares.use(officeMiddleware());
          server.middlewares.use(docxPreviewMiddleware());
          server.middlewares.use(aiFillMiddleware());
        },
      },
    ],
  };
});

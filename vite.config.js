import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);
  const { createApiGateway } = await import("./server/api/gateway.js");
  const onlyOfficeServerUrl = env.ONLYOFFICE_SERVER_URL || "http://127.0.0.1:8080";

  return {
    plugins: [
      react(),
      {
        name: "guangfa-api-gateway",
        configureServer(server) {
          server.middlewares.use(createDevelopmentGateway(onlyOfficeServerUrl));
        },
        configurePreviewServer(server) {
          server.middlewares.use(createDevelopmentGateway(onlyOfficeServerUrl));
        },
      },
    ],
  };
});

function createDevelopmentGateway(onlyOfficeServerUrl) {
  return createApiGateway({
    allowedOrigins: [onlyOfficeServerUrl],
    deploymentMode: "development",
  });
}

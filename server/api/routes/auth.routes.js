import { defineRoute } from "../registry.js";

function registerAuthRoutes() {
  defineRoute({
    id: "auth.me",
    method: "GET",
    path: "/api/auth/me",
    tags: ["auth"],
    summary: "读取当前 API 身份",
    roles: ["viewer", "editor", "admin", "service"],
    responses: { 200: "object" },
    handler: ({ principal }) => ({
      id: principal.id,
      roles: principal.roles,
      authentication: principal.authentication,
    }),
  });
}

export { registerAuthRoutes };

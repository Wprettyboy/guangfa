import { readDraft, writeDraft } from "../../draft.js";
import { defineRoute } from "../registry.js";

function registerDraftRoutes() {
  defineRoute({
    id: "draft.read",
    method: "GET",
    path: "/api/draft",
    tags: ["draft"],
    summary: "读取当前草稿",
    responses: { 200: "object" },
    handler: () => readDraft(),
  });

  defineRoute({
    id: "draft.write",
    method: "POST",
    path: "/api/draft",
    tags: ["draft"],
    summary: "保存当前草稿",
    bodyLimitBytes: 80 * 1024 * 1024,
    body: { data: "object?" },
    responses: { 200: "object" },
    handler: ({ body }) => writeDraft(body || {}).then(() => ({ ok: true })),
  });
}

export { registerDraftRoutes };

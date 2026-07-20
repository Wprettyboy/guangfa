import { readDraft, writeDraft } from "../../draft.js";
import { defineRoute } from "../registry.js";

function registerDraftRoutes() {
  defineRoute({
    id: "draft.read",
    method: "GET",
    path: "/api/draft",
    tags: ["draft"],
    summary: "读取当前草稿",
    roles: ["viewer"],
    responses: { 200: { schema: { type: "object", nullable: true }, description: "当前草稿；尚未保存时为 null" } },
    handler: ({ principal }) => readDraft(principal),
  });

  defineRoute({
    id: "draft.write",
    method: "POST",
    path: "/api/draft",
    tags: ["draft"],
    summary: "保存当前草稿",
    roles: ["editor"],
    bodyLimitBytes: 80 * 1024 * 1024,
    body: "object",
    responses: { 200: "object" },
    handler: ({ body, principal }) => writeDraft(body || {}, principal).then(() => ({ ok: true })),
  });
}

export { registerDraftRoutes };

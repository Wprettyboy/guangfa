import { ApiError } from "../api/errors.js";
import { getKnowledgeDatabase } from "./db.js";

function scopeKnowledgeBaseList(bases, principal) {
  if (!isTenantIsolationRequired() || isAdmin(principal)) return bases;
  const projectIds = requirePrincipalProjects(principal);
  return bases.filter((base) => base.scope === "global" || projectIds.has(String(base.projectId || "")));
}

function scopeKnowledgeBasePayload(payload, principal) {
  if (!isTenantIsolationRequired() || isAdmin(principal)) return payload;
  if (payload?.scope === "global") throw forbidden();
  return { ...payload, scope: "project", projectId: resolveProjectId(payload?.projectId, principal) };
}

async function scopeKnowledgeSearchPayload(payload, principal) {
  if (!isTenantIsolationRequired() || isAdmin(principal)) return payload;
  const scoped = { ...payload, projectId: resolveProjectId(payload?.projectId, principal) };
  await assertKnowledgeBaseIdsAccess([
    ...(Array.isArray(scoped.kbIds) ? scoped.kbIds : []),
    ...(Array.isArray(scoped.globalKbIds) ? scoped.globalKbIds : []),
  ], principal);
  return scoped;
}

async function assertKnowledgeBaseIdsAccess(kbIds, principal, options) {
  for (const kbId of new Set(kbIds.filter(Boolean))) {
    await assertKnowledgeBaseAccess(kbId, principal, options);
  }
}

async function assertKnowledgeBaseAccess(kbId, principal, { write = false } = {}) {
  if (skipTenantCheck(principal)) return;
  const database = await getKnowledgeDatabase();
  const base = database.prepare(`
    SELECT scope, project_id AS projectId
    FROM knowledge_bases WHERE id = ? AND deleted_at IS NULL
  `).get(kbId);
  assertRowAccess(base, principal, { write });
}

async function assertKnowledgeDocumentAccess(documentId, principal, options) {
  if (skipTenantCheck(principal)) return;
  const database = await getKnowledgeDatabase();
  const base = database.prepare(`
    SELECT b.scope, b.project_id AS projectId
    FROM knowledge_documents d
    JOIN knowledge_bases b ON b.id = d.kb_id AND b.deleted_at IS NULL
    WHERE d.id = ? AND d.deleted_at IS NULL
  `).get(documentId);
  assertRowAccess(base, principal, options);
}

async function assertKnowledgeImageAccess(imageId, principal) {
  if (skipTenantCheck(principal)) return;
  const database = await getKnowledgeDatabase();
  const base = database.prepare(`
    SELECT b.scope, b.project_id AS projectId
    FROM knowledge_document_images i
    JOIN knowledge_documents d ON d.id = i.document_id AND d.deleted_at IS NULL
    JOIN knowledge_bases b ON b.id = d.kb_id AND b.deleted_at IS NULL
    WHERE i.id = ?
  `).get(imageId);
  assertRowAccess(base, principal);
}

async function assertKnowledgeChunkAccess(chunkId, principal) {
  if (skipTenantCheck(principal)) return;
  const database = await getKnowledgeDatabase();
  const base = database.prepare(`
    SELECT b.scope, b.project_id AS projectId
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    JOIN knowledge_bases b ON b.id = c.kb_id AND b.deleted_at IS NULL
    WHERE c.id = ?
  `).get(chunkId);
  assertRowAccess(base, principal);
}

function assertRowAccess(base, principal, { write = false } = {}) {
  if (!base) return;
  if (base.scope === "global") {
    if (write && !isAdmin(principal)) throw forbidden();
    return;
  }
  if (!requirePrincipalProjects(principal).has(String(base.projectId || ""))) throw forbidden();
}

function resolveProjectId(requestedProjectId, principal) {
  const projectIds = requirePrincipalProjects(principal);
  const requested = String(requestedProjectId || "").trim();
  if (requested) {
    if (!projectIds.has(requested)) throw forbidden();
    return requested;
  }
  if (projectIds.size === 1) return [...projectIds][0];
  throw new ApiError(400, "PROJECT_REQUIRED", "当前身份可访问多个项目，请明确指定 projectId");
}

function requirePrincipalProjects(principal) {
  const projectIds = new Set(principal?.projectIds || []);
  if (!projectIds.size) throw forbidden();
  return projectIds;
}

function skipTenantCheck(principal) {
  return !isTenantIsolationRequired() || isAdmin(principal) || principal?.authentication === "anonymous";
}

function isTenantIsolationRequired() {
  const mode = String(process.env.KNOWLEDGE_TENANT_MODE || "disabled").toLowerCase();
  if (!new Set(["disabled", "required"]).has(mode)) {
    throw new Error(`不支持的 KNOWLEDGE_TENANT_MODE：${mode}`);
  }
  return mode === "required";
}

function isAdmin(principal) {
  return Array.isArray(principal?.roles) && principal.roles.includes("admin");
}

function forbidden() {
  return new ApiError(403, "KNOWLEDGE_PROJECT_FORBIDDEN", "当前身份无权访问该项目知识库");
}

export {
  assertKnowledgeBaseAccess,
  assertKnowledgeBaseIdsAccess,
  assertKnowledgeChunkAccess,
  assertKnowledgeDocumentAccess,
  assertKnowledgeImageAccess,
  scopeKnowledgeBaseList,
  scopeKnowledgeBasePayload,
  scopeKnowledgeSearchPayload,
};

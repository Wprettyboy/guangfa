import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const draftDir = path.resolve(process.cwd(), "data", "drafts");
const legacyDraftFile = path.join(draftDir, "current.json");
const actorDraftDir = path.join(draftDir, "by-actor");
const localDevelopmentActorId = "local-development";
const actorIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._@:+|=-]{0,127}$/u;
const draftWriteQueues = new Map();

async function readDraft(principal) {
  const draftFile = resolveDraftFile(principal);
  try {
    return JSON.parse(await readFile(draftFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeDraft(draft, principal) {
  const draftFile = resolveDraftFile(principal);
  const previousWrite = draftWriteQueues.get(draftFile) || Promise.resolve();
  const currentWrite = previousWrite.catch(() => {}).then(() => writeDraftAtomically(draftFile, draft));
  draftWriteQueues.set(draftFile, currentWrite);
  try {
    await currentWrite;
  } finally {
    if (draftWriteQueues.get(draftFile) === currentWrite) draftWriteQueues.delete(draftFile);
  }
}

async function writeDraftAtomically(draftFile, draft) {
  await mkdir(path.dirname(draftFile), { recursive: true });
  const tempFile = `${draftFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tempFile, JSON.stringify(draft, null, 2), "utf8");
    await rename(tempFile, draftFile);
  } finally {
    await rm(tempFile, { force: true }).catch(() => {});
  }
}

function resolveDraftFile(principal) {
  const actorId = assertDraftActorId(principal?.id ?? localDevelopmentActorId);
  if (actorId === localDevelopmentActorId && (!principal || principal.authentication === "disabled")) {
    return legacyDraftFile;
  }
  const actorHash = createHash("sha256").update(actorId, "utf8").digest("hex");
  return path.join(actorDraftDir, `${actorHash}.json`);
}

function assertDraftActorId(value) {
  const actorId = String(value || "");
  if (!actorIdPattern.test(actorId) || Buffer.byteLength(actorId, "utf8") > 256) {
    const error = new Error("草稿身份标识格式无效");
    error.statusCode = 400;
    throw error;
  }
  return actorId;
}

export { assertDraftActorId, readDraft, writeDraft };

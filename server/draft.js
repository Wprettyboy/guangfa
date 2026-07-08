import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const draftDir = path.resolve(process.cwd(), "data", "drafts");
const draftFile = path.join(draftDir, "current.json");

async function readDraft() {
  try {
    return JSON.parse(await readFile(draftFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeDraft(draft) {
  await mkdir(draftDir, { recursive: true });
  const tempFile = path.join(draftDir, `current.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(tempFile, JSON.stringify(draft, null, 2), "utf8");
    await rename(tempFile, draftFile);
  } finally {
    await rm(tempFile, { force: true }).catch(() => {});
  }
}

export { readDraft, writeDraft };

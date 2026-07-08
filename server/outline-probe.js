import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const debugDir = path.resolve(process.cwd(), "data", "debug");
const latestFile = path.join(debugDir, "onlyoffice-outline-latest.json");

async function saveOutlineProbe(body) {
  const payload = {
    savedAt: new Date().toISOString(),
    fileName: body?.fileName || "",
    previewId: body?.previewId || "",
    outline: body?.outline || null,
  };
  await mkdir(debugDir, { recursive: true });
  await writeFile(latestFile, JSON.stringify(payload, null, 2), "utf8");
  return {
    ok: true,
    count: payload.outline?.items?.length || 0,
    file: latestFile,
  };
}

async function readLatestOutlineProbe() {
  try {
    return JSON.parse(await readFile(latestFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      error.statusCode = 404;
      error.message = "还没有收到 OnlyOffice 大纲抽取结果";
    }
    throw error;
  }
}

export { readLatestOutlineProbe, saveOutlineProbe };

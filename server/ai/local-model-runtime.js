import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const managedModel = "qwen3.6-35b-a3b";
const managedPort = "8129";
const managedHealthUrl = "http://127.0.0.1:8129/health";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const startScript = path.join(projectRoot, "scripts", "start-local-qwen36-rocm.ps1");
const logDir = "C:\\llm";
let startupPromise = null;

async function ensureLocalModelRuntime(runtime) {
  if (!isManagedLocalModelRuntime(runtime) || process.env.LOCAL_LLM_AUTOSTART === "false") return;
  if (await isRuntimeReady()) return;
  if (process.platform !== "win32") throw createStartupError("本地 Qwen 按需启动仅支持当前 Windows ROCm 环境");

  if (!startupPromise) {
    startupPromise = startRuntime().finally(() => {
      startupPromise = null;
    });
  }
  await startupPromise;
}

function isManagedLocalModelRuntime(runtime) {
  if (String(runtime?.model || "").trim().toLowerCase() !== managedModel) return false;
  try {
    const target = new URL(String(runtime?.baseUrl || ""));
    const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return target.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(hostname)
      && target.port === managedPort
      && /^\/v1\/?$/i.test(target.pathname);
  } catch {
    return false;
  }
}

async function startRuntime() {
  mkdirSync(logDir, { recursive: true });
  const stdout = openSync(path.join(logDir, "qwen36-rocm-server.log"), "a");
  const stderr = openSync(path.join(logDir, "qwen36-rocm-server.err.log"), "a");
  let child;
  try {
    child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", startScript,
    ], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }

  let startupError = null;
  let exitCode = null;
  child.once("error", (error) => {
    startupError = error;
  });
  child.once("exit", (code) => {
    exitCode = code;
  });
  child.unref();

  const timeoutMs = clampNumber(Number(process.env.LOCAL_LLM_START_TIMEOUT_MS || 10 * 60 * 1000), 30_000, 15 * 60 * 1000);
  const deadlineAt = Date.now() + timeoutMs;
  while (Date.now() < deadlineAt) {
    if (await isRuntimeReady()) return;
    if (startupError) throw createStartupError(`本地 Qwen 启动失败：${startupError.message}`);
    if (exitCode !== null && exitCode !== 0) throw createStartupError(`本地 Qwen 启动进程提前退出，退出码 ${exitCode}`);
    await delay(1000);
  }
  throw createStartupError("本地 Qwen 按需加载超时");
}

async function isRuntimeReady() {
  try {
    const response = await fetch(managedHealthUrl, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function createStartupError(message) {
  const error = new Error(`${message}。请查看 C:\\llm\\qwen36-rocm-server.err.log`);
  error.statusCode = 503;
  error.code = "ELOCALMODELSTART";
  return error;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { ensureLocalModelRuntime, isManagedLocalModelRuntime };

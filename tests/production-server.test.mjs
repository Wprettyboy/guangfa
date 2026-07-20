import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplicationHandler, startProductionServer } from "../server/http-server.js";

test("the production handler serves SPA assets with health and security semantics", async (context) => {
  const previousHsts = process.env.API_HSTS;
  const previousApiBaseUrl = process.env.VITE_API_BASE_URL;
  process.env.API_HSTS = "true";
  process.env.VITE_API_BASE_URL = "https://api.example.test";
  const root = await mkdtemp(path.join(tmpdir(), "guangfa-production-handler-"));
  const distDir = path.join(root, "dist");
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><title>production</title>", "utf8");
  await writeFile(path.join(distDir, "assets", "app-abcdefgh.js"), "console.log('ok')", "utf8");

  const handler = createApplicationHandler({
    distDir,
    gateway: async (request, response, next) => next(),
  });
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    if (previousHsts == null) delete process.env.API_HSTS;
    else process.env.API_HSTS = previousHsts;
    if (previousApiBaseUrl == null) delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL = previousApiBaseUrl;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.match(health.headers.get("strict-transport-security"), /max-age=31536000/);

  const spa = await fetch(`${baseUrl}/workspace/fill`, { headers: { Accept: "text/html" } });
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /production/);
  assert.match(spa.headers.get("content-security-policy"), /object-src 'none'/);
  assert.match(spa.headers.get("content-security-policy"), /connect-src[^;]*https:\/\/api\.example\.test/);
  assert.equal(spa.headers.get("x-content-type-options"), "nosniff");

  const asset = await fetch(`${baseUrl}/assets/app-abcdefgh.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const invalidMethod = await fetch(`${baseUrl}/not-api`, { method: "POST" });
  assert.equal(invalidMethod.status, 405);
  assert.equal(invalidMethod.headers.get("allow"), "GET, HEAD");
});

test("production startup fails closed without authentication and OnlyOffice secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "guangfa-production-config-"));
  const distDir = path.join(root, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "ok", "utf8");
  const names = ["API_AUTH_MODE", "API_AUTH_BEARER_TOKENS", "API_AUTH_API_KEYS", "ONLYOFFICE_JWT_SECRET", "API_CAPABILITY_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  try {
    await assert.rejects(startProductionServer({ rootDir: root, distDir }), /API_AUTH_MODE|API_AUTH_BEARER_TOKENS/);
  } finally {
    names.forEach((name) => {
      if (previous[name] == null) delete process.env[name];
      else process.env[name] = previous[name];
    });
    await rm(root, { recursive: true, force: true });
  }
});

test("production startup requires independent strong document and resource secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "guangfa-production-secrets-"));
  const distDir = path.join(root, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "ok", "utf8");
  const names = ["API_AUTH_MODE", "API_AUTH_BEARER_TOKENS", "API_AUTH_API_KEYS", "ONLYOFFICE_JWT_SECRET", "API_CAPABILITY_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.API_AUTH_MODE = "required";
  process.env.API_AUTH_BEARER_TOKENS = JSON.stringify({
    "a-production-test-token-that-is-at-least-32-bytes": { id: "admin", roles: ["admin"] },
  });
  delete process.env.API_AUTH_API_KEYS;
  process.env.ONLYOFFICE_JWT_SECRET = "an-onlyoffice-secret-that-is-at-least-32-bytes";
  delete process.env.API_CAPABILITY_SECRET;
  try {
    await assert.rejects(startProductionServer({ rootDir: root, distDir }), /API_CAPABILITY_SECRET/);
    process.env.API_CAPABILITY_SECRET = "short";
    await assert.rejects(startProductionServer({ rootDir: root, distDir }), /API_CAPABILITY_SECRET.*32/);
    process.env.API_CAPABILITY_SECRET = process.env.ONLYOFFICE_JWT_SECRET;
    await assert.rejects(startProductionServer({ rootDir: root, distDir }), /必须相互独立/);
    process.env.API_CAPABILITY_SECRET = "an-independent-capability-secret-that-is-at-least-32-bytes";
    process.env.ONLYOFFICE_JWT_SECRET = "a-production-test-token-that-is-at-least-32-bytes";
    await assert.rejects(startProductionServer({ rootDir: root, distDir }), /必须相互独立/);
  } finally {
    names.forEach((name) => {
      if (previous[name] == null) delete process.env[name];
      else process.env[name] = previous[name];
    });
    await rm(root, { recursive: true, force: true });
  }
});

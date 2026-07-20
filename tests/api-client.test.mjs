import assert from "node:assert/strict";
import test from "node:test";

test("a stale 401 cannot clear a newer API credential", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const storage = new Map();
  const events = [];
  globalThis.window = {
    location: { origin: "http://127.0.0.1:5173" },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };

  try {
    const api = await import(`../src/services/apiClient.js?stale-401=${Date.now()}`);
    let resolveOldRequest;
    globalThis.fetch = () => new Promise((resolve) => { resolveOldRequest = resolve; });
    api.setApiAccessToken("old-token");
    const oldRequest = api.apiRequest("/api/templates");
    api.setApiAccessToken("new-token");
    resolveOldRequest(unauthorizedResponse());
    await assert.rejects(oldRequest, (error) => error.status === 401);
    assert.equal(api.getApiAccessToken(), "new-token");
    assert.equal(events.length, 0);

    globalThis.fetch = async () => unauthorizedResponse();
    await assert.rejects(api.apiRequest("/api/templates"), (error) => error.status === 401);
    assert.equal(api.getApiAccessToken(), "");
    assert.equal(events.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

function unauthorizedResponse() {
  return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "expired" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

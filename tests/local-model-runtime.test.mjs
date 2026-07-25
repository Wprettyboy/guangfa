import assert from "node:assert/strict";
import test from "node:test";
import { isManagedLocalModelRuntime } from "../server/ai/local-model-runtime.js";

test("local Qwen autostart only manages the configured Windows runtime", () => {
  assert.equal(isManagedLocalModelRuntime({
    baseUrl: "http://127.0.0.1:8129/v1",
    model: "qwen3.6-35b-a3b",
  }), true);
  assert.equal(isManagedLocalModelRuntime({
    baseUrl: "http://localhost:8129/v1/",
    model: "QWEN3.6-35B-A3B",
  }), true);
  assert.equal(isManagedLocalModelRuntime({
    baseUrl: "http://127.0.0.1:9000/v1",
    model: "qwen3.6-35b-a3b",
  }), false);
  assert.equal(isManagedLocalModelRuntime({
    baseUrl: "http://127.0.0.1:8129/v1",
    model: "another-model",
  }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createFillTaskController } from "../src/features/fill/useFillTaskController.js";

test("fill task controller invalidates the previous run", () => {
  const controller = createFillTaskController();
  const first = controller.startRun();
  const second = controller.startRun();

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(controller.isCurrentRun(first), false);
  assert.equal(controller.isCurrentRun(second), true);

  assert.equal(controller.cancelRun(), true);
  assert.equal(second.controller.signal.aborted, true);
  assert.equal(controller.isCurrentRun(second), false);
  assert.equal(controller.finishRun(second), false);
});

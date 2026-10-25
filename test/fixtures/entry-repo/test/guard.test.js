import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPermission } from "../src/guard.js";

test("rejects empty token", () => {
  assert.throws(() => checkPermission(""));
});

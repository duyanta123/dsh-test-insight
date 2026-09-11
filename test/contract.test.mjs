import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGaps } from "../src/index.mjs";
import { main } from "../scripts/cli.mjs";

function io() {
  let stdout = "";
  let stderr = "";
  return {
	io: {
	  stdout: { write(value) { stdout += value; } },
	  stderr: { write(value) { stderr += value; } },
	},
	get stdout() { return stdout; },
	get stderr() { return stderr; },
  };
}

test("comment-only change is not a high-priority test gap", () => {
  const report = {
	files: [{ path: "src/a.js", kind: "source" }],
	_files: [{ path: "src/a.js", _text: "export function a() {}" }],
	entry_points: [],
	symbols: [],
	dependencies: { internal: [], external: [] },
	risks: [],
	limits: { truncated: false, warnings: [] },
  };
  const mapping = { mappings: [], source_files_without_tests: ["src/a.js"] };
  const facts = {
	changed_files: [{ new_path: "src/a.js", status: "modified", hunks: [{ lines: ["+// formatting note", "+"] }] }],
	impacted_files: [],
  };
  const gaps = buildGaps(report, mapping, { mode: "change", maxPropagation: 3 }, facts);
  const gap = gaps.find((item) => item.type === "changed_without_test_change");
  assert.equal(gap.priority, "P2");
  assert.equal(gap.confidence, "low");
});

test("CLI returns documented invalid-input exit code", async () => {
  const capture = io();
  const code = await main([".", "--mode", "target"], capture.io);
  assert.equal(code, 2);
  assert.match(capture.stderr, /requires at least one --target/);
});

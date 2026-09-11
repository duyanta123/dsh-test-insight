import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEvidence,
  buildGaps,
  buildRiskAnalysis,
  buildTargets,
  pruneChangeFacts,
} from "../src/index.mjs";

function reportFixture() {
  return {
	files: [
	  { path: "src/auth.js", kind: "source", language: "javascript" },
	  { path: "src/untested.js", kind: "source", language: "javascript" },
	  { path: "src/auth.test.js", kind: "test", language: "javascript" },
	  { path: "src/cli.js", kind: "source", language: "javascript" },
	],
	_files: [
	  { path: "src/auth.js", _text: "export function authenticate(value) { if (!value) throw new Error('missing'); }" },
		{ path: "src/untested.js", _text: "export function parse(value) { if (value == null) throw new Error('missing'); }" },
	  { path: "src/cli.js", _text: "export function main() {}" },
	],
	entry_points: [{ type: "cli", path: "src/cli.js", confidence: "high" }],
	symbols: [
	  { name: "authenticate", path: "src/auth.js", visibility: "exported" },
	  { name: "parse", path: "src/untested.js", visibility: "exported" },
	],
	dependencies: { internal: [], external: [] },
	risks: [],
	limits: { truncated: false, warnings: [] },
	graphs: null,
  };
}

const mapping = {
  mappings: [{ test_file: "src/auth.test.js", target_file: "src/auth.js", kind: "dependency", evidence_level: "B" }],
  orphan_tests: [],
  module_coverage: [],
  source_files_without_tests: ["src/untested.js", "src/cli.js"],
};

test("prunes scanner propagation without exceeding the official depth cap", () => {
  const facts = {
	changed_files: [{ new_path: "src/auth.js" }],
	impacted_files: [
	  { path: "src/one.js", via: "src/auth.js", depth: 1 },
	  { path: "src/two.js", via: "src/one.js", depth: 2 },
	  { path: "src/three.js", via: "src/two.js", depth: 3 },
	],
	impacted_modules: [],
	warnings: [],
  };
  const pruned = pruneChangeFacts(facts, 1);
  assert.deepEqual(pruned.impacted_files.map((item) => item.path), ["src/one.js"]);
  assert.ok(pruned.warnings.some((warning) => warning.includes("max_propagation=1")));
});

test("builds evidence and high-priority change gaps deterministically", () => {
  const report = reportFixture();
	const changeFacts = {
	changed_files: [{ status: "modified", new_path: "src/untested.js" }],
	impacted_files: [],
	impacted_modules: [],
	impacted_symbols: [],
	warnings: [],
  };
  const evidence = buildEvidence(report, mapping, { changeFacts });
  assert.equal(evidence.find((item) => item.target_file === "src/auth.js" && item.type === "dependency").level, "B");
  const gaps = buildGaps(report, mapping, { mode: "change", maxPropagation: 3 }, changeFacts);
  assert.ok(gaps.some((gap) => gap.type === "changed_without_test_change" && gap.priority === "P0"));
  assert.ok(gaps.some((gap) => gap.type === "error_path_untested"));
});

test("sorts targets by risk and keeps source evidence boundaries", () => {
  const report = reportFixture();
  const changeFacts = {
	changed_files: [{ status: "modified", new_path: "src/untested.js" }],
	impacted_files: [],
	impacted_modules: [],
	impacted_symbols: [],
	warnings: [],
  };
  const result = buildRiskAnalysis(report, mapping, { mode: "change", maxPropagation: 3, maxTargets: 10 }, { changeFacts });
  assert.equal(result.targets[0].path, "src/untested.js");
  assert.equal(result.targets[0].priority, "P0");
  assert.ok(result.warnings.some((warning) => warning.includes("A 级")));
  assert.ok(result.gaps.every((gap) => ["P0", "P1", "P2"].includes(gap.priority)));
  assert.equal(buildTargets(report, mapping, { mode: "all", maxTargets: 1 }, null, []).length, 1);
});

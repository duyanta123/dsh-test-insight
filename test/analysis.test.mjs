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

function coverageFixture(percent, threshold) {
  const metricsFor = (path) => ({
	path,
	metrics: {
	  lines: { found: 10, hit: Math.round(percent / 10), percent },
	  branches: { found: 0, hit: 0, percent: null },
	  functions: { found: 0, hit: 0, percent: null },
	  statements: { found: 10, hit: Math.round(percent / 10), percent },
	},
  });
  return {
	format: "lcov",
	path: "lcov.info",
	threshold,
	files: [metricsFor("src/untested.js"), metricsFor("src/auth.js")],
	totals: { lines: { found: 20, hit: Math.round((percent / 10) * 2), percent }, branches: { found: 0, hit: 0, percent: null }, functions: { found: 0, hit: 0, percent: null }, statements: { found: 20, hit: Math.round((percent / 10) * 2), percent } },
	below_threshold: [],
	fresh: true,
  };
}

test("coverage below threshold gaps apply to impacted files, not only direct changes", () => {
  const report = reportFixture();
  const changeFacts = {
	changed_files: [{ status: "modified", new_path: "src/auth.js" }],
	impacted_files: [{ path: "src/untested.js", via: "src/auth.js", depth: 1 }],
	impacted_modules: [],
	impacted_symbols: [],
	warnings: [],
  };
  const input = { mode: "change", maxPropagation: 3 };
  const gaps = buildGaps(report, mapping, input, changeFacts, coverageFixture(50, 80));
  const impactedGap = gaps.find((gap) => gap.type === "coverage_below_threshold" && gap.target_path === "src/untested.js");
  assert.ok(impactedGap, "non-direct impacted file must produce a coverage gap");
  assert.equal(impactedGap.priority, "P2");
  const directGap = gaps.find((gap) => gap.type === "coverage_below_threshold" && gap.target_path === "src/auth.js");
  assert.ok(directGap, "directly changed file must produce a coverage gap");
  assert.equal(directGap.priority, "P1");
});

test("risk scoring includes reverse dependencies, cycles, and structural factors", () => {
  const report = reportFixture();
  report.files.push(
	{ path: "src/hub.js", kind: "source" },
	{ path: "src/one.js", kind: "source" },
	{ path: "src/two.js", kind: "source" },
	{ path: "src/big.js", kind: "source" },
	{ path: "src/cyc-a.js", kind: "source" },
	{ path: "src/cyc-b.js", kind: "source" },
  );
  report._files.push(
	{ path: "src/hub.js", _text: "export const hub = 1;" },
	{ path: "src/big.js", _text: "export const big = 1;" },
  );
  report.symbols.push(
	{ name: "hub", path: "src/hub.js", visibility: "exported" },
	{ name: "big", path: "src/big.js", kind: "function", start_line: 1, end_line: 120, visibility: "exported" },
	{ name: "ca", path: "src/cyc-a.js", visibility: "exported" },
	{ name: "cb", path: "src/cyc-b.js", visibility: "exported" },
  );
  report.dependencies = {
	internal: [
	  { source: "src/one.js", target: "src/hub.js" },
	  { source: "src/two.js", target: "src/hub.js" },
	  { source: "src/auth.js", target: "src/hub.js" },
	  { source: "src/cyc-a.js", target: "src/cyc-b.js" },
	  { source: "src/cyc-b.js", target: "src/cyc-a.js" },
	],
	external: [],
  };
  const targets = buildTargets(report, mapping, { mode: "all", maxTargets: 50 }, null, []);
  const byPath = new Map(targets.map((target) => [target.path, target]));
  const hub = byPath.get("src/hub.js");
  assert.ok(hub.risk_factors.includes("reverse dependencies: 3 modules"), JSON.stringify(hub.risk_factors));
  const cycleA = byPath.get("src/cyc-a.js");
  assert.ok(cycleA.risk_factors.includes("dependency cycle"), JSON.stringify(cycleA.risk_factors));
  const big = byPath.get("src/big.js");
  assert.ok(big.risk_factors.some((factor) => factor.startsWith("long function (")) , JSON.stringify(big.risk_factors));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  buildCoverageEvidence,
  buildTestMatrix,
  parseCoverageText,
  readCoverage,
  normalizeInput,
} from "../src/index.mjs";

const fixtureRoot = path.resolve("test/fixtures/coverage");

async function fixture(name) {
  return readFile(path.join(fixtureRoot, name), "utf8");
}

test("parses lcov with line and branch details and emits A evidence", async () => {
  const coverage = parseCoverageText(await fixture("lcov.info"), {
	repoPath: ".",
	filePath: "lcov.info",
	format: "lcov",
	threshold: 80,
  });
  assert.equal(coverage.format, "lcov");
	assert.ok(Math.abs(coverage.files[0].metrics.lines.percent - 66.66666666666666) < 0.000001);
  assert.equal(coverage.files[0].metrics.branches.percent, 50);
  assert.equal(buildCoverageEvidence(coverage)[0].level, "A");
  assert.equal(coverage.below_threshold.length, 2);
});

test("parses Istanbul final and summary formats", async () => {
  const final = parseCoverageText(await fixture("coverage-final.json"), {
	repoPath: ".",
	filePath: "coverage-final.json",
  });
  const summary = parseCoverageText(await fixture("coverage-summary.json"), {
	repoPath: ".",
	filePath: "coverage-summary.json",
  });
  assert.equal(final.format, "istanbul-final");
  assert.equal(final.files[0].metrics.statements.percent, 50);
  assert.equal(summary.format, "istanbul-summary");
  assert.equal(summary.files[0].metrics.branches.percent, 50);
});

test("parses Cobertura and associates matrix rows with real coverage", async () => {
  const coverage = parseCoverageText(await fixture("cobertura.xml"), {
	repoPath: ".",
	filePath: "cobertura.xml",
	format: "cobertura",
  });
  const report = { files: [{ path: "src/auth.js", kind: "source" }], entry_points: [] };
  const mapping = { mappings: [{ test_file: "src/auth.test.js", target_file: "src/auth.js", evidence_level: "B" }] };
  const matrix = buildTestMatrix(report, mapping, coverage);
  assert.equal(coverage.files[0].metrics.lines.percent, 50);
  assert.equal(matrix[0].categories.happy_path, "coverage_below_threshold");
});

test("rejects unsupported and malformed coverage without guessing", () => {
  assert.throws(() => parseCoverageText("whatever", { filePath: "coverage.txt" }), /unsupported coverage format/);
  assert.throws(() => parseCoverageText("{", { filePath: "coverage-final.json" }), (error) => error.code === "INVALID_COVERAGE");
});

test("normalizes v0.2 coverage input while preserving default read-only execution", () => {
  const input = normalizeInput({ repoPath: ".", mode: "all", coveragePath: "coverage-final.json", coverageThreshold: 80 });
  assert.equal(input.coverage.path, "coverage-final.json");
  assert.equal(input.coverage.threshold, 80);
  assert.equal(input.execution.authorized, false);
});

test("readCoverage resolves coverage relative to repository", async () => {
  const input = normalizeInput({ repoPath: fixtureRoot, mode: "all", coveragePath: "lcov.info" });
  const coverage = await readCoverage(input);
  assert.equal(coverage.files[0].path, "src/auth.js");
});

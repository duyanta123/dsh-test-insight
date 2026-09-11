import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTestMapping,
  scanWithAdapter,
  getTestFactsWithAdapter,
  validateFacts,
  validateScannerReport,
} from "../src/index.mjs";

const repoPath = new URL("./fixtures/adapter-repo/", import.meta.url);
const repo = decodeURIComponent(repoPath.pathname.replace(/^\//, "").replace(/^([A-Za-z]):\//, "$1:/"));

function scanInput(mode = "all") {
  return {
	repoPath: repo,
	mode,
	scanner: { cache: false, maxDepth: 5, maxFiles: 100, maxFileBytes: 10000, perfBudgetMs: 60000 },
  };
}

test("scanner adapter validates the installed report contract", async () => {
  const report = await scanWithAdapter(scanInput());
  assert.equal(report.schema_version, "1.0");
  assert.equal(report.analysis_schema.name, "dsh-analysis-schema");
  assert.equal(report.tool.name, "dsh-repo-scanner");
  assert.ok(report.tool.version);
  assert.ok(report.files.some((file) => file.path === "src/auth.js"));
  assert.ok(report.symbols.some((symbol) => symbol.name === "authenticate"));
  assert.throws(() => validateScannerReport({}), /schema failed|schema_version|analysis_schema/);
});

test("scanner facts and mapping retain high-confidence file evidence", async () => {
  const input = scanInput();
  const [report, facts] = await Promise.all([scanWithAdapter(input), getTestFactsWithAdapter(input)]);
  validateFacts(facts, "test insight");
  const mapping = buildTestMapping(report, facts);
  assert.equal(mapping.orphan_tests.length, 0);
  assert.deepEqual(mapping.mappings.map((item) => item.target_file), ["src/auth.js", "src/server.js"]);
	assert.ok(mapping.mappings.every((item) => item.evidence_level === "B"));
  assert.ok(mapping.source_files_without_tests.length === 0);
});

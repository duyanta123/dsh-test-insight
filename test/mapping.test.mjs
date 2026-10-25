import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildTestMapping,
  detectTestFrameworks,
  scanWithAdapter,
  getTestFactsWithAdapter,
} from "../src/index.mjs";

const pythonRepo = fileURLToPath(new URL("./fixtures/python-repo/", import.meta.url));
const goRepo = fileURLToPath(new URL("./fixtures/go-repo/", import.meta.url));
const entryRepo = fileURLToPath(new URL("./fixtures/entry-repo/", import.meta.url));

function scanInput(repo, mode = "all") {
  return {
    repoPath: repo,
    mode,
    scanner: { cache: false, maxDepth: 5, maxFiles: 100, maxFileBytes: 10000, perfBudgetMs: 60000 },
  };
}

test("python fixture maps test_*.py to sources with import evidence", async () => {
  const input = scanInput(pythonRepo);
  const [report, facts] = await Promise.all([scanWithAdapter(input), getTestFactsWithAdapter(input)]);
  const mapping = buildTestMapping(report, facts);
  assert.deepEqual(mapping.orphan_tests, ["tests/test_missing_module.py"]);
  const byTarget = new Map(mapping.mappings.map((item) => [item.target_file, item]));
  assert.equal(byTarget.get("auth.py")?.test_file, "test_auth.py");
  assert.equal(byTarget.get("auth.py")?.evidence_level, "B");
  assert.equal(byTarget.get("service/convert.py")?.test_file, "tests/test_convert.py");
  assert.equal(byTarget.get("service/convert.py")?.evidence_level, "B");
  assert.equal(mapping.source_files_without_tests.length, 0);
});

test("go fixture maps *_test.go conventions the scanner classifies as source", async () => {
  const input = scanInput(goRepo);
  const report = await scanWithAdapter(input);
  // Baseline check: the scanner itself reports the Go test files as source.
  assert.ok(report.files.some((file) => file.path === "math/sum_test.go" && file.kind === "source"));
  const facts = await getTestFactsWithAdapter(input);
  const mapping = buildTestMapping(report, facts);
  const byTarget = new Map(mapping.mappings.map((item) => [item.target_file, item]));
  assert.equal(byTarget.get("math/sum.go")?.test_file, "math/sum_test.go");
  assert.equal(byTarget.get("math/sum.go")?.evidence_level, "C");
  assert.equal(byTarget.get("math/sum.go")?.recognition?.source, "filename convention: *_test.go");
  assert.equal(byTarget.get("internal/auth/verify.go")?.test_file, "internal/auth/verify_test.go");
  assert.ok(mapping.mappings.every((item) => !/_test\.go$/.test(item.target_file)));
  assert.equal(mapping.source_files_without_tests.length, 0);
  assert.equal(mapping.orphan_tests.length, 0);
});

test("entry fixture maps the imported test and keeps entries/run_methods facts", async () => {
  const input = scanInput(entryRepo);
  const report = await scanWithAdapter(input);
  const mapping = buildTestMapping(report, await getTestFactsWithAdapter(input));
  assert.ok(mapping.mappings.some((item) => item.test_file === "test/guard.test.js" && item.target_file === "src/guard.js" && item.evidence_level === "B"));
  assert.ok(report.entry_points.some((entry) => entry.type === "cli" && entry.path === "bin/cli.js"));
  assert.ok(report.entry_points.some((entry) => entry.type === "web" && entry.path === "src/gateway.js"));
  assert.ok(report.run_methods.some((method) => method.command === "node --test test/"));
});

test("mirror-path tests map at evidence level C without imports", () => {
  const report = {
    files: [
      { path: "src/auth/gateway.js", kind: "source", language: "javascript" },
      { path: "tests/src/auth/gateway.test.js", kind: "test", language: "javascript" },
    ],
    dependencies: { internal: [], external: [] },
    graphs: null,
    modules: [],
  };
  const mapping = buildTestMapping(report);
  assert.equal(mapping.mappings.length, 1);
  assert.equal(mapping.mappings[0].kind, "mirror");
  assert.equal(mapping.mappings[0].evidence_level, "C");
  assert.equal(mapping.mappings[0].confidence, "medium");
  assert.equal(mapping.mappings[0].same_directory, false);
  assert.equal(mapping.source_files_without_tests.length, 0);
});

// The scanner's TEST_DIR_NAMES includes "integration-test"; the mirror roots
// must stay aligned or those tests fall through to weaker name-level mapping.
test("integration-test root mirrors like other scanner test roots", () => {
  const report = {
    files: [
      { path: "src/auth/gateway.js", kind: "source", language: "javascript" },
      { path: "integration-test/src/auth/gateway.test.js", kind: "test", language: "javascript" },
    ],
    dependencies: { internal: [], external: [] },
    graphs: null,
    modules: [],
  };
  const mapping = buildTestMapping(report);
  assert.equal(mapping.mappings.length, 1);
  assert.equal(mapping.mappings[0].kind, "mirror");
  assert.equal(mapping.mappings[0].evidence_level, "C");
  assert.equal(mapping.mappings[0].target_file, "src/auth/gateway.js");
});

test("name containment maps uniquely at low confidence and refuses ambiguity", () => {
  const unique = {
    files: [
      { path: "src/user.js", kind: "source" },
      { path: "tests/user-service.test.js", kind: "test" },
    ],
    dependencies: { internal: [], external: [] },
    graphs: null,
    modules: [],
  };
  const mapping = buildTestMapping(unique);
  assert.equal(mapping.mappings[0].kind, "name");
  assert.equal(mapping.mappings[0].confidence, "low");
  assert.equal(mapping.mappings[0].evidence_level, "D");

  const ambiguous = {
    files: [
      { path: "src/user.js", kind: "source" },
      { path: "src/profile.js", kind: "source" },
      { path: "tests/user-profile.test.js", kind: "test" },
    ],
    dependencies: { internal: [], external: [] },
    graphs: null,
    modules: [],
  };
  const refused = buildTestMapping(ambiguous);
  assert.deepEqual(refused.mappings, []);
  assert.deepEqual(refused.orphan_tests, ["tests/user-profile.test.js"]);
});

test("framework detection keeps source and confidence per plan §5.2", async () => {
  const entryReport = await scanWithAdapter(scanInput(entryRepo));
  const nodeFrameworks = detectTestFrameworks(entryReport);
  assert.ok(nodeFrameworks.frameworks.some((item) => item.name === "node-test" && item.confidence === "low"));
  assert.ok(nodeFrameworks.commands.some((item) => item.command === "node --test test/" && item.source === "scanner:run_methods:test" && item.confidence === "high"));

  const pythonReport = await scanWithAdapter(scanInput(pythonRepo));
  const pythonFrameworks = detectTestFrameworks(pythonReport);
  const pytest = pythonFrameworks.frameworks.find((item) => item.name === "pytest");
  assert.equal(pytest.source, "filename convention: test_*.py / *_test.py");
  assert.equal(pytest.confidence, "medium");
  assert.ok(pythonFrameworks.commands.some((item) => item.command === "pytest" && item.source === "framework-default:pytest"));

  const goReport = await scanWithAdapter(scanInput(goRepo));
  const goFrameworks = detectTestFrameworks(goReport);
  const goTesting = goFrameworks.frameworks.find((item) => item.name === "go-testing");
  assert.equal(goTesting.source, "filename convention: *_test.go");
  assert.equal(goTesting.confidence, "high");
  assert.ok(goFrameworks.commands.some((item) => item.command === "go test ./..."));

  const jestReport = { files: [{ path: "jest.config.js", kind: "config" }, { path: "src/a.test.js", kind: "test" }] };
  const jestFrameworks = detectTestFrameworks(jestReport);
  assert.equal(jestFrameworks.frameworks[0].name, "jest");
  assert.equal(jestFrameworks.frameworks[0].confidence, "high");
  assert.ok(!jestFrameworks.frameworks.some((item) => item.name === "node-test"));
});

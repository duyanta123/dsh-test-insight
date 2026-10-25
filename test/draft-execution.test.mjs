import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AUTHORIZED_COMMAND_PRESETS,
  InsightError,
  analyze,
  buildDrafts,
  collectDraftContext,
  executeAuthorizedTests,
  normalizeAuthorizedCommand,
  writeDraftObjects,
} from "../src/index.mjs";
import { parseArgs, validateArgs } from "../scripts/cli.mjs";

function reportFixture() {
  return {
	files: [{ path: "src/auth.js", kind: "source", language: "javascript" }],
	targets: [{ path: "src/auth.js", priority: "P0", confidence: "high", risk_factors: ["changed"] }],
  };
}

test("builds isolated review-only drafts without claiming execution", () => {
  const drafts = buildDrafts(reportFixture(), { repoPath: path.resolve("fixture"), draftOutputPath: path.resolve("drafts") });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].status, "draft_only");
  assert.equal(drafts[0].review_required, true);
  assert.match(drafts[0].content, /NOT EXECUTED OR VERIFIED/);
  assert.equal(drafts[0].syntax.status, "heuristic_pass");
  assert.match(drafts[0].path, /drafts/);
});

test("generates language-specific drafts and leaves unsupported syntax unverified", () => {
  const report = {
	files: [
	  { path: "src/service.py", kind: "source", language: "python" },
	  { path: "src/service.go", kind: "source", language: "go" },
	  { path: "src/service.rb", kind: "source", language: "ruby" },
	],
	targets: [
	  { path: "src/service.py", priority: "P1", confidence: "medium", risk_factors: [] },
	  { path: "src/service.go", priority: "P1", confidence: "medium", risk_factors: [] },
	  { path: "src/service.rb", priority: "P2", confidence: "low", risk_factors: [] },
	],
  };
  const drafts = buildDrafts(report, { repoPath: path.resolve("fixture"), draftOutputPath: path.resolve("drafts") });
  assert.deepEqual(drafts.map((draft) => path.extname(draft.path)), [".py", ".go", ".txt"]);
  assert.equal(drafts[0].syntax.status, "unverified");
  assert.equal(drafts[1].syntax.status, "unverified");
  assert.equal(drafts[2].syntax.status, "unverified");
  assert.match(drafts[0].content, /REVIEW REQUIRED/);
	assert.match(drafts[1].content, /NOT EXECUTED OR VERIFIED/);
});

test("terminates an authorized command at the configured timeout", async () => {
  // The suite itself runs under node:test, so this spawn inherits
  // NODE_TEST_CONTEXT; executeAuthorizedTests must strip the marker, or the
  // `node --test` child skips its files and exits 0 without running anything.
  // Additionally, `node --test` occasionally exits 0 without waiting for its
  // test-file child on loaded CI runners, which makes a single spawn
  // inconclusive (regression of 2b8ab2e lost in de6d90c): retry so a green run
  // still exercises the kill path, and surface child output if every attempt
  // degrades.
  let result;
  let attempts = 0;
  while (attempts < 5) {
	attempts += 1;
	result = await executeAuthorizedTests({
	  repoPath: path.resolve("test/fixtures/execution"),
	  command: ["node", "--test", "slow.test.mjs"],
	  authorized: true,
	  timeoutMs: 250,
	  maxOutputBytes: 4096,
	});
	if (result.status === "timed_out") break;
	await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(result.status === "timed_out", `status=${result.status} attempts=${attempts} elapsed_ms=${result.elapsed_ms} exit=${result.exit_code} signal=${result.signal} stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`);
  assert.equal(result.timed_out, true);
});

test("draft writer refuses existing files and preserves FS_NOT_OBSERVED", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-draft-"));
  try {
	const input = { repoPath: directory, force: false };
	const drafts = buildDrafts(reportFixture(), { ...input, draftOutputPath: directory });
	await writeDraftObjects(drafts, input);
	await assert.rejects(() => writeDraftObjects(drafts, input), /draft exists/);
	const observed = new InsightError("host did not observe write", { code: "FS_NOT_OBSERVED" });
	await assert.rejects(() => writeDraftObjects(drafts, input, { observedWrite: async () => { throw observed; } }), (error) => error === observed);
	assert.match(await readFile(drafts[0].path, "utf8"), /DRAFT ONLY/);
  } finally {
	await rm(directory, { recursive: true, force: true });
  }
});

test("execution requires explicit authorization and rejects shell injection", async () => {
  assert.deepEqual(normalizeAuthorizedCommand("npm-test"), AUTHORIZED_COMMAND_PRESETS["npm-test"]);
  assert.throws(() => normalizeAuthorizedCommand("npm test && del everything"), (error) => error.code === "EXECUTION_NOT_AUTHORIZED");
  await assert.rejects(() => executeAuthorizedTests({ repoPath: ".", command: "node-test", authorized: false }), (error) => error.code === "EXECUTION_NOT_AUTHORIZED");
});

test("executes only allowlisted commands with bounded output", async () => {
  const result = await executeAuthorizedTests({
	repoPath: ".",
	command: ["node", "--test", "test/does-not-exist.test.mjs"],
	authorized: true,
	timeoutMs: 30_000,
	maxOutputBytes: 4096,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.command[0], "node");
  assert.equal(result.output_truncated, false);
});

test("does not allow node test paths outside the repository and redacts command values", async () => {
  await assert.rejects(() => executeAuthorizedTests({
	repoPath: path.resolve("test/fixtures/execution"),
	command: ["node", "--test", "../../package.json"],
	authorized: true,
  }), (error) => error.code === "EXECUTION_NOT_AUTHORIZED");

  const result = await executeAuthorizedTests({
	repoPath: ".",
	command: ["node", "--test", "test/does-not-exist.test.mjs"],
	authorized: true,
	maxOutputBytes: 4096,
  });
  assert.equal(result.command[0], "node");
  assert.ok(!JSON.stringify(result).includes("password=hidden"));
});

test("CLI requires explicit command with explicit execution flag", () => {
  const options = parseArgs([".", "--mode", "all", "--execute-tests"]);
  assert.ok(validateArgs(options).some((message) => message.includes("requires --test-command")));
  const valid = parseArgs([".", "--mode", "all", "--execute-tests", "--test-command", "npm-test"]);
  assert.deepEqual(validateArgs(valid), []);
});

// Plan §7.3: drafts must be generated after reading the project manifest, at
// least one adjacent test file, framework conventions, and the target's export
// style — with the evidence source kept visible instead of guessed.
test("draft generation reads manifest, adjacent test, framework, and export style", async () => {
  const entryRepo = path.resolve("test/fixtures/entry-repo");
  const report = {
	files: [
	  { path: "src/guard.js", kind: "source", language: "javascript" },
	  { path: "test/guard.test.js", kind: "test", language: "javascript" },
	],
	targets: [{ path: "src/guard.js", priority: "P1", confidence: "medium", risk_factors: [] }],
	run_methods: [{ name: "test", command: "node --test test/", source: "package.json", type: "script" }],
  };
  const mapping = { mappings: [{ test_file: "test/guard.test.js", target_file: "src/guard.js", evidence_level: "B" }] };
  const context = await collectDraftContext(report, { repoPath: entryRepo }, mapping);
  assert.equal(context.manifest.path, "package.json");
  assert.equal(context.manifest.test_script, "node --test test/");
  assert.ok(context.frameworks.frameworks.length > 0);
  assert.equal(context.adjacentByTarget.get("src/guard.js").test_file, "test/guard.test.js");
  assert.match(context.adjacentByTarget.get("src/guard.js").excerpt, /checkPermission/);
  assert.equal(context.exportStyleByTarget.get("src/guard.js"), "esm");

  const drafts = buildDrafts(report, { repoPath: entryRepo, draftOutputPath: path.resolve("drafts") }, context);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].context.manifest.path, "package.json");
  assert.equal(drafts[0].context.adjacent_test, "test/guard.test.js");
  assert.equal(drafts[0].context.export_style, "esm");
  assert.ok(drafts[0].context.framework);
  assert.match(drafts[0].content, /Framework hint:/);
  assert.match(drafts[0].content, /Adjacent test for style: test\/guard.test.js/);
});

test("draft context reading degrades to nulls without throwing", async () => {
  const report = { files: [{ path: "src/ghost.js", kind: "source", language: "javascript" }], targets: [{ path: "src/ghost.js", priority: "P2", confidence: "low", risk_factors: [] }] };
  const context = await collectDraftContext(report, { repoPath: path.resolve("test/fixtures/execution") });
  assert.equal(context.manifest, null);
  assert.equal(context.adjacentByTarget.get("src/ghost.js").test_file, null);
  assert.equal(context.exportStyleByTarget.get("src/ghost.js"), "unknown");
});

// Regression lock: engine.analyze() must feed collectDraftContext the report
// with merged targets (the same object buildDrafts sees), not the raw scanner
// report — the raw report has no targets, so every draft's adjacent_test would
// be null and export_style "unknown". The unit tests above call
// buildDrafts/collectDraftContext directly and bypass the engine, which is how
// that breakage stayed invisible; this one walks the full analyze() pipeline.
test("analyze() fills draft context end to end through the engine pipeline", async () => {
  const entryRepo = path.resolve("test/fixtures/entry-repo");
  const result = await analyze({
    repoPath: entryRepo,
    mode: "target",
    targets: ["src/guard.js"],
    generateDrafts: true,
    scanner: { cache: false, maxDepth: 5, maxFiles: 100, maxFileBytes: 10000, perfBudgetMs: 60000 },
  });
  assert.equal(result.analysis.targets.length, 1);
  assert.equal(result.analysis.targets[0].path, "src/guard.js");
  const draft = result.analysis.drafts.find((item) => item.target === "src/guard.js");
  assert.ok(draft, "target-mode draft for src/guard.js must exist");
  assert.equal(draft.context.manifest.path, "package.json");
  assert.equal(draft.context.manifest.test_script, "node --test test/");
  assert.equal(draft.context.adjacent_test, "test/guard.test.js");
  assert.equal(draft.context.export_style, "esm");
  assert.ok(draft.context.framework, "framework hint must be detected from scanner facts");
  assert.match(draft.content, /Adjacent test for style: test\/guard\.test\.js/);
  assert.match(draft.content, /Target export style: esm/);
});

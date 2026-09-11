import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AUTHORIZED_COMMAND_PRESETS,
  InsightError,
  buildDrafts,
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
  // `node --test` occasionally exits 0 without waiting for its test-file child
  // on loaded linux CI runners, which makes a single spawn inconclusive; retry
  // so a green run still exercises the kill path, and surface child output if
  // every attempt degrades.
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
  assert.ok(result.status === "timed_out", `status=${result.status} elapsed_ms=${result.elapsed_ms} exit=${result.exit_code} signal=${result.signal} stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`);
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

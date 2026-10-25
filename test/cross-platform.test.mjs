import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { analyze, normalizeInput } from "../src/index.mjs";

const adapterRepo = path.resolve("test/fixtures/adapter-repo");

async function makeRepo(dir, { crlf = false, bom = false } = {}) {
  await mkdir(path.join(dir, "src"), { recursive: true });
  const eol = crlf ? "\r\n" : "\n";
  await writeFile(path.join(dir, "src", "calc.js"), (bom ? "\uFEFF" : "") + ["export function calc(x) {", "  if (x == null) throw new Error(\"missing\");", "  return x * 2;", "}", ""].join(eol));
  await writeFile(path.join(dir, "src", "calc.test.js"), ["import { calc } from \"./calc.js\";", "import test from \"node:test\";", "test(\"calc\", () => {});", ""].join(eol));
  return dir;
}

test("CRLF line endings do not break import mapping", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-xf-crlf-"));
  try {
	await makeRepo(dir, { crlf: true });
	const result = await analyze({ repoPath: dir, mode: "all", scanner: { cache: false } });
	assert.ok(result.mapping.mappings.some((item) => item.test_file === "src/calc.test.js" && item.target_file === "src/calc.js" && item.evidence_level === "B"));
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("UTF-8 BOM source files are still parsed and mapped", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-xf-bom-"));
  try {
	await makeRepo(dir, { bom: true });
	const result = await analyze({ repoPath: dir, mode: "all", scanner: { cache: false } });
	assert.ok(result.mapping.mappings.some((item) => item.target_file === "src/calc.js"));
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("repository paths containing spaces analyze end to end", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh xf spaces -"));
  try {
	await makeRepo(dir);
	const result = await analyze({ repoPath: dir, mode: "all", scanner: { cache: false } });
	assert.ok(result.mapping.mappings.length >= 1);
	assert.equal(result.report.timing.performance.budget_exceeded, false);
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("repository paths containing non-ASCII characters analyze end to end", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-中文路径-"));
  try {
	await makeRepo(dir);
	const result = await analyze({ repoPath: dir, mode: "all", scanner: { cache: false } });
	assert.ok(result.mapping.mappings.some((item) => item.target_file === "src/calc.js"));
	assert.ok(result.report.scope.repo_path.includes("中文路径"));
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("drive-letter paths normalize to backslash form on Windows", { skip: process.platform !== "win32" ? "drive-letter semantics are Windows-only" : false }, () => {
  const input = normalizeInput({ repoPath: "D:/some/repo", mode: "all" });
  assert.match(input.repoPath, /^[A-Za-z]:\\/);
  assert.ok(!input.repoPath.includes("/"));

  const mixed = path.resolve("test/fixtures/adapter-repo").replaceAll("/", "\\");
  assert.equal(normalizeInput({ repoPath: mixed, mode: "all" }).repoPath, path.resolve("test/fixtures/adapter-repo"));
});

test("mixed-separator repository path analyzes on Windows", { skip: process.platform !== "win32" ? "separator semantics are Windows-only" : false }, async () => {
  const mixed = adapterRepo.replaceAll("/", "\\");
  const result = await analyze({ repoPath: mixed, mode: "all", scanner: { cache: false } });
  assert.ok(result.mapping.mappings.some((item) => item.target_file === "src/auth.js"));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function readJson(relativePath) {
  const content = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return JSON.parse(content);
}

test("package metadata is an ESM npm package", async () => {
  const packageJson = await readJson("../package.json");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.bin["dsh-test-insight"], "./scripts/test-insight.mjs");
  assert.equal(packageJson.dsh.bundle.patch, "./cordis.patch.yml");
});

test("plugin entry exposes release metadata and skills provider hook", async () => {
  const plugin = await import(new URL("../plugin/index.js", import.meta.url));
  assert.equal(plugin.name, "dsh-test-insight");
  assert.deepEqual(plugin.inject, ["skills"]);
	assert.equal(plugin.metadata.phase, 5);
	assert.equal(plugin.metadata.status, "release_candidate");
	assert.equal(typeof plugin.apply, "function");
});

test("plugin registers a config-supplied FileSystemSkillProvider without requiring the optional peer locally", async () => {
  const plugin = await import(new URL("../plugin/index.js", import.meta.url));
  let registered;
  let disposed = false;
  class FakeProvider {
	constructor(ctx, control, options) {
	  assert.equal(ctx.kind, "fake-host");
	  assert.equal(control.kind, "fake-control");
	  assert.equal(options.providerName, "dsh-test-insight");
	  assert.equal(options.includeDefaultRoots, false);
	  assert.match(options.customSkillDirs[0], /skills/);
	}
	async dispose() { disposed = true; }
  }
  const cleanups = [];
  plugin.apply({
	kind: "fake-host",
	skills: { registerProvider(factory) { registered = factory; } },
	effect(generatorFactory) { cleanups.push(generatorFactory()); },
  }, { FileSystemSkillProvider: FakeProvider });
  const provider = registered({ kind: "fake-control" });
  assert.ok(provider instanceof FakeProvider);
  for (const cleanup of cleanups) {
	const dispose = cleanup.next().value;
	await dispose();
  }
  assert.equal(disposed, true);
});

test("output schema has the current report contract fields", async () => {
  const schema = await readJson("../schema/test-insight.schema.json");
  assert.equal(schema.properties.schema_version.const, "1.0");
  assert.deepEqual(schema.required, [
	"schema_version",
	"tool",
	"input",
	"scope",
	"targets",
	"evidence",
	"gaps",
	"designs",
	"warnings",
	"limits",
	"timing",
	"coverage",
	"test_matrix",
	"drafts",
	"execution",
  ]);
});

test("scanner dependency exposes the planned facts API", async () => {
  const scanner = await import("dsh-repo-scanner/scanner");
  for (const name of ["scanRepository", "getTestInsightFacts", "getChangeImpactFacts"]) {
	assert.equal(typeof scanner[name], "function", `${name} must be exported`);
  }
});

assert.ok(root.endsWith("dsh-test-insight\\") || root.endsWith("dsh-test-insight/"));

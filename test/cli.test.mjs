import assert from "node:assert/strict";
import { test } from "node:test";
import { printHelp, parseArgs, validateArgs } from "../scripts/cli.mjs";

 test("parses repeatable targets and bounded options", () => {
  const options = parseArgs([".", "--mode", "target", "--target", "src/auth.ts:authenticate", "--target=src/server.ts", "--max-targets", "5", "--max-propagation=2", "--format", "json"]);
  assert.deepEqual(options.targets, [{ path: "src/auth.ts", symbol: "authenticate" }, "src/server.ts"]);
  assert.equal(options.maxTargets, "5");
  assert.equal(options.maxPropagation, "2");
  assert.deepEqual(validateArgs(options), []);
});

test("rejects unsafe change input combinations", () => {
  const options = parseArgs([".", "--mode", "change", "--working-tree", "--base", "main"]);
  assert.ok(validateArgs(options).some((message) => message.includes("cannot be combined")));
});

test("--all is a documented alias for --mode all", () => {
  const options = parseArgs([".", "--all"]);
  assert.equal(options.mode, "all");
  assert.deepEqual(validateArgs(options), []);
  let help = "";
  printHelp({ write(value) { help += value; } });
  assert.match(help, /--all\s+shortcut for --mode all/);
});

import fs from "node:fs/promises";
import path from "node:path";
import { redactString } from "./redaction.mjs";
import { ERROR_CODES, EXIT_CODES, InsightError } from "./errors.mjs";

const LANGUAGE_EXTENSIONS = Object.freeze({
  javascript: "js",
  typescript: "ts",
  python: "py",
  go: "go",
});

function metadataForDraft({ content, ...metadata }) {
  return metadata;
}

function safeName(value) {
  return String(value || "target")
	.replaceAll("\\", "/")
	.split("/")
	.pop()
	.replace(/[^a-zA-Z0-9._-]+/g, "-")
	.replace(/^[-.]+|[-.]+$/g, "") || "target";
}

function languageFor(target, report) {
  const file = report?.files?.find((item) => item.path === target.path);
  return file?.language || "unknown";
}

function draftForTarget(target, report, generatedAt) {
  const language = languageFor(target, report);
  const targetName = target.symbol ? `${target.path}:${target.symbol}` : target.path;
  const header = [
	"/*",
	" * dsh-test-insight generated test draft.",
	" * STATUS: DRAFT ONLY; NOT EXECUTED OR VERIFIED.",
	` * Generated: ${generatedAt}`,
	` * Target: ${redactString(targetName)}`,
	" * REVIEW REQUIRED: adjust imports, fixtures, environment variables, and assertions.",
	" */",
  ].join("\n");
  if (language === "python") {
	return [
	  `# dsh-test-insight generated test draft; NOT EXECUTED OR VERIFIED. Generated: ${generatedAt}`,
	  `# REVIEW REQUIRED: adjust imports, fixtures, environment variables, and assertions.`,
	  `# Target: ${redactString(targetName)}`,
	  "",
	  "def test_generated_behavior():",
	  "    # TODO: import the public API and replace this placeholder with reviewed assertions.",
	  "    raise NotImplementedError\n",
	].join("\n");
  }
  if (language === "go") {
	return [
	  `// dsh-test-insight generated test draft; NOT EXECUTED OR VERIFIED. Generated: ${generatedAt}`,
	  `// REVIEW REQUIRED: adjust imports, fixtures, environment variables, and assertions.`,
	  `// Target: ${redactString(targetName)}`,
	  "package draft",
	  "",
	  "import \"testing\"",
	  "",
	  "func TestGeneratedBehavior(t *testing.T) {",
	  "\t// TODO: call the public API and replace this placeholder with reviewed assertions.",
	  "\tt.Skip(\"draft only\")",
	  "}\n",
	].join("\n");
  }
  return [
	header,
	"",
	`test("${redactString(targetName)} - reviewed behavior", () => {`,
	"  // TODO: import the public API and replace placeholders with reviewed assertions.",
	"  throw new Error(\"draft only\");",
	"});\n",
	].join("\n");
}

function syntaxCheck(content, language) {
  if (["javascript", "typescript"].includes(language)) {
	let braces = 0;
	let parentheses = 0;
	let brackets = 0;
	for (const character of content) {
	  if (character === "{") braces += 1;
	  if (character === "}") braces -= 1;
	  if (character === "(") parentheses += 1;
	  if (character === ")") parentheses -= 1;
	  if (character === "[") brackets += 1;
	  if (character === "]") brackets -= 1;
	  if (braces < 0 || parentheses < 0 || brackets < 0) return { status: "invalid", reason: "unbalanced delimiters" };
	}
	return braces === 0 && parentheses === 0 && brackets === 0
	  ? { status: "heuristic_pass", reason: "in-process delimiter check only" }
	  : { status: "invalid", reason: "unbalanced delimiters" };
  }
  return { status: "unverified", reason: "no in-process parser is available for this language" };
}

function outputPathFor(target, report, input, index) {
  const language = languageFor(target, report);
  const extension = LANGUAGE_EXTENSIONS[language] || "txt";
	const root = input.draftOutputPath || path.join(input.repoPath, ".dsh", "test-insight", "drafts");
  return path.resolve(root, `${String(index + 1).padStart(2, "0")}-${safeName(target.path)}${target.symbol ? `-${safeName(target.symbol)}` : ""}.test.${extension}`);
}

async function exists(filePath) {
  try {
	await fs.access(filePath);
	return true;
  } catch {
	return false;
  }
}

async function atomicWriteDraft(filePath, content, force) {
  if (!force && await exists(filePath)) {
	throw new InsightError(`draft exists; use --force to overwrite: ${filePath}`, {
	  code: ERROR_CODES.INVALID_OUTPUT,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	  details: { path: filePath },
	});
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
	await fs.writeFile(temp, content, "utf8");
	await fs.rename(temp, filePath);
  } catch (error) {
	try { await fs.rm(temp, { force: true }); } catch {}
	throw new InsightError(`failed to write draft: ${filePath}`, {
	  code: ERROR_CODES.OUTPUT_FAILED,
	  exitCode: EXIT_CODES.CONTRACT_ERROR,
	  details: { path: filePath },
	  cause: error,
	});
  }
  return filePath;
}

export function buildDrafts(report, input) {
  const generatedAt = new Date().toISOString();
  const targets = report.targets || [];
  return targets.map((target, index) => {
	const language = languageFor(target, report);
	const content = draftForTarget(target, report, generatedAt);
	return {
	  target: target.symbol ? `${target.path}:${target.symbol}` : target.path,
	  path: outputPathFor(target, report, input, index),
	  language,
	  status: "draft_only",
	  review_required: true,
	  syntax: syntaxCheck(content, language),
	  content,
	};
  });
}

export async function writeDrafts(report, input) {
  const drafts = buildDrafts(report, input);
	return writeDraftObjects(drafts, input);
}

export async function writeDraftObjects(drafts, input, { observedWrite = null } = {}) {
  const written = [];
  for (const draft of drafts) {
	try {
	  const filePath = observedWrite
		? await observedWrite(draft.path, draft.content, { force: input.force })
		: await atomicWriteDraft(draft.path, draft.content, input.force);
	  written.push(filePath || draft.path);
	} catch (error) {
	  if (error?.code === ERROR_CODES.FS_NOT_OBSERVED || error?.code === "FS_NOT_OBSERVED") throw error;
	  throw error;
	}
  }
  return { drafts: drafts.map(metadataForDraft), written };
}

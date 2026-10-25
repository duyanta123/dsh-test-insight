import fs from "node:fs/promises";
import path from "node:path";
import { redactString } from "./redaction.mjs";
import { ERROR_CODES, EXIT_CODES, InsightError } from "./errors.mjs";
import { assertInsideRoot, assertNoSymbolicLink } from "./output-security.mjs";
import { detectTestFrameworks } from "./frameworks.mjs";

const LANGUAGE_EXTENSIONS = Object.freeze({
  javascript: "js",
  typescript: "ts",
  python: "py",
  go: "go",
});

const MANIFEST_CANDIDATES = Object.freeze(["package.json", "pyproject.toml", "go.mod", "requirements.txt", "Cargo.toml"]);
const CONTEXT_READ_LIMIT = 4000;

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

async function readHead(repoPath, relativePath, limit = CONTEXT_READ_LIMIT) {
  const absolute = path.resolve(repoPath, relativePath);
  return fs.readFile(absolute, "utf8").then((text) => text.slice(0, limit)).catch(() => null);
}

function detectExportStyle(text, language) {
  if (!text) return "unknown";
  if (language === "python") return /\bdef\s|\bclass\s/.test(text) ? "python" : "unknown";
  if (language === "go") return /\bfunc\s/.test(text) ? "go" : "unknown";
  if (/export\s+default|export\s+(async\s+)?(function|class|const|let|var)|export\s*\{/.test(text)) return "esm";
  if (/module\.exports|exports\.\w+\s*=/.test(text)) return "cjs";
  return "unknown";
}

// Plan §7.3: before generating a draft, read the project manifest, the test
// framework conventions, at least one adjacent test file, and the target's
// export style. All reads are best-effort; missing evidence becomes null and
// keeps its own source/confidence instead of being guessed.
export async function collectDraftContext(report, input, mapping = null) {
  const repoPath = input?.repoPath || ".";
  const frameworks = detectTestFrameworks(report);
  let manifest = null;
  for (const candidate of MANIFEST_CANDIDATES) {
	const text = await readHead(repoPath, candidate, 2000);
	if (text !== null) {
	  let testScript = null;
	  try {
		const parsed = JSON.parse(text);
		testScript = parsed?.scripts?.test || null;
	  } catch {}
	  manifest = { path: candidate, test_script: testScript ? redactString(testScript) : null };
	  break;
	}
  }
  const adjacentByTarget = new Map();
  // Context reads are I/O; cap them so pathological target lists stay bounded
  // (draft targets are already capped by max_targets, default 50).
  const contextTargets = (report?.targets || []).slice(0, 50);
  for (const target of contextTargets) {
	const mapped = (mapping?.mappings || []).find((item) => item.target_file === target.path);
	const adjacent = mapped?.test_file
	  || (report?.files || []).find((file) => file.kind === "test"
		&& path.dirname(file.path.replaceAll("\\", "/")) === path.dirname(target.path.replaceAll("\\", "/"))
		&& file.path !== target.path)?.path
	  || null;
	const style = adjacent ? await readHead(repoPath, adjacent) : null;
	adjacentByTarget.set(target.path, {
	  test_file: adjacent,
	  excerpt: style ? redactString(style.split("\n").slice(0, 12).join("\n")) : null,
	});
  }
  const exportStyleByTarget = new Map();
  for (const target of contextTargets) {
	const language = languageFor(target, report);
	const text = await readHead(repoPath, target.path);
	exportStyleByTarget.set(target.path, detectExportStyle(text, language));
  }
  return { manifest, frameworks, adjacentByTarget, exportStyleByTarget };
}

function draftForTarget(target, report, generatedAt, context = null) {
  const language = languageFor(target, report);
  const targetName = target.symbol ? `${target.path}:${target.symbol}` : target.path;
  const framework = context?.frameworks?.frameworks?.[0] || null;
  const adjacent = context?.adjacentByTarget?.get(target.path) || null;
  const exportStyle = context?.exportStyleByTarget?.get(target.path) || "unknown";
  const styleNotes = [
	framework ? `Framework hint: ${framework.name} (source: ${framework.source}, confidence: ${framework.confidence})` : "Framework hint: none detected; confirm the project framework manually.",
	adjacent?.test_file ? `Adjacent test for style: ${adjacent.test_file}` : "Adjacent test: none found; follow the project's existing test layout.",
	`Target export style: ${exportStyle}`,
	context?.manifest ? `Manifest: ${context.manifest.path}${context.manifest.test_script ? ` (test script: ${context.manifest.test_script})` : ""}` : "Manifest: not found.",
  ];
  const header = [
	"/*",
	" * dsh-test-insight generated test draft.",
	" * STATUS: DRAFT ONLY; NOT EXECUTED OR VERIFIED.",
	` * Generated: ${generatedAt}`,
	` * Target: ${redactString(targetName)}`,
	...styleNotes.map((note) => ` * ${note}`),
	" * REVIEW REQUIRED: adjust imports, fixtures, environment variables, and assertions.",
	" */",
  ].join("\n");
  if (language === "python") {
	return [
	  `# dsh-test-insight generated test draft; NOT EXECUTED OR VERIFIED. Generated: ${generatedAt}`,
	  `# REVIEW REQUIRED: adjust imports, fixtures, environment variables, and assertions.`,
	  `# Target: ${redactString(targetName)}`,
	  ...styleNotes.map((note) => `# ${note}`),
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
	  ...styleNotes.map((note) => `// ${note}`),
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
  // Plan §8: derived file names must stay inside the draft root even when the
  // target path or symbol contains traversal-looking segments.
  const filePath = path.resolve(root, `${String(index + 1).padStart(2, "0")}-${safeName(target.path)}${target.symbol ? `-${safeName(target.symbol)}` : ""}.test.${extension}`);
  return assertInsideRoot(root, filePath, "draft");
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
  await assertNoSymbolicLink(filePath, "draft");
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

export function buildDrafts(report, input, context = null) {
  const generatedAt = new Date().toISOString();
  const targets = report.targets || [];
  return targets.map((target, index) => {
	const language = languageFor(target, report);
	const content = draftForTarget(target, report, generatedAt, context);
	const adjacent = context?.adjacentByTarget?.get(target.path) || null;
	const framework = context?.frameworks?.frameworks?.[0] || null;
	return {
	  target: target.symbol ? `${target.path}:${target.symbol}` : target.path,
	  path: outputPathFor(target, report, input, index),
	  language,
	  status: "draft_only",
	  review_required: true,
	  syntax: syntaxCheck(content, language),
	  ...(context ? {
		context: {
		  manifest: context.manifest || null,
		  framework: framework ? { name: framework.name, source: framework.source, confidence: framework.confidence } : null,
		  adjacent_test: adjacent?.test_file || null,
		  export_style: context.exportStyleByTarget?.get(target.path) || "unknown",
		},
	  } : {}),
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

import { compareText } from "./ordering.mjs";

const SOURCE_KINDS = new Set(["source"]);
const TEST_KINDS = new Set(["test"]);
const CONFIDENCE_RANK = Object.freeze({ high: 3, medium: 2, low: 1, unknown: 0 });
// Test-root directory names aligned with the scanner's TEST_DIR_NAMES; a test
// file living under one of these roots maps to a source file in the mirrored
// directory (plan §5.3 priority 3).
const MIRROR_TEST_ROOTS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "integration", "integration-test", "unit"]);
// Go convention `*_test.go` sits next to the source in the same package, which
// the scanner classifies as `source`; the plugin layer supplements this
// classification (plan §5.2) instead of rewriting scanner facts.
const GO_TEST_FILE = /_test\.go$/i;
const NAME_CONTAINMENT_MIN_STEM = 4;

function baseName(value) {
  return String(value || "").split("/").pop() || "";
}

function stem(value) {
  const name = baseName(value);
  return name
	.replace(/\.(test|spec)(?=\.)/i, "")
	.replace(/[._-](test|spec)(?=\.)/i, "")
	.replace(/^(test_|_test|tests_)/i, "");
}

function directory(value) {
  const parts = String(value || "").split("/");
  parts.pop();
  return parts.join("/");
}

function isGoTestFile(file) {
  return file?.kind === "source" && file?.language === "go" && GO_TEST_FILE.test(file.path || "");
}

function stripMirrorRoots(dir) {
  const parts = String(dir || "").split("/").filter(Boolean);
  let index = 0;
  while (index < parts.length && MIRROR_TEST_ROOTS.has(parts[index].toLowerCase())) index += 1;
  return parts.slice(index).join("/");
}

function evidenceLevel(kind, confidence) {
	if (kind === "symbol-reference" || kind === "dependency") return "B";
  if (kind === "mirror" || kind === "module") return "C";
  if (kind === "name") return "D";
  return "E";
}

function betterCandidate(current, candidate) {
  if (!current) return candidate;
  const currentScore = [CONFIDENCE_RANK[current.confidence] ?? 0, current.same_directory ? 1 : 0];
  const candidateScore = [CONFIDENCE_RANK[candidate.confidence] ?? 0, candidate.same_directory ? 1 : 0];
  return candidateScore[0] > currentScore[0] || (candidateScore[0] === currentScore[0] && candidateScore[1] > currentScore[1])
	? candidate
	: current;
}

export function buildTestMapping(report, testFacts = null) {
  const allFiles = report?.files || [];
  // Plugin-layer supplement: scanner-classified `source` files following the Go
  // `*_test.go` convention are treated as test files here (plan §5.2), with the
  // recognition source kept on the resulting mappings.
  const testFiles = allFiles.filter((file) => TEST_KINDS.has(file.kind) || isGoTestFile(file));
  const sourceFiles = allFiles.filter((file) => SOURCE_KINDS.has(file.kind) && !isGoTestFile(file));
  const supplementedTests = new Map(
    allFiles
      .filter((file) => TEST_KINDS.has(file.kind) === false && isGoTestFile(file))
      .map((file) => [file.path, { source: "filename convention: *_test.go", confidence: "high" }]),
  );
  const sourceByBase = new Map(sourceFiles.map((file) => [baseName(file.path), file]));
  const sourceByStem = new Map();
  for (const source of sourceFiles) {
	const key = stem(source.path).toLowerCase();
	if (!sourceByStem.has(key)) sourceByStem.set(key, []);
	sourceByStem.get(key).push(source);
  }

  const internalBySource = new Map();
  for (const dep of report?.dependencies?.internal || []) {
	if (!internalBySource.has(dep.source)) internalBySource.set(dep.source, []);
	internalBySource.get(dep.source).push(dep);
  }

  const symbolRefsByTarget = new Map();
  for (const ref of report?.graphs?.symbol_references || []) {
	if (!symbolRefsByTarget.has(ref.target_file)) symbolRefsByTarget.set(ref.target_file, []);
	symbolRefsByTarget.get(ref.target_file).push(ref);
  }

  const mapped = [];
  const orphanTests = [];
  const coveredSources = new Set();
  for (const test of testFiles) {
	const recognition = supplementedTests.get(test.path);
	const importedTargets = (internalBySource.get(test.path) || [])
	  .map((dep) => sourceFiles.find((source) => source.path === dep.target))
		.filter(Boolean)
	  .filter((source, index, sources) => sources.findIndex((item) => item.path === source.path) === index);
	if (importedTargets.length > 0) {
	  for (const source of importedTargets) {
		const refs = (symbolRefsByTarget.get(source.path) || [])
		  .filter((ref) => ref.source_file === test.path)
		  .slice(0, 50);
		const kind = refs.some((ref) => ref.confidence === "high") ? "symbol-reference" : "dependency";
		mapped.push({
		  test_file: test.path,
		  target_file: source.path,
		  kind,
		  confidence: "high",
		  evidence_level: evidenceLevel(kind, "high"),
		  same_directory: directory(test.path) === directory(source.path),
		  ...(recognition ? { recognition } : {}),
		  ...(refs.length > 0 ? { symbol_references: refs } : {}),
		});
		coveredSources.add(source.path);
	  }
	  continue;
	}

	const candidate = findNameCandidate(test, sourceByBase, sourceByStem, sourceFiles);
	if (candidate) {
	  const source = candidate.source;
	  mapped.push({
		test_file: test.path,
		target_file: source.path,
		kind: candidate.kind,
		confidence: candidate.confidence,
		evidence_level: evidenceLevel(candidate.kind, candidate.confidence),
		same_directory: candidate.same_directory,
		...(recognition ? { recognition } : {}),
	  });
	  coveredSources.add(source.path);
	} else {
	  orphanTests.push(test.path);
	}
  }

  const officialMappings = new Map((testFacts?.test_files || []).map((entry) => [entry.test_file, entry]));
  for (const entry of mapped) officialMappings.delete(entry.test_file);
  for (const entry of officialMappings.values()) {
	if (sourceFiles.some((source) => source.path === entry.target_file)) {
		const sameDirectory = directory(entry.test_file) === directory(entry.target_file);
	  const kind = sameDirectory ? "module" : "name";
	  mapped.push({
		...entry,
		kind,
		confidence: sameDirectory ? "medium" : "low",
		evidence_level: evidenceLevel(kind, sameDirectory ? "medium" : "low"),
		same_directory: sameDirectory,
	  });
	  coveredSources.add(entry.target_file);
	  const index = orphanTests.indexOf(entry.test_file);
	  if (index >= 0) orphanTests.splice(index, 1);
	}
  }

  const moduleCoverage = (report?.modules || []).map((module) => {
	const files = module.file_paths || [];
	return {
	  module: module.path,
	  name: module.name,
	  source_file_count: files.length,
	  has_tests: files.some((filePath) => coveredSources.has(filePath)),
	  tested_files: files.filter((filePath) => coveredSources.has(filePath)),
	};
  });

  return {
	mappings: mapped.sort((a, b) => compareText(a.test_file, b.test_file) || compareText(a.target_file, b.target_file)),
	orphan_tests: [...new Set(orphanTests)].sort(compareText),
	module_coverage: moduleCoverage.sort((a, b) => compareText(a.module, b.module)),
	source_files_without_tests: sourceFiles.map((source) => source.path).filter((filePath) => !coveredSources.has(filePath)).sort(compareText),
  };
}

function findNameCandidate(test, sourceByBase, sourceByStem, sourceFiles) {
  const exactBase = sourceByBase.get(baseName(test.path));
  if (exactBase && !TEST_KINDS.has(exactBase.kind)) {
	const sameDirectory = directory(test.path) === directory(exactBase.path);
	return {
	  source: exactBase,
	  kind: sameDirectory ? "module" : "name",
	  confidence: sameDirectory ? "medium" : "low",
	  same_directory: sameDirectory,
	};
  }
  const candidates = sourceByStem.get(stem(test.path).toLowerCase()) || [];
  let best = null;
  for (const source of candidates) {
	best = betterCandidate(best, {
	  source,
	  kind: directory(test.path) === directory(source.path) ? "module" : "name",
	  confidence: directory(test.path) === directory(source.path) ? "medium" : "low",
	  same_directory: directory(test.path) === directory(source.path),
	});
  }
  // Same-directory stem association outranks the weaker supplements below.
  if (best?.same_directory) return best;
  const mirror = findMirrorCandidate(test, sourceFiles);
  if (mirror) return mirror;
  if (best) return best;
  return findContainmentCandidate(test, sourceFiles);
}

// Plan §5.3 priority 3: a test file under a test root maps to the source file
// with the same stem in the mirrored directory (tests/src/a/x.test.js -> src/a/x.js).
function findMirrorCandidate(test, sourceFiles) {
  const testDir = directory(test.path);
  const mirroredDir = stripMirrorRoots(testDir);
  if (mirroredDir === testDir) return null;
  const testStem = stem(test.path).toLowerCase();
  if (!testStem) return null;
  const matches = sourceFiles.filter((source) => directory(source.path) === mirroredDir && stem(source.path).toLowerCase() === testStem);
  if (matches.length !== 1) return null;
  return { source: matches[0], kind: "mirror", confidence: "medium", same_directory: false };
}

// Plan §5.3 priority 4: the test name contains the target module name. Only a
// unique containment match is accepted; ambiguity stays unmapped (orphan).
// Stems keep their extension in the filename-convention matchers above, so the
// containment comparison strips it (name-level, not filename-convention-level).
function findContainmentCandidate(test, sourceFiles) {
  const testStem = stem(test.path).toLowerCase().replace(/\.[^.]+$/, "");
  if (testStem.length < NAME_CONTAINMENT_MIN_STEM) return null;
  const matches = sourceFiles.filter((source) => {
	const sourceStem = stem(source.path).toLowerCase().replace(/\.[^.]+$/, "");
	return sourceStem.length >= NAME_CONTAINMENT_MIN_STEM && testStem.includes(sourceStem);
  });
  if (matches.length !== 1) return null;
  return { source: matches[0], kind: "name", confidence: "low", same_directory: false };
}

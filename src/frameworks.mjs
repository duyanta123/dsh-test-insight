// Plan §5.2: the scanner classifies files; this plugin layer supplements test
// framework recognition and test-run command candidates. Every item keeps its
// `source` and `confidence` so the report never presents a guess as a fact.

function baseName(value) {
  return String(value || "").split("/").pop() || "";
}

const FRAMEWORK_RULES = [
  { name: "jest", confidence: "high", source: "config file: jest.config.*", match: (report) => (report?.files || []).some((file) => /^jest\.config\./i.test(baseName(file.path))) },
  { name: "vitest", confidence: "high", source: "config file: vitest.config.*", match: (report) => (report?.files || []).some((file) => /^vitest\.config\./i.test(baseName(file.path))) },
  { name: "pytest", confidence: "high", source: "config file: pytest.ini / conftest.py", match: (report) => (report?.files || []).some((file) => /^(pytest\.ini|conftest\.py)$/i.test(baseName(file.path))) },
  { name: "pytest", confidence: "medium", source: "filename convention: test_*.py / *_test.py", match: (report) => (report?.files || []).some((file) => file.kind === "test" && /\.py$/i.test(file.path || "")) },
  { name: "go-testing", confidence: "high", source: "filename convention: *_test.go", match: (report) => (report?.files || []).some((file) => /_test\.go$/i.test(file.path || "")) },
  // Node test-family fallback only applies when no Jest/Vitest config exists.
  { name: "node-test", confidence: "low", source: "filename convention: *.test.js / *.spec.js without jest/vitest config", match: (report) => (report?.files || []).some((file) => file.kind === "test" && /\.(js|mjs|cjs|ts|tsx)$/i.test(file.path || ""))
	&& !(report?.files || []).some((file) => /^(jest|vitest)\.config\./i.test(baseName(file.path))) },
];

const FRAMEWORK_DEFAULT_COMMANDS = {
  jest: "npm test",
  vitest: "npm test",
  pytest: "pytest",
  "go-testing": "go test ./...",
  "node-test": "node --test",
};

export function detectTestFrameworks(report) {
  const frameworks = [];
  for (const rule of FRAMEWORK_RULES) {
	if (rule.match(report) && !frameworks.some((item) => item.name === rule.name)) {
	  frameworks.push({ name: rule.name, source: rule.source, confidence: rule.confidence });
	}
  }
  const commands = [];
  for (const method of report?.run_methods || []) {
	const candidate = typeof method === "string" ? method : method?.command || method?.run;
	const name = typeof method === "string" ? null : method?.name || null;
	if (!candidate || !/\btest\b/i.test(String(name || candidate))) continue;
	commands.push({ command: String(candidate), source: `scanner:run_methods${name ? `:${name}` : ""}`, confidence: "high" });
  }
  for (const framework of frameworks) {
	const fallback = FRAMEWORK_DEFAULT_COMMANDS[framework.name];
	if (fallback && !commands.some((item) => item.command === fallback)) {
	  commands.push({ command: fallback, source: `framework-default:${framework.name}`, confidence: "low" });
	}
  }
  return { frameworks, commands };
}

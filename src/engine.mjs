import { normalizeInput } from "./input.mjs";
import { collectScannerFacts } from "./scanner-adapter.mjs";
import { buildTestMapping } from "./mapping.mjs";
import { buildRiskAnalysis } from "./analysis.mjs";
import { buildReport } from "./report.mjs";
import { readCoverage } from "./coverage.mjs";
import { buildDrafts } from "./drafts.mjs";
import { executeAuthorizedTests } from "./execution.mjs";

export async function analyze(rawInput, { clock = () => Date.now() } = {}) {
	const input = normalizeInput(rawInput);
  const now = clock;
  const startedAt = now();
	const facts = await collectScannerFacts(input, { clock });
	const coverage = await readCoverage(input);
  const mapping = buildTestMapping(facts.report, facts.testFacts);
  const analysis = buildRiskAnalysis(facts.report, mapping, input, {
	testFacts: facts.testFacts,
	changeFacts: facts.changeFacts,
	  coverage,
  });
  const drafts = input.generateDrafts
	? buildDrafts({ ...facts.report, targets: analysis.targets }, input)
	: [];
  const execution = input.execution.authorized
	? await executeAuthorizedTests({
	  repoPath: input.repoPath,
	  command: input.execution.command,
	  report: facts.report,
	  authorized: input.execution.authorized,
	  timeoutMs: input.execution.timeoutMs,
	  maxOutputBytes: input.execution.maxOutputBytes,
	})
	: null;
  analysis.drafts = drafts;
  analysis.execution = execution;
	const finishedAt = now();
  const elapsedMs = Math.max(0, finishedAt - startedAt);
  const budgetExceeded = input.scanner.perfBudgetMs > 0 && elapsedMs > input.scanner.perfBudgetMs;
  if (budgetExceeded) {
	analysis.warnings = [...new Set([
	  ...(analysis.warnings || []),
	  `端到端分析耗时 ${elapsedMs}ms，超过 perf_budget_ms=${input.scanner.perfBudgetMs}。`,
	])].sort();
	analysis.targets = analysis.targets.map((target) => ({
	  ...target,
	  confidence: target.confidence === "high" ? "medium" : target.confidence === "medium" ? "low" : "unknown",
	}));
	analysis.gaps = analysis.gaps.map((gap) => ({
	  ...gap,
	  confidence: gap.confidence === "high" ? "medium" : gap.confidence === "medium" ? "low" : "unknown",
	}));
	analysis.evidence = analysis.evidence.map((evidence) => ({
	  ...evidence,
	  ...(evidence.confidence ? { confidence: evidence.confidence === "high" ? "medium" : evidence.confidence === "medium" ? "low" : "unknown" } : {}),
	}));
  }
  const report = buildReport({
	input,
	report: facts.report,
	testFacts: facts.testFacts,
	changeFacts: analysis.changeFacts,
	mapping,
	analysis,
	coverage,
	startedAt,
	finishedAt,
	performance: {
	  elapsed_ms: elapsedMs,
	  budget_ms: input.scanner.perfBudgetMs,
	  budget_exceeded: budgetExceeded,
	  scanner: facts.report?.performance || null,
	  calls: facts.timing?.calls || {},
	  cache: facts.timing?.cache || null,
	},
  });
  return {
	input,
	facts,
	mapping,
	analysis,
	report,
  };
}

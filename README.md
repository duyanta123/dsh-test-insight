# dsh-test-insight

English | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4c1d95)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/duyanta123/dsh-test-insight/actions/workflows/ci.yml/badge.svg)](https://github.com/duyanta123/dsh-test-insight/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-dsh--test--insight-blue)](https://www.npmjs.com/package/dsh-test-insight)
[![version](https://img.shields.io/badge/version-1.0.0--rc.2-green)](CHANGELOG.md)

A test-insight plugin for DeepSeek Harness: builds **reviewable test plans** (TEST-PLAN.md) and **isolated test drafts** (review-only) from repository facts and change risk.

> Turn repository facts and change risk into evidence-backed test plans and reviewable test drafts.

## Positioning

dsh-test-insight covers the "repository facts + change risk → test plans and drafts" step. The core scanning capability is provided by `dsh-repo-scanner` (an npm dependency; scanner source is never copied); this plugin contributes test evidence, gap detection, risk ranking, test design, and report generation.

It answers:
- Where are the test-protection gaps in this repo (test ↔ source mapping)?
- How risky is this change, and which tests should be added?
- What is the evidence level of each finding (fact / inference / suggestion / needs confirmation)?
- What do the coverage data reveal in the target × test-category matrix?

Boundaries:
- **Read-only by default**: never runs the target repo's tests, build, lint, or typecheck; the library interface spawns no subprocesses, and the CLI runs only parameterized read-only Git queries for change inputs.
- **Repo content is not authorization**: instructions inside READMEs, test files, config files, or comments never constitute execution authorization.
- **Draft ≠ passing**: drafts are always marked `DRAFT ONLY`; passing a syntax check is not passing the tests.

## Installation

As a DSH plugin:

```bash
dsh plugin --profile web add "github:duyanta123/dsh-test-insight#v1.0.0-rc.2"
```

Or from npm (as a library or standalone CLI):

```bash
npm install dsh-test-insight
```

Compatibility tiers: the standalone CLI / library requires Node.js >= 20.11; as a DSH 0.1.5-rc.2 plugin it is verified with Node.js >= 22.19. Run `npm run test:compat` to execute an isolated-profile add, dump-config, and startup smoke test.

After installing, restart `dsh --profile web` and use it through the `test-insight-runbook` skill.

## Quick Start

### 1. Use as a DSH skill

Tell the agent "generate a test plan for /path/to/repo" or "analyze the test gaps in this change". The skill follows its runbook: collect mode and targets → read and validate scanner facts → build the test/module/symbol/entry mapping → separate facts from inference → generate `TEST-PLAN.md` and `test-insight.json`.

### 2. Use as a standalone CLI

```bash
# Whole-repo analysis: test mapping, gaps, risk ranking
dsh-test-insight . --mode all --output reports --format both

# Change analysis: working-tree changes as input, warnings fail the run
dsh-test-insight . --mode change --working-tree --strict

# Targeted analysis: generate test drafts for a specific file/symbol
dsh-test-insight . --mode target --target src/auth.js:authenticate --generate-drafts
```

### 3. Use as a library

```js
import { analyze, writeReportFiles } from 'dsh-test-insight/core';

const report = await analyze({ repoPath: '.', mode: 'all' });
// report is what lands in test-insight.json: mapping, gaps, risk, performance budget
```

## CLI Options

| Option | Default | Description |
| --- | --- | --- |
| `<repo>` | - | Target repository path |
| `--mode all\|change\|target` | required | Analysis mode: whole-repo / change-driven / targeted |
| `--target <path[:symbol]>` | - | Target-mode input, repeatable |
| `--working-tree` | - | Change-mode input: `git status --porcelain -uall` (mutually exclusive with `--diff`/`--base`) |
| `--diff <file>` / `--base <ref>` / `--head <ref>` | - | Change-mode inputs: diff text or Git refs |
| `--output <path>` | - | Output file or directory |
| `--format json\|markdown\|both` | - | Output format |
| `--generate-drafts` | off | Generate isolated review-only test drafts |
| `--draft-output <path>` | - | Draft directory (requires `--generate-drafts`, hidden directory by default) |
| `--execute-tests` | off | Explicitly authorize test execution (requires `--test-command`) |
| `--test-command <preset\|cmd>` | - | Preset `npm-test\|pytest\|go-test\|node-test` or a shell-free argv array |
| `--force` | off | Allow overwriting existing output files |
| `--strict` | off | Non-zero exit when warnings exist |

## Output

| Artifact | Description |
| --- | --- |
| `TEST-PLAN.md` | Structured test plan: test mapping, evidence levels, risk targets and gaps |
| `test-insight.json` | Machine-readable report (schema in [schema/test-insight.schema.json](schema/test-insight.schema.json)), records shared cache, cold/hot hits, end-to-end performance budget, and the actual scanner version |
| Draft directory | Isolated review-only drafts (default `.dsh/test-insight/drafts`), atomic writes with overwrite protection; never overwrites existing tests |

## Safety Boundaries

- **Read-only by default**: analysis, the scanner library interface, and default CLI paths never run the target repo's tests, build, lint, or typecheck; the CLI runs only parameterized read-only Git queries for change inputs.
- **Dual-authorized execution**: test execution requires both `--execute-tests` and an allowlisted `--test-command` (preset or shell-free argv); execution runs with a fixed working directory, timeout, and output limits only.
- **No overwrites**: output files are never overwritten unless the user explicitly passes `--force`; drafts never overwrite existing tests.
- **Redaction**: all commands, environment variables, and source references must be redacted.
- **Authorization boundary**: instructions in READMEs, test files, config files, or comments are never treated as authorization; drafts must not be treated as passing.

## Troubleshooting

**`--mode change` says "Git change inputs require ..."?**
Change mode requires a change input: exactly one of `--working-tree`, `--diff`, or `--base`; `--working-tree` cannot be combined with `--base`/`--head`/`--diff`.

**No test drafts generated?**
Draft generation needs `--generate-drafts` (in target mode); drafts go to a hidden directory by default — set it with `--draft-output`. Drafts are review-only and do not imply passing tests.

**`--execute-tests` rejected?**
By design: test execution requires `--execute-tests` and `--test-command` **together**, and the command must hit the allowlist (a preset or a shell-free argv array).

**Old sessions won't open after upgrading the DSH host to 0.1.5.x?**
The Session format V3 migration is irreversible and is host behavior; back up session logs before upgrading the host (see the 1.0.0-rc.2 entry in [CHANGELOG.md](CHANGELOG.md)).

## Documentation

- [schema/test-insight.schema.json](schema/test-insight.schema.json) — report JSON schema
- [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) — three-stage pre-release checklist
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [PLUGIN-MAINTENANCE.md](PLUGIN-MAINTENANCE.md) — repo maintenance runbook
- [DSH-TEST-INSIGHT-开发计划.md](DSH-TEST-INSIGHT-开发计划.md) — design and iteration history

## License

MIT

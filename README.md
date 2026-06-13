# craboodle

[![npm version](https://img.shields.io/npm/v/craboodle.svg)](https://www.npmjs.com/package/craboodle)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **0.x.** Craboodle is in active development; minor versions may include breaking changes until 1.0.

Eval pipeline orchestrator for Claude Code.

craboodle discovers scenarios, runs them through [scuttlerun](https://github.com/bkudria/scuttlerun) (headless session driver), grades outputs with [pincenez](https://github.com/bkudria/pincenez) (LLM judge), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results.

![Demo: craboodle running the haiku-writer eval pipeline, streaming YAML results to stdout](assets/demo.gif)

> Source: [`assets/demo.tape`](assets/demo.tape) (re-record with `vhs assets/demo.tape`).

## How It Works

craboodle orchestrates two companion tools:

1. **scuttlerun** runs a headless Claude session with a synthetic user, producing a transcript
2. **pincenez** grades that transcript against a checks file using an LLM judge

For each scenario, craboodle runs scuttlerun N times, grades each run with pincenez, and averages the pass rates across repetitions.

## Installation

### Prerequisites

- **Node.js 20 or later** (see `engines.node` in [package.json](package.json); CI tests on 20, 22, 24; [`.nvmrc`](.nvmrc) pins 24 for development).
- **[scuttlerun](https://github.com/bkudria/scuttlerun)** and **[pincenez](https://github.com/bkudria/pincenez)** installed and on `PATH`. craboodle invokes them as subprocesses.
- **`ANTHROPIC_API_KEY`** exported in your environment. craboodle never reads or logs it; scuttlerun and pincenez do (see [SECURITY.md](SECURITY.md)).

### Install

```bash
# Global install (provides the `craboodle` command)
npm install -g craboodle

# Or run without installing
npx craboodle <command> [args]
```

## Usage

```bash
# Scaffold an evals.yaml at the skill / plugin root (incremental and safe to
# re-run: skips evals.yaml and component placeholders that already exist or
# are covered by an existing suite)
craboodle init ./my-skill

# Validate scenarios
craboodle list ./my-skill

# Check checks quality (no sessions run)
craboodle lint ./my-skill

# Run the eval pipeline
craboodle run ./my-skill
```

craboodle expects a single `evals.yaml` at the project root (next to `SKILL.md` for skills, or next to `.claude-plugin/plugin.json` for plugins) and scenarios under `evals/<scenario-id>/`. At run time it stages a filtered view of the project root (excluding `evals/`) and hands that to scuttlerun, so `project.skills: [.]` in `scenarios.base` cleanly self-references the skill being tested.

## Examples

Three runnable eval suites live under [`examples/`](examples/):

- [`examples/haiku-writer`](examples/haiku-writer) — agent writes a haiku to a file given a topic (or asks for one when missing). Demonstrates `prompt`, `user.max_turns`, and basic file-output checks.
- [`examples/claude-md-instruction`](examples/claude-md-instruction) — verifies whether the agent follows a TDD-style instruction from `CLAUDE.md` under prompt pressure. Demonstrates instruction-following evaluation.
- [`examples/hook-and-settings`](examples/hook-and-settings) — exercises PreToolUse hooks and `project.settings`. Demonstrates scenario-level project setup.

Run any of them:

```bash
craboodle run ./examples/haiku-writer
craboodle lint ./examples/haiku-writer
```

## Development

Clone the repo and install dependencies:

```bash
git clone https://github.com/bkudria/craboodle.git
cd craboodle
npm install
```

Common commands:

```bash
npm run dev          # Run the CLI via tsx (no build step)
npm run build        # TypeScript compilation to dist/
npm test             # Run the vitest suite
npm run test:watch   # Run vitest in watch mode
npm run test:coverage # Run vitest with v8 coverage
npm run lint         # ESLint over src/ and tests/
npm run format       # Prettier write
npm run format:check # Prettier check (CI uses this)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and PR guidelines.

## Artifact Cleanup

Each `craboodle run` creates a per-run artifact directory and a staged filtered view of the project root in `$TMPDIR` (prefixed `craboodle-run-` and `craboodle-staged-` respectively). At the start of every run, craboodle garbage-collects prior `craboodle-run-*` and `craboodle-staged-*` directories whose mtime is older than the retention window — best-effort, errors ignored.

The default window is 7 days. Override (or disable) it via `evals.yaml`:

```yaml
version: '1'
artifact_retention_days: 30 # keep prior runs for 30 days
# artifact_retention_days: 0  # disable cleanup entirely
```

Only directories matching the `craboodle-run-` or `craboodle-staged-` prefixes are touched; nothing outside `$TMPDIR` is read or modified.

## Troubleshooting

**`scuttlerun is not found on PATH` (or `pincenez …`)** — craboodle requires both companion CLIs on `PATH`. Install them ([scuttlerun](https://github.com/bkudria/scuttlerun), [pincenez](https://github.com/bkudria/pincenez)) and confirm with `which scuttlerun pincenez`. If installed but not found, your shell rc may not be exporting their install directory.

**`The engine "node" is incompatible with this module`** during `npm install -g craboodle` — craboodle requires Node ≥ 20 (`engines.node` in package.json). Use a version manager: `nvm install 24 && nvm use 24`, or `fnm use 24`, then retry.

**Scuttlerun or pincenez fails with an auth error** — both subprocesses call the Anthropic API and need `ANTHROPIC_API_KEY` in the environment. craboodle doesn't read or forward the key itself; export it in your shell (`export ANTHROPIC_API_KEY=…`) before running.

**`No scenarios found`** — craboodle expects `<root>/evals/<scenario-id>/scenario.yaml` files (the `evals/` subdirectory name is configurable via `scenarios.path` in `evals.yaml`). Scaffold a starter `evals.yaml` with `craboodle init <root>`, or check that your scenarios live under `evals/`.

## Exit Codes

Subset of the shared scuttlerun/pincenez/craboodle taxonomy — see [scuttlerun/README.md#exit-codes](https://github.com/bkudria/scuttlerun#exit-codes) for the canonical table. Source: [`src/exit-codes.ts`](src/exit-codes.ts).

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | Pipeline completed                                                                 |
| 1    | Refusal (list found invalid scenarios; lint reported issues)                       |
| 2    | Load failure (`evals.yaml` schema/version/range) or runtime error                  |
| 3    | Threshold failure (`min_pass_rate` ratchet)                                        |
| 4    | Infrastructure/dependency error (no scenarios, empty filter, zero successful reps) |
| 5    | Budget exhausted (`max_budget_usd`)                                                |
| 130  | Interrupted (SIGINT)                                                               |

A scuttlerun **rep** that exhausts its budget mid-run does not raise `5` — `5` is craboodle's own `max_budget_usd` cap on the whole run. The SDK reports such a rep as a runtime error (`"Reached maximum budget"` in the scenario's `errors` block), so it crashes and feeds the `4` reliability gate (`max_error_rate`) instead.

The 1-vs-2 split — refusal (1) vs load failure (2) — matches `craboodle.allium` rules `RejectUnknownConfigKeys`, `RejectUnsupportedVersion`, `RejectInvalidMinPassRate` (load → 2) and `ExitListInvalid`, `ExitLintIssuesFound` (refuse → 1). `init` is incremental (rule `InitScaffoldMissing`): it skips existing artifacts rather than refusing, and exits 0.

`craboodle run` also embeds the verdict in the stdout YAML stream as trailing `result:` / `exit_code:` fields (`pass`, `threshold_failure`, `reliability_failure`, `no_successful_reps`, or `budget_exceeded`), so the outcome stays readable even when a shell wrapper masks `$?`. A missing trailer means the run was interrupted or exited before streaming began.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — Development setup, tests, commit conventions, PR workflow
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Community guidelines
- [SECURITY.md](SECURITY.md) — Reporting a vulnerability
- [SUPPORT.md](SUPPORT.md) — Where to ask questions and report bugs
- [CHANGELOG.md](CHANGELOG.md) — Release history
- [RELEASING.md](RELEASING.md) — How releases are cut (Conventional Commits → release-please → npm publish)

## See Also

- [GOALS.md](GOALS.md) — design philosophy, principles, and project goals
- [craboodle.allium](craboodle.allium) — behavioural specification (the authoritative contract)

## License

[MIT](LICENSE)

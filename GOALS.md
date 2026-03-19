# craboodle — Goals

## Origin

Extracted from the [skillcraft](~/.claude/skills/skillcraft/) eval framework. The skillcraft eval pipeline previously inlined all orchestration — running scuttlerun sessions, grading with pincenez, aggregating results, managing iterations — inside `run-eval.sh` (~1000 lines of bash). `craboodle` extracts this into a standalone tool, completing the extraction arc: `scuttlerun` (session driver) → `pincenez` (grader) → `craboodle` (orchestrator).

## Design Philosophy

**Test runner, not history manager.** craboodle is to eval scenarios what rspec is to specs: given a set of scenarios, run them, grade them, report results. Each invocation is a fresh run — no iteration tracking, no result accumulation, no benchmark history. Run, report, done.

**UNIX pipeline, TypeScript implementation**: three tools (and counting), each owning one step, composing via stdout:

- `scuttlerun` runs a headless Claude session → produces output
- `pincenez` grades a single output against a rubric → produces structured evaluation
- `craboodle` orchestrates the pipeline → runs scenarios, manages repeats, streams results

Each tool does one job. craboodle is the conductor; scuttlerun and pincenez are the instruments. More tools may be extracted or added as the stack evolves.

### Principles

- **Run + grade + report.** No built-in comparison mode. The primitive is: run configs, grade outputs, report. Comparison (with/without skill, model A vs B, etc.) is a pattern that callers compose on top by defining scenario variants. **Labels are the composition mechanism**: callers tag scenarios with key-value labels (e.g., `config: optimized`, `model: sonnet`) and compute deltas, group results, or build comparison views downstream. Craboodle emits labeled raw data; callers interpret.
- **Layered configuration.** A base scuttlerun config (`base.yml`) defines shared defaults (model, tools, permissions). Each scenario overrides via a `scuttlerun:` passthrough block. Uses scuttlerun's existing config merging — no new config system.
- **Raw data, not verdicts.** Craboodle runs each scenario N times and reports fractional pass rates per assertion (0.33, 0.67, 1.0). It does not apply thresholds or majority voting — callers decide what constitutes pass/fail. Majority voting (e.g., "pass if ≥50% of reps pass") is an interpretation that belongs to callers; craboodle never reduces fractions to binary.
- **Streaming output.** Results stream to stdout as YAML, scenario by scenario. Each scenario's block is written atomically as it completes, providing human-readable progress during long runs. The output is valid YAML after each scenario block is fully written. Consumers process the final complete output after craboodle exits.
- **Artifacts preserved.** Intermediate artifacts (scuttlerun outputs, pincenez gradings) are written to a temp directory that is always preserved after the run. The temp directory path is included in the YAML output, enabling downstream inspection and debugging.
- **Error tolerance.** When a rep fails (scuttlerun crash, pincenez timeout, API error), craboodle skips the failed rep, excludes it from averaging, and reports the error in the scenario's output. Remaining reps and scenarios continue unaffected. If all reps fail for a scenario, it reports `pass_rate: null`.
- **Hardwired to scuttlerun + pincenez.** The tools form an opinionated stack. No pluggable runners or graders — that's over-abstraction for a pipeline with exactly two external tools.
- **Small tools, loosely joined.** Each tool in the stack is focused and composable. craboodle is the third extraction; more may follow. Avoid absorbing concerns that belong in other tools or downstream callers.
- **Minimal viable scope.** Start with the absolute minimum in craboodle. Absorb concerns from callers only when the pain of keeping them external demands it. When in doubt, leave it out — it's easier to add a feature later than to remove one.
- **Strict non-interpretation.** craboodle emits raw data and never reduces, interprets, or transforms its own output. No thresholds, no verdicts, no deltas, no majority voting — even as optional flags. All interpretation is a downstream concern.

## Goals

1. **Replace run-eval.sh.** The ~1000-line bash orchestrator becomes a TypeScript CLI with better error handling, types, and testability. Skillcraft's `run-eval.sh` and `aggregate-results.sh` are fully replaced.

2. **General-purpose eval orchestrator.** Designed for generality; skill eval is the first proven use case. Works with any directory of scenarios — CLAUDE.md/system prompt tuning, sub-agent definitions, model comparison, combo config evaluation, regression testing, skill evals. The skill concept is unknown to craboodle — the abstraction is clean enough for any use case without being designed around a specific one.

3. **Scenario directory convention.** `craboodle run <evals-dir>` discovers scenarios by globbing `*/scenario.yml`. Each scenario directory contains its definition. This convention is inherited from the skillcraft refactoring and proven in practice.

4. **Flat concurrency pool.** All (scenario, rep) pairs go into a single work pool bounded by `--concurrency`. No distinction between scenario-level and rep-level parallelism. Within each pair, the flow is sequential: scuttlerun runs first, then pincenez grades — the pool slot is held for both steps. Grading parallelism within pincenez (one LLM call per assertion) is inherited from pincenez.

5. **Streaming YAML output.** Results stream to stdout as YAML — `artifact_dir` is emitted first, then scenarios appear as they complete (arrival order). The output is valid YAML after each scenario block is fully written, giving human-readable progress. Compact output for passing assertions (check + pass_rate), verbose for failures (check + pass_rate + per-rep evidence). Per-scenario error details are included in the output.

6. **Scenario labels.** Scenarios support an optional `labels` map (key-value pairs) that passes through to the output YAML. Craboodle does not interpret labels — they enable callers to tag variants (e.g., `config: optimized`, `model: sonnet`) for downstream comparison and grouping.

## Non-Goals (for now)

- Built-in comparison modes (A/B, with/without). Callers define variants as separate scenarios with labels and compute deltas downstream.
- Pass/fail gating or ratcheting. Callers interpret pass rates and apply thresholds (e.g., `craboodle run ... | yq -e '.scenarios[].pass_rate >= 0.8'`).
- Pluggable runners or graders. scuttlerun + pincenez only.
- Iteration or history management. Each `craboodle run` is independent. Callers manage versioning externally (git, timestamped copies, etc.).
- CI/CD integration (GitHub Actions, webhooks). craboodle writes to stdout; CI captures it.
- Web UI or dashboard. yq and the terminal are the UI.
- Trend analysis across runs. A downstream concern.
- Notification or alerting on regressions.
- Scenario filtering (e.g., `--scenario` flag). If you want a subset, restructure directories or use downstream tooling. May be added later if the workflow demands it.

## Resolved Questions

- **Skillcraft relationship**: Skillcraft is craboodle's motivating first caller. It plans to keep its own wrapper scripts for skill-specific conventions (paired variant generation, discrimination analysis, majority voting, delta computation). The wrapper design is a skillcraft concern — craboodle's design is not shaped by assumptions about what skillcraft needs. As an example of label-based composition: skillcraft tags scenarios with `variant: with_skill` / `variant: without_skill` and computes deltas from craboodle's raw output downstream.

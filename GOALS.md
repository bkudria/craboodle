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

- **Run + grade + report.** No built-in comparison mode. The primitive is: run configs, grade outputs, report. Comparison (with/without skill, model A vs B, etc.) is a pattern that callers compose on top by defining scenario variants.
- **Layered configuration.** A base scuttlerun config (`base.yml`) defines shared defaults (model, tools, permissions). Each scenario overrides via a `scuttlerun:` passthrough block. Uses scuttlerun's existing config merging — no new config system. Craboodle settings live separately in `craboodle.yaml`.
- **Repeats with averaging.** Craboodle runs each scenario N times and averages pass rates across repetitions. Averaged rates (not majority vote) give a richer signal — 0.67 is more informative than pass/fail.
- **Streaming output.** Results stream to stdout as YAML as scenarios complete. Compact output for passing assertions, verbose output (with evidence) for failures. Human-readable yet machine-parseable.
- **Hardwired to scuttlerun + pincenez.** The tools form an opinionated stack. No pluggable runners or graders — that's over-abstraction for a pipeline with exactly two external tools.
- **Small tools, loosely joined.** Each tool in the stack is focused and composable. craboodle is the third extraction; more may follow. Avoid absorbing concerns that belong in other tools or downstream callers.

## Goals

1. **Replace run-eval.sh.** The ~1000-line bash orchestrator becomes a TypeScript CLI with better error handling, types, and testability. Skillcraft's `run-eval.sh` and `aggregate-results.sh` are fully replaced.

2. **General-purpose eval orchestrator.** Not skill-specific. Works with any directory of scenarios — skill evals, CLAUDE.md/system prompt tuning, sub-agent definitions, model comparison, combo config evaluation (Skill A + Skill B vs Skill C + MCP D), regression testing. The skill concept is unknown to craboodle.

3. **Scenario directory convention.** `craboodle run <evals-dir>` discovers scenarios by globbing `*/scenario.yml`. Each scenario directory contains its definition. This convention is inherited from the skillcraft refactoring and proven in practice.

4. **Parallel by default.** All scenario runs execute in parallel, with configurable concurrency limits. Grading parallelism is inherited from pincenez (one LLM call per assertion).

5. **Streaming YAML output.** Results stream to stdout as YAML — scenarios appear as they complete. Compact output for passing assertions (check + pass_rate), verbose for failures (check + pass_rate + per-rep evidence). No files written; stdout is the interface.

6. **Ratchet for regression prevention.** If `craboodle.yaml` in the evals directory defines a `minimum_score`, craboodle exits non-zero when results fall below it. Supports both an overall threshold and per-scenario overrides. The ratchet file is meant to be committed — a high-water mark that guards against regressions.

## Non-Goals (for now)

- Built-in comparison modes (A/B, with/without). Callers define variants as separate scenarios and compute deltas downstream. Skillcraft keeps a thin wrapper for its paired evaluation pattern.
- Pluggable runners or graders. scuttlerun + pincenez only.
- Iteration or history management. Each `craboodle run` is independent. Callers manage versioning externally (git, timestamped copies, etc.).
- CI/CD integration (GitHub Actions, webhooks). craboodle writes to stdout; CI captures it.
- Web UI or dashboard. yq and the terminal are the UI.
- Trend analysis across runs. A downstream concern.
- Notification or alerting on regressions (beyond the ratchet exit code).

## Open Questions

- **Skillcraft relationship**: Skillcraft will keep a thin wrapper around craboodle for skill-specific conventions (paired with/without variants, discrimination analysis). Exact wrapper design deferred to implementation.
- **Output labels for comparison**: Should the output YAML support a labels/tags/metadata field on scenarios to make downstream comparison easier (e.g., tagging variants)? Deferred — revisit after seeing how skillcraft actually uses craboodle.

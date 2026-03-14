# craboodle — Goals

## Origin

Extracted from the [skillcraft](~/.claude/skills/skillcraft/) eval framework. The skillcraft eval pipeline previously inlined all orchestration — running scuttlerun sessions, grading with pincenez, aggregating results, managing iterations — inside `run-eval.sh` (~1000 lines of bash). `craboodle` extracts this into a standalone tool, completing the extraction arc: `scuttlerun` (session driver) → `pincenez` (grader) → `craboodle` (orchestrator).

## Design Philosophy

**UNIX pipeline, TypeScript implementation**: three tools, each owning one step, composing via files:

- `scuttlerun` runs a headless Claude session → produces output
- `pincenez` grades a single output against a rubric → produces structured evaluation
- `craboodle` orchestrates the pipeline → runs scenarios, manages repeats, aggregates results

Each tool does one job. craboodle is the conductor; scuttlerun and pincenez are the instruments.

### Principles

- **Run + grade + aggregate.** No built-in comparison mode. The primitive is: run configs, grade outputs, aggregate. Comparison (with/without skill, model A vs B, etc.) is a pattern that callers compose on top by defining scenario variants.
- **Layered configuration.** A base scuttlerun config defines shared defaults (model, tools, permissions). Each scenario overrides the prompt, rubric, and files. Uses scuttlerun's existing config merging — no new config system.
- **Repeats with averaging.** Craboodle manages running scenarios N times and averaging results across repetitions. Averaged pass rates (not majority vote) give a richer signal — 0.67 is more informative than pass/fail.
- **Hardwired to scuttlerun + pincenez.** The three tools form an opinionated stack. No pluggable runners or graders — that's over-abstraction for a pipeline with exactly two external tools.

## Goals

1. **Replace run-eval.sh.** The ~1000-line bash orchestrator becomes a TypeScript CLI with better error handling, types, and testability. Skillcraft's `run-eval.sh` and `aggregate-results.sh` are fully replaced.

2. **General-purpose eval orchestrator.** Not skill-specific. Works with any directory of scenarios — skill evals, prompt engineering, model comparison, regression testing. The skill concept is unknown to craboodle.

3. **Scenario directory convention.** `craboodle <evals-dir>` discovers scenarios by globbing `*/scenario.yml`. Each scenario directory contains its definition and colocated iteration results. This convention is inherited from the skillcraft refactoring and proven in practice.

4. **Parallel by default.** All scenario runs execute in parallel, with configurable concurrency limits. Grading parallelism is inherited from pincenez (one LLM call per assertion).

5. **Structured output.** Results are written as JSON benchmark files — human-inspectable and machine-queryable with jq. No custom reporting; the data is the interface.

## Non-Goals (for now)

- Built-in comparison modes (A/B, with/without). Callers define variants as separate scenarios.
- Pluggable runners or graders. scuttlerun + pincenez only.
- CI/CD integration (GitHub Actions, webhooks). craboodle writes files; CI reads them.
- Web UI or dashboard. jq and the terminal are the UI.
- Trend analysis across iterations. Iterations are just numbered directories; trend analysis is a downstream concern.
- Notification or alerting on regressions.

## Open Questions

- **Skillcraft relationship**: Should skillcraft keep a thin wrapper around craboodle (with skill-specific defaults like SKILL.md name lookup, variant naming), or become pure documentation? Deferred to implementation time.
- **Scenario schema**: Exact fields beyond name, prompt, assertions, files. Should scenarios support scuttlerun-specific fields (model, tools, user persona)?
- **Iteration management**: Should craboodle manage iteration numbering and history, or should each run be independent (caller manages versioning)?
- **Output format**: Exact benchmark JSON schema. Inherit from current `benchmark-N.json` or redesign?

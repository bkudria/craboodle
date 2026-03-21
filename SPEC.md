# craboodle — Eval Pipeline Orchestrator

## Overview

craboodle is a TypeScript CLI that orchestrates evaluation pipelines for Claude Code configurations. It discovers scenarios, runs them through scuttlerun (headless session driver), grades outputs with pincenez (LLM rubric grader), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results. Each invocation is a fresh run — no history, no iterations, no accumulated state.

craboodle is **designed for generality**; skill eval is the first proven use case. It works with any directory of scenario definitions — CLAUDE.md tuning, sub-agent definitions, model comparisons, combo config evaluation, regression testing, skill evaluations, or any other use case requiring "run Claude, grade the output, report results."

### Motivating Problem

Evaluating Claude Code configurations (skills, prompts, CLAUDE.md variants, sub-agents, combo configs) requires orchestrating a multi-step pipeline: build scuttlerun configs, run sessions, grade outputs against rubrics, handle repetitions, and average results. This orchestration was previously a ~1000-line bash script (`run-eval.sh`) tightly coupled to skillcraft. craboodle extracts the orchestration into a standalone, typed, testable tool.

### Non-Goals

craboodle is a **test runner**, not:

- **A session driver** — scuttlerun runs sessions. craboodle invokes scuttlerun.
- **A grader** — pincenez grades outputs. craboodle invokes pincenez.
- **A comparison framework** — craboodle runs and grades. Comparison semantics (with/without skill, model A vs B) are patterns that callers compose by defining scenario variants.
- **A history manager** — each run is independent. No iterations, no benchmark accumulation.
- **A CI system** — craboodle writes to stdout. CI captures it.

See also GOALS.md for a complete list of feature non-goals with rationale.

---

## Design Decisions

For design philosophy and principles behind these choices, see GOALS.md.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Matches scuttlerun and pincenez; types, async, error handling |
| Scope | General-purpose test runner | Designed for generality; works with any scenario directory. Skill eval is the first proven use case |
| Interface | CLI-first | `craboodle run <evals-dir>` as primary invocation |
| Dependencies | Hardwired to scuttlerun + pincenez | Opinionated stack; no pluggable runners/graders |
| Scenario discovery | Directory convention | Glob `*/scenario.yml` in evals dir |
| Repeats | Built-in with averaging | Average pass rates across N reps |
| Pass rate semantics | Raw fractional data | Reports 0.33, 0.67, etc. — no binary thresholds |
| Configuration | Layered (base.yml + scenario scuttlerun: passthrough) | Uses scuttlerun's config merging; no craboodle-specific config file |
| Output | Streaming YAML to stdout | Per-scenario streaming; valid YAML after each scenario block completes. Arrival order. Consumers process final output |
| Output style | Compact pass, verbose fail | Passing assertions: check + pass_rate. Failures include per-rep evidence |
| Artifacts | Temp dir (preserved) | Intermediate files kept for debugging; temp dir path included in output YAML |
| Labels | Key-value map on scenarios | Passthrough to output; enables downstream comparison/grouping without craboodle interpreting semantics |
| Validation | Strict (Zod strict mode) | Fail fast on zero assertions, empty prompt, or unknown keys. No permissive/forward-compatible mode |
| Error handling | Skip failed reps | Failed reps excluded from averaging, reported in per-scenario `errors` array. Other reps/scenarios unaffected |
| Parallelism | Flat (scenario, rep) pool | All work items in one pool; `--concurrency` limits. Run-then-grade per rep (slot held for both) |
| Output format | Raw scuttlerun transcript | YAML transcript passed to pincenez as-is. No extraction or transformation step |
| Grading scope | Transcript as primary input | Pincenez receives the transcript file. It can also inspect the filesystem via Read tool if assertions require it (the transcript contains the project dir path) |

---

## Architecture

```
                          craboodle run <evals-dir>
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             scenario-a/     scenario-b/     scenario-c/
             scenario.yml    scenario.yml    scenario.yml
                    │              │              │
                    ▼              ▼              ▼
            ┌───────────────────────────────────────────┐
            │          Config Builder                    │
            │                                           │
            │  base.yml + scenario.yml scuttlerun:      │
            │  → merged scuttlerun config               │
            │                                           │
            │  scenario.yml assertions + context         │
            │  → pincenez rubric                        │
            └───────┬───────────────────────────────────┘
                    │
          ┌─────── │ ──── x repeats ────────┐
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ scuttlerun   │ → output.yml  │
          │  │ (temp dir)   │               │
          │  └─────────────┘                │
          │        │                        │
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ pincenez     │ → grading.yml │
          │  │ (temp dir)   │               │
          │  └─────────────┘                │
          └─────────────────────────────────┘
                    │
                    ▼  (average across reps)
                    │
              stream to stdout as YAML
              (scenario by scenario, as each completes)
```

### Components

#### 1. Scenario Discovery

Discovers scenarios by globbing `<evals-dir>/*/scenario.yml`. Each scenario directory's basename is its ID. Scenarios are sorted alphabetically by ID for deterministic ordering.

#### 2. Config Builder

Builds a scuttlerun config for each scenario by merging:
1. A **base config** (`<evals-dir>/base.yml`, optional) defining shared defaults — model, tools, permissions, user persona
2. The **scenario's scuttlerun overrides** (the `scuttlerun:` key in scenario.yml) — any scuttlerun config fields
3. The **scenario's prompt** (mapped to scuttlerun's `prompt:` field)

Uses scuttlerun's native config merging: later files override earlier ones (deep merge on objects, replace on scalars/arrays). craboodle writes a temporary override config and passes it alongside base.yml to scuttlerun.

Also builds a pincenez rubric from the scenario's assertions and optional context. The rubric contains the `assertions` array and, when present, the scenario's `context` field (passed through to orient the grading judge).

#### 3. Runner + Grader (Flat Pool)

All (scenario, rep) pairs are placed into a single work pool bounded by `--concurrency`. There is no distinction between scenario-level and rep-level parallelism.

For each (scenario, rep) pair, the flow is sequential — the pool slot is held for both steps:
1. **Run**: invoke `scuttlerun run <merged-config>` → `output.yml`
2. **Grade**: invoke `pincenez <rubric> <output>` → `grading.yml`

Pincenez handles per-assertion parallelism internally (one LLM call per assertion, concurrent).

craboodle manages:
- Pool scheduling with configurable concurrency
- Output and grading files in a temp directory
- Averaging grading results across reps per assertion
- Streaming scenario results to stdout as each scenario's reps complete

craboodle does not impose its own timeouts. scuttlerun handles session timeouts; if scuttlerun times out, craboodle reports it as a scuttlerun-stage error.

---

## Scenario Configuration

### Directory Structure

The evals directory contains only scenario definitions and configuration — no run artifacts:

```
<evals-dir>/
├── base.yml                        # Shared scuttlerun defaults (optional)
├── scenario-a/
│   ├── scenario.yml                # Scenario definition
│   └── fixture.py                  # Additional files (optional, ignored by craboodle)
├── scenario-b/
│   └── scenario.yml
└── scenario-c/
    └── scenario.yml
```

Intermediate artifacts (scuttlerun outputs, pincenez gradings) are written to a temp directory that is preserved after the run for debugging. The temp directory path is included in the YAML output.

### scenario.yml

A scenario has four craboodle-understood fields (`prompt`, `assertions`, `labels`, `context`) and an optional `scuttlerun:` passthrough block. The scenario's ID is its directory basename. Validation is strict: `prompt` and `assertions` (with at least one assertion) are required, and unknown top-level keys cause a configuration error (exit 1). The `scuttlerun:` block is not validated by craboodle — it passes through to scuttlerun as-is.

Scenario directories may contain additional files (fixtures, reference data, seed files) alongside scenario.yml. craboodle ignores all files except scenario.yml — additional files can be referenced by the scenario's scuttlerun config (e.g., via `project.files` relative paths).

```yaml
# --- Labels (optional, passthrough to output) ---
# Key-value pairs for downstream comparison/grouping.
# Craboodle does not interpret labels — they pass through to output as-is.
labels:
  config: optimized
  model: sonnet-4-6

# --- Context (optional, sent to pincenez rubric) ---
# Orients the grading judge about what task produced this output.
# Passes through to pincenez rubric's context field.
context: |
  The agent was asked to write an email validation function.
  The user cares about edge case handling.

# --- Prompt (sent to scuttlerun) ---
prompt: |
  Write a function that validates email addresses.

# --- Assertions (sent to pincenez as rubric) ---
assertions:
  - check: "Output contains a function that validates email format"
    note: "Look for regex or string parsing that checks for @ and domain"
  - check: "Function handles edge cases like empty string and missing @"
  - check: "Output includes at least one test or example usage"

# --- Scuttlerun overrides (optional) ---
# Passthrough: any scuttlerun config fields. Craboodle does not
# validate these — they are forwarded to scuttlerun as-is.
# Common overrides: model, tools, user.persona, max_turns, project.files
scuttlerun:
  model: claude-sonnet-4-6
  user:
    persona: "A developer who wants thorough validation"
  project:
    files:
      existing-code.py: |
        # This file is available to the agent during the session
        def placeholder():
            pass
```

### base.yml

Optional file at the evals directory root. A plain scuttlerun config defining shared defaults:

```yaml
# base.yml — shared scuttlerun defaults for all scenarios
model: claude-sonnet-4-6
tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Edit
user:
  turn_policy: single
project:
  claude_md: |
    Use relative paths. Do not use absolute paths.
```

### Config Merging

For each scenario, craboodle produces a scuttlerun config by merging:

1. **base.yml** (if it exists)
2. **scenario.yml's scuttlerun: block** (passthrough, not validated by craboodle)
3. **scenario.yml's prompt** (mapped to scuttlerun's `prompt:` field)

This uses scuttlerun's `run base.yml override.yml` merging behavior. craboodle writes a temporary override config (scuttlerun block + prompt) and passes it alongside base.yml to scuttlerun.

---

## CLI Interface

```
craboodle — Eval pipeline orchestrator for Claude Code

Usage:
  craboodle run <evals-dir> [options]     Run eval pipeline

Run options:
  --repeats N            Number of repetitions per scenario (default: 3)
  --concurrency N        Max parallel (scenario, rep) work items (default: 10)
  --agent-model MODEL    Override scuttlerun model for all scenarios
  --grader-model MODEL   Override pincenez model for all assertions

General:
  --verbose, -v          Verbose logging (to stderr)
  -h, --help             Show help
  --version              Show version
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pipeline completed successfully with at least some successful data. Individual rep/scenario failures are reported in output but do not affect the exit code. |
| 1 | Configuration error (invalid scenario YAML, missing required fields) |
| 2 | Infrastructure error (scuttlerun or pincenez binary not found, evals directory missing, zero scenarios discovered, or zero successful reps across all scenarios). |

---

## Output

Results stream to stdout as YAML, scenario by scenario for human-readable progress during long runs. `artifact_dir` is emitted first, then the `scenarios:` key, then each scenario's results are appended as array items as they complete (arrival order). The output is valid YAML after each scenario block is fully written. Consumers process the final complete output after craboodle exits.

All `pass_rate` values are raw fractional data (0.0–1.0). A scenario's `pass_rate` is the mean of its per-assertion pass rates.

Passing assertions (pass_rate == 1.0) are compact (check + pass_rate). Assertions with pass_rate < 1.0 include per-rep failure evidence from pincenez — like rspec showing stack traces only for failures. If a rep failed due to a scuttlerun or pincenez error, it is excluded from averaging and reported in the scenario's `errors` array. If all reps fail for a scenario, the scenario appears with `pass_rate: null` and its `errors` array.

### Example Output

```yaml
artifact_dir: /tmp/craboodle-run-a1b2c3
scenarios:
  - id: email-validator
    labels:
      config: optimized
    assertions:
      - check: "Output contains a function that validates email format"
        pass_rate: 1.0
      - check: "Function handles edge cases like empty string and missing @"
        pass_rate: 0.5
        failures:
          - rep: 1
            evidence: "No empty string handling found in the output"
      - check: "Output includes at least one test or example usage"
        pass_rate: 1.0
    pass_rate: 0.83
    errors:
      - rep: 3
        stage: scuttlerun
        error: "timeout after 120s"
  - id: url-parser
    labels:
      config: baseline
    assertions:
      - check: "Parses query strings correctly"
        pass_rate: 1.0
      - check: "Handles malformed URLs gracefully"
        pass_rate: 1.0
    pass_rate: 1.0
```

---

## Execution Flow

### `craboodle run <evals-dir>`

1. **Discover scenarios** — glob `<evals-dir>/*/scenario.yml`, sort by ID
2. **Load base config** — read `<evals-dir>/base.yml` if it exists
3. **Create temp directory** — for all intermediate artifacts
4. **Stream `artifact_dir`** — write the temp directory path to stdout as the first YAML key
5. **Build work items:** For each scenario, build merged scuttlerun config (base + scenario scuttlerun: overrides + prompt) and pincenez rubric (assertions + optional context). Enumerate all (scenario, rep) pairs.
6. **Execute work pool (flat pool, up to --concurrency):** All (scenario, rep) pairs compete for pool slots. For each pair:
   a. Run `scuttlerun run <config>` → `<tmpdir>/<scenario>/rep-M/output.yml`
   b. Run `pincenez <rubric> <output>` → `<tmpdir>/<scenario>/rep-M/grading.yml`
   c. **On rep failure** (scuttlerun crash, pincenez error, timeout): record the error (rep number, stage, error message), skip the rep, continue with remaining reps
   The pool slot is held for both scuttlerun and pincenez steps.
7. **As each scenario completes** (all its reps finish):
   a. Average grading results across successful reps (failed reps excluded from denominator). If all reps failed, `pass_rate: null`.
   b. **Stream scenario results to stdout**, including any `errors` array

---

## Relationship to Other Tools

### scuttlerun

craboodle invokes scuttlerun as a subprocess:
```bash
scuttlerun run base.yml scenario-override.yml > output.yml
```

craboodle builds a temporary override config from scenario.yml's `scuttlerun:` block and `prompt`, then passes it alongside base.yml to scuttlerun for merging. The raw scuttlerun YAML transcript (streaming conversation output) is captured as-is — no extraction or transformation step.

### pincenez

craboodle invokes pincenez as a subprocess:
```bash
pincenez rubric.yml output.yml > grading.yml
```

craboodle builds rubric files from scenario assertions and optional context. Assertions pass through directly since scenarios already use pincenez's `check`/`note` format. Pincenez receives the transcript file as its primary input. Tool call arguments in the transcript contain file contents, which the grading judge can inspect directly. Pincenez can also use its Read tool to inspect the scuttlerun project directory when assertions require filesystem-level verification — the transcript includes the project dir path.

### skillcraft (post-extraction)

As an example caller, skillcraft (craboodle's first consumer) plans to keep its own wrapper scripts for skill-specific conventions — paired with/without variant generation, discrimination analysis, SKILL.md name lookup. The wrapper design is a skillcraft concern, not craboodle's. Craboodle's design is not shaped by assumptions about what any specific caller needs.

---

## Dependencies

### Required

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `yaml` | YAML parsing and output |
| `zod` | Config validation |
| `glob` | Scenario discovery |

### Runtime (subprocess, resolved via PATH)

| Tool | Purpose |
|------|---------|
| `scuttlerun` | Session execution |
| `pincenez` | Output grading |

### Development

| Package | Purpose |
|---------|---------|
| `vitest` | Testing |
| `tsx` | TypeScript execution |

---

## Project Structure

```
craboodle/
├── package.json
├── tsconfig.json
├── SPEC.md                  # This file
├── GOALS.md                 # Design goals and philosophy
├── src/
│   ├── cli.ts               # Commander CLI entry point
│   ├── config.ts            # Scenario and base config parsing (Zod)
│   ├── discovery.ts         # Scenario directory discovery
│   ├── builder.ts           # Config builder (merge base + scenario → scuttlerun config + rubric)
│   ├── pool.ts              # Flat (scenario, rep) work pool with concurrency control
│   ├── runner.ts            # scuttlerun invocation (run) and pincenez invocation (grade) per rep
│   └── results.ts           # Results averaging and streaming YAML output
├── tests/
│   └── ...
└── examples/
    ├── base.yml             # Example base config
    └── example-scenario/
        └── scenario.yml     # Example scenario
```

---

## Future Considerations

Out of scope for v1, noted for future work:

### Watch Mode
Re-run scenarios when scenario.yml files change. Useful during scenario development.

### Cost Tracking
Track and report API costs per scenario and overall.

### Scenario Templates
`craboodle init` to scaffold a new evals directory with base.yml and example scenarios.

### Scenario Filtering
`--scenario` flag (repeatable or glob) to run a subset of scenarios. Useful during development when iterating on a single scenario. For now, restructure directories or use downstream tooling.

### Per-Scenario Repeat Overrides
Allow scenarios to override the repeat count (e.g., `repeats: 5` for flaky scenarios). Deferred — start with uniform `--repeats` for all scenarios.

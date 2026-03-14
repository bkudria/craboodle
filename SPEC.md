# craboodle — Eval Pipeline Orchestrator

## Overview

craboodle is a TypeScript CLI that orchestrates evaluation pipelines for Claude Code configurations. It discovers scenarios, runs them through scuttlerun (headless session driver), grades outputs with pincenez (LLM rubric grader), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results. Each invocation is a fresh run — no history, no iterations, no accumulated state.

craboodle is **general-purpose**. It works with any directory of scenario definitions — skill evaluations, CLAUDE.md tuning, sub-agent definitions, model comparisons, combo config evaluation, regression testing, or any other use case requiring "run Claude, grade the output, report results."

### Motivating Problem

Evaluating Claude Code configurations (skills, prompts, CLAUDE.md variants, sub-agents, combo configs) requires orchestrating a multi-step pipeline: build scuttlerun configs, run sessions, grade outputs against rubrics, handle repetitions, and average results. This orchestration was previously a ~1000-line bash script (`run-eval.sh`) tightly coupled to skillcraft. craboodle extracts the orchestration into a standalone, typed, testable tool.

### Non-Goals

craboodle is a **test runner**, not:

- **A session driver** — scuttlerun runs sessions. craboodle invokes scuttlerun.
- **A grader** — pincenez grades outputs. craboodle invokes pincenez.
- **A comparison framework** — craboodle runs and grades. Comparison semantics (with/without skill, model A vs B) are patterns that callers compose by defining scenario variants.
- **A history manager** — each run is independent. No iterations, no benchmark accumulation.
- **A CI system** — craboodle writes to stdout. CI captures it.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Matches scuttlerun and pincenez; types, async, error handling |
| Scope | General-purpose test runner | Not coupled to skills; works with any scenario directory |
| Interface | CLI-first | `craboodle run <evals-dir>` as primary invocation |
| Dependencies | Hardwired to scuttlerun + pincenez | Opinionated stack; no pluggable runners/graders |
| Scenario discovery | Directory convention | Glob `*/scenario.yml` in evals dir |
| Repeats | Built-in with averaging | Average pass rates across N reps (not majority vote) |
| Pass rate semantics | Raw fractional data | craboodle reports 0.33, 0.67, etc. — no binary thresholds. Callers decide what constitutes pass/fail |
| Configuration | Layered (base.yml + scenario scuttlerun: passthrough) | Uses scuttlerun's config merging; craboodle settings separate in craboodle.yaml |
| Output | Streaming YAML to stdout | Incrementally valid YAML; scenarios stream as array items as they complete |
| Output style | Compact pass, verbose fail | Passing assertions: check + pass_rate. Failures include per-rep evidence |
| Artifacts | Temp dir (preserved) | Intermediate files kept for debugging; temp dir path included in output YAML |
| Labels | Key-value map on scenarios | Passthrough to output; enables downstream comparison/grouping without craboodle interpreting semantics |
| Error handling | Skip failed reps | Failed reps excluded from averaging, reported in per-scenario `errors` array. Other reps/scenarios unaffected |
| Parallelism | Default parallel, configurable concurrency | All scenarios run concurrently; `--concurrency` limits |
| Ratchet | craboodle.yaml minimum_score | Exit 1 if mean of per-assertion pass rates falls below committed threshold |

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
            │  scenario.yml assertions                  │
            │  → pincenez rubric (assertions only)      │
            └───────┬───────────────────────────────────┘
                    │
          ┌─────── │ ──── x repeats ────────┐
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ scuttlerun   │ → output.md   │
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
                    │
                    ▼
              ratchet check (if craboodle.yaml exists)
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

Also builds a pincenez rubric from the scenario's assertions. The rubric contains only the `assertions` array — no `context` field. Each assertion is self-contained via its `check` and optional `note`.

#### 3. Runner

Invokes `scuttlerun run <merged-config>` for each scenario, N times (repeats). Manages:
- Parallel execution with configurable concurrency
- Output files in a temp directory
- Progress: none by default (results stream to stdout as they complete)

#### 4. Grader

Invokes `pincenez <rubric> <output>` for each output. Pincenez handles per-assertion parallelism internally. craboodle manages:
- Grading all outputs across scenarios and reps
- Writing grading results to temp directory
- Averaging results across reps per assertion

---

## Scenario Configuration

### Directory Structure

The evals directory contains only scenario definitions and configuration — no run artifacts:

```
<evals-dir>/
├── craboodle.yaml                  # Craboodle settings (optional)
├── base.yml                        # Shared scuttlerun defaults (optional)
├── scenario-a/
│   └── scenario.yml                # Scenario definition
├── scenario-b/
│   └── scenario.yml
└── scenario-c/
    └── scenario.yml
```

Intermediate artifacts (scuttlerun outputs, pincenez gradings) are written to a temp directory that is preserved after the run for debugging. The temp directory path is included in the YAML output.

### scenario.yml

A scenario has four craboodle-understood fields (`name`, `prompt`, `assertions`, `labels`) and an optional `scuttlerun:` passthrough block:

```yaml
# --- Scenario metadata ---
name: "Descriptive name for this scenario"

# --- Labels (optional, passthrough to output) ---
# Key-value pairs for downstream comparison/grouping.
# Craboodle does not interpret labels — they pass through to output as-is.
labels:
  variant: with_skill
  model: sonnet-4-6

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
  - Skill
user:
  turn_policy: single
project:
  claude_md: |
    Use relative paths. Do not use absolute paths.
```

### craboodle.yaml

Optional file at the evals directory root. Craboodle-specific settings, separate from scuttlerun config:

```yaml
# craboodle.yaml — craboodle settings

# Ratchet: overall minimum pass rate (mean of per-assertion pass rates).
# Exit 1 if results fall below.
minimum_score: 0.8

# Per-scenario minimum overrides (optional).
# Scenarios without overrides use the overall minimum_score.
scenarios:
  scenario-a:
    minimum_score: 0.9
  scenario-b:
    minimum_score: 0.6
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
  --concurrency N        Max parallel scuttlerun sessions (default: unlimited)
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
| 0 | Pipeline completed successfully (and ratchet passed, if configured) |
| 1 | Ratchet failure (results below minimum_score in craboodle.yaml) |
| 2 | Configuration error (invalid scenario YAML, missing required fields) |
| 3 | Pipeline error (scuttlerun or pincenez failures) |

---

## Output

Results stream to stdout as incrementally valid YAML. The `scenarios:` key is emitted first, then each scenario's results are appended as array items as they complete (arrival order). The overall `pass_rate` and `artifact_dir` are written last. The output is valid YAML at every intermediate point.

All `pass_rate` values are raw fractional data (0.0–1.0), not binary verdicts. A scenario's `pass_rate` is the mean of its per-assertion pass rates. The overall `pass_rate` is the mean across all scenarios. Callers decide what constitutes pass/fail — craboodle reports the numbers.

Passing assertions are compact (check + pass_rate). Failing assertions include per-rep evidence from pincenez — like rspec showing stack traces only for failures. If a rep failed due to a scuttlerun or pincenez error, it is excluded from averaging and reported in the scenario's `errors` array.

### Example Output

```yaml
artifact_dir: /tmp/craboodle-run-a1b2c3
scenarios:
  - id: email-validator
    name: Email validator
    labels:
      variant: with_skill
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
    name: URL parser
    labels:
      variant: without_skill
    assertions:
      - check: "Parses query strings correctly"
        pass_rate: 1.0
      - check: "Handles malformed URLs gracefully"
        pass_rate: 1.0
    pass_rate: 1.0
pass_rate: 0.92
```

---

## Execution Flow

### `craboodle run <evals-dir>`

1. **Load craboodle config** — read `<evals-dir>/craboodle.yaml` if it exists (for ratchet thresholds)
2. **Discover scenarios** — glob `<evals-dir>/*/scenario.yml`, sort by ID
3. **Load base config** — read `<evals-dir>/base.yml` if it exists
4. **Create temp directory** — for all intermediate artifacts
5. **Stream `artifact_dir`** — write the temp directory path to stdout as the first YAML key
6. **For each scenario (parallel, up to --concurrency):**
   a. Build merged scuttlerun config (base + scenario scuttlerun: overrides + prompt)
   b. Build pincenez rubric (assertions only, no context)
   c. For each rep (1..R):
      - Run `scuttlerun run <config>` → `<tmpdir>/<scenario>/rep-M/output.md`
      - Run `pincenez <rubric> <output>` → `<tmpdir>/<scenario>/rep-M/grading.yml`
      - **On rep failure** (scuttlerun crash, pincenez error, timeout): record the error (rep number, stage, error message), skip the rep, continue with remaining reps
   d. Average grading results across successful reps (failed reps excluded from denominator)
   e. **Stream scenario results to stdout** (as soon as all reps complete), including any `errors` array
7. **Write overall pass_rate** to stdout
8. **Ratchet check** — if craboodle.yaml defines minimum_score, compare mean of per-assertion pass rates against threshold and exit 1 if below

---

## Relationship to Other Tools

### scuttlerun

craboodle invokes scuttlerun as a subprocess:
```bash
scuttlerun run base.yml scenario-override.yml > output.md
```

craboodle builds a temporary override config from scenario.yml's `scuttlerun:` block and `prompt`, then passes it alongside base.yml to scuttlerun for merging.

### pincenez

craboodle invokes pincenez as a subprocess:
```bash
pincenez rubric.yml output.md > grading.yml
```

craboodle builds rubric files from scenario assertions. The rubric contains only the `assertions` array (no `context` field). Assertions pass through directly since scenarios already use pincenez's `check`/`note` format.

### skillcraft (post-extraction)

Skillcraft keeps a thin wrapper around craboodle for skill-specific conventions — paired with/without skill variant generation, discrimination analysis, SKILL.md name lookup. The wrapper design is a skillcraft concern, not craboodle's.

---

## Dependencies

### Required

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `yaml` | YAML parsing and output |
| `zod` | Config validation |
| `glob` | Scenario discovery |

### Runtime (subprocess)

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
│   ├── config.ts            # Scenario, base, and craboodle.yaml parsing (Zod)
│   ├── discovery.ts         # Scenario directory discovery
│   ├── builder.ts           # Config builder (merge base + scenario → scuttlerun config + rubric)
│   ├── runner.ts            # scuttlerun invocation and output management
│   ├── grader.ts            # pincenez invocation and grading management
│   └── results.ts           # Results averaging, streaming YAML output, ratchet check
├── tests/
│   └── ...
└── examples/
    ├── craboodle.yaml       # Example craboodle config
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
`craboodle init` to scaffold a new evals directory with craboodle.yaml, base.yml, and example scenarios.

### Per-Scenario Repeat Overrides
Allow scenarios to override the repeat count (e.g., `repeats: 5` for flaky scenarios). Deferred — start with uniform `--repeats` for all scenarios.

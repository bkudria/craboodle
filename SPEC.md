# craboodle — Eval Pipeline Orchestrator

## Overview

craboodle is a TypeScript CLI that orchestrates evaluation pipelines for Claude Code configurations. It runs scenarios through scuttlerun (headless session driver), grades outputs with pincenez (LLM rubric grader), manages repetitions with averaging, and aggregates results into structured benchmark files.

craboodle is **general-purpose**. It works with any directory of scenario definitions — skill evaluations, prompt engineering experiments, model comparisons, regression testing, or any other use case requiring "run Claude, grade the output, aggregate results."

### Motivating Problem

Evaluating Claude Code configurations (skills, prompts, CLAUDE.md variants) requires orchestrating a multi-step pipeline: generate scuttlerun configs, run sessions, grade outputs against rubrics, handle repetitions, and aggregate results. This orchestration was previously a ~1000-line bash script (`run-eval.sh`) tightly coupled to skillcraft. craboodle extracts the orchestration into a standalone, typed, testable tool.

### Non-Goals

craboodle is a **pipeline orchestrator**, not:

- **A session driver** — scuttlerun runs sessions. craboodle invokes scuttlerun.
- **A grader** — pincenez grades outputs. craboodle invokes pincenez.
- **A comparison framework** — craboodle runs and grades. Comparison semantics (with/without skill, model A vs B) are patterns that callers compose by defining scenario variants.
- **A CI system** — craboodle writes benchmark files. CI reads them.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Matches scuttlerun and pincenez; types, async, error handling |
| Scope | General-purpose orchestrator | Not coupled to skills; works with any scenario directory |
| Interface | CLI-first | `craboodle run <evals-dir>` as primary invocation |
| Dependencies | Hardwired to scuttlerun + pincenez | Opinionated stack; no pluggable runners/graders |
| Scenario discovery | Directory convention | Glob `*/scenario.yml` in evals dir |
| Repeats | Built-in with averaging | Average pass rates across N reps (not majority vote) |
| Configuration | Layered (base + scenario override) | Uses scuttlerun's config merging; each scenario overrides base defaults |
| Output | JSON benchmark files | Machine-queryable, human-inspectable |
| Parallelism | Default parallel, configurable concurrency | All scenarios run concurrently; `--concurrency` limits |

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
            │  base.yml + scenario.yml → scuttlerun     │
            │  config (merged via scuttlerun's rules)   │
            │                                           │
            │  scenario.yml assertions → pincenez       │
            │  rubric (context + assertions)             │
            └───────┬───────────────────────────────────┘
                    │
          ┌─────── │ ──── x repeats ────────┐
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ scuttlerun   │ → output.md   │
          │  │ run config   │               │
          │  └─────────────┘                │
          │        │                        │
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ pincenez     │ → grading.yml │
          │  │ rubric output│               │
          │  └─────────────┘                │
          └─────────────────────────────────┘
                    │
                    ▼
            ┌───────────────┐
            │  Aggregator    │
            │                │
            │  Average pass  │
            │  rates across  │
            │  reps per      │
            │  scenario      │
            └───────┬────────┘
                    │
                    ▼
            benchmark.json
```

### Components

#### 1. Scenario Discovery

Discovers scenarios by globbing `<evals-dir>/*/scenario.yml`. Each scenario directory's basename is its ID. Scenarios are sorted alphabetically by ID for deterministic ordering.

#### 2. Config Builder

Builds a scuttlerun config for each scenario by merging:
1. A **base config** (e.g., `<evals-dir>/base.yml`) defining shared defaults — model, tools, permissions, user persona
2. The **scenario's scuttlerun overrides** — prompt, project files, and any per-scenario config

Uses scuttlerun's native config merging: later files override earlier ones (deep merge on objects, replace on scalars/arrays).

Also builds a pincenez rubric from the scenario's assertions:
- `context` ← scenario prompt (what task produced this output)
- `assertions` ← scenario assertions array (check + optional note)

#### 3. Runner

Invokes `scuttlerun run <merged-config>` for each scenario, N times (repeats). Manages:
- Parallel execution with configurable concurrency
- Output file management (`<scenario>/iteration-N/rep-M/output.md`)
- Skip logic (don't re-run if output already exists)
- Progress reporting

#### 4. Grader

Invokes `pincenez <rubric> <output>` for each output. Pincenez handles per-assertion parallelism internally. craboodle manages:
- Grading all outputs (across scenarios and reps)
- Writing grading results to `<scenario>/iteration-N/rep-M/grading.yml`
- Skip logic (don't re-grade if grading already exists)

#### 5. Aggregator

Computes averaged results across reps for each scenario:
- Per-assertion: average pass rate across N reps
- Per-scenario: average pass rate across all assertions
- Overall: summary statistics across all scenarios

Writes `benchmark.json` to the evals directory.

---

## Scenario Configuration

### Directory Structure

```
<evals-dir>/
├── base.yml                        # Shared scuttlerun defaults (optional)
├── scenario-a/
│   ├── scenario.yml                # Scenario definition
│   ├── iteration-1/
│   │   ├── rep-1/
│   │   │   ├── output.md           # scuttlerun transcript
│   │   │   └── grading.yml         # pincenez grading
│   │   ├── rep-2/
│   │   │   ├── output.md
│   │   │   └── grading.yml
│   │   └── scenario-grading.json   # Averaged across reps
│   └── iteration-2/...
├── scenario-b/
│   └── scenario.yml
├── benchmark-1.json                # Aggregated results for iteration 1
└── benchmark-2.json
```

### scenario.yml

```yaml
# --- Scenario metadata ---
name: "Descriptive name for this scenario"

# --- Prompt (sent to scuttlerun) ---
prompt: |
  Write a function that validates email addresses.

# --- Assertions (sent to pincenez as rubric) ---
assertions:
  - check: "Output contains a function that validates email format"
    note: "Look for regex or string parsing that checks for @ and domain"
  - check: "Function handles edge cases like empty string and missing @"
  - check: "Output includes at least one test or example usage"

# --- Project files (scaffolded by scuttlerun) ---
files:
  existing-code.py: |
    # This file is available to the agent during the session
    def placeholder():
        pass

# --- Scuttlerun overrides (optional) ---
# Any scuttlerun config fields here override the base config.
# Common overrides: model, tools, user.persona, max_turns
scuttlerun:
  model: claude-sonnet-4-6
  user:
    persona: "A developer who wants thorough validation"
```

### base.yml

Optional file at the evals directory root. Defines shared scuttlerun config defaults:

```yaml
# base.yml — shared defaults for all scenarios
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

### Config Merging

For each scenario, craboodle produces a scuttlerun config by merging:

1. **base.yml** (if it exists)
2. **scenario.yml's scuttlerun overrides** (the `scuttlerun:` key)
3. **scenario.yml's prompt** (mapped to scuttlerun's `prompt:` field)
4. **scenario.yml's files** (mapped to scuttlerun's `project.files:`)

This uses scuttlerun's `run base.yml override.yml` merging behavior. craboodle writes a temporary merged config file and passes it to scuttlerun.

---

## CLI Interface

```
craboodle — Eval pipeline orchestrator for Claude Code

Usage:
  craboodle run <evals-dir> [options]     Run full eval pipeline
  craboodle show <evals-dir> [iteration]  Display benchmark results

Run options:
  --repeats N            Number of repetitions per scenario (default: 3)
  --concurrency N        Max parallel scuttlerun sessions (default: unlimited)
  --agent-model MODEL    Override scuttlerun model for all scenarios
  --grader-model MODEL   Override pincenez model for all assertions
  --skip-grading         Run scenarios only, skip grading and aggregation
  --iteration N          Reuse existing iteration N (don't create new)

Show options:
  (no options)           Show latest benchmark
  N                      Show benchmark for iteration N

General:
  --verbose, -v          Verbose logging
  -h, --help             Show help
  --version              Show version
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pipeline completed successfully |
| 1 | Configuration error (invalid scenario YAML, missing base.yml fields) |
| 2 | Pipeline error (scuttlerun or pincenez failures) |

---

## Output

### benchmark-N.json

Written to `<evals-dir>/benchmark-N.json` after each iteration:

```json
{
  "iteration": 1,
  "timestamp": "2026-03-13T10:30:00Z",
  "config": {
    "repeats": 3,
    "agent_model": "claude-sonnet-4-6",
    "grader_model": "claude-haiku-4-5"
  },
  "scenarios": [
    {
      "id": "scenario-a",
      "name": "Descriptive name for this scenario",
      "assertions": [
        {
          "check": "Output contains a function that validates email format",
          "pass_rate": 0.67,
          "reps": [true, false, true]
        },
        {
          "check": "Function handles edge cases",
          "pass_rate": 1.0,
          "reps": [true, true, true]
        }
      ],
      "pass_rate": 0.83
    }
  ],
  "summary": {
    "scenarios_count": 5,
    "overall_pass_rate": 0.73,
    "assertions_count": 15,
    "mean_assertion_pass_rate": 0.71
  }
}
```

### scenario-grading.json

Written to `<scenario>/iteration-N/scenario-grading.json` after grading:

```json
{
  "scenario_id": "scenario-a",
  "assertions": [
    {
      "check": "Output contains a function that validates email format",
      "pass_rate": 0.67,
      "reps": [
        { "pass": true, "evidence": "..." },
        { "pass": false, "evidence": "..." },
        { "pass": true, "evidence": "..." }
      ]
    }
  ],
  "pass_rate": 0.83
}
```

---

## Execution Flow

### `craboodle run <evals-dir>`

1. **Discover scenarios** — glob `<evals-dir>/*/scenario.yml`, sort by ID
2. **Determine iteration** — next iteration number from existing `benchmark-*.json` files (or `--iteration N` to reuse)
3. **Create iteration directories** — `<scenario>/iteration-N/rep-{1..R}/`
4. **Load base config** — read `<evals-dir>/base.yml` if it exists
5. **For each scenario (parallel, up to --concurrency):**
   a. Build merged scuttlerun config (base + scenario overrides + prompt + files)
   b. Build pincenez rubric (context from prompt, assertions from scenario)
   c. For each rep (1..R):
      - Run `scuttlerun run <config>` → `rep-M/output.md`
      - Run `pincenez <rubric> rep-M/output.md` → `rep-M/grading.yml`
   d. Average grading results across reps → `scenario-grading.json`
6. **Aggregate** — compute overall stats, write `benchmark-N.json`
7. **Display** — print summary table

### `craboodle show <evals-dir> [N]`

1. Find `benchmark-N.json` (latest if N not specified)
2. Display formatted summary table

---

## Relationship to Other Tools

### scuttlerun

craboodle invokes scuttlerun as a subprocess:
```bash
scuttlerun run <config.yml> > output.md
```

craboodle builds scuttlerun configs by merging base.yml with scenario overrides. It uses scuttlerun's config merging by passing multiple YAML files:
```bash
scuttlerun run base.yml scenario-override.yml > output.md
```

### pincenez

craboodle invokes pincenez as a subprocess:
```bash
pincenez <rubric.yml> <output.md> > grading.yml
```

craboodle builds rubric files from scenario assertions (mapping `prompt` → `context`, passing `assertions` through directly since scenarios already use pincenez's `check`/`note` format).

### skillcraft (post-extraction)

After craboodle is extracted, skillcraft's relationship to eval is TBD. Options include:
- A thin wrapper that adds skill-specific conventions (SKILL.md name lookup, with/without skill variant generation)
- Pure documentation on how to use craboodle for skill evaluation
- Both: docs + a convenience script

---

## Dependencies

### Required

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `yaml` | YAML parsing for scenario configs |
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
│   ├── config.ts            # Scenario and base config parsing (Zod)
│   ├── discovery.ts         # Scenario directory discovery
│   ├── builder.ts           # Config builder (merge base + scenario → scuttlerun config + rubric)
│   ├── runner.ts            # scuttlerun invocation and output management
│   ├── grader.ts            # pincenez invocation and grading management
│   ├── aggregator.ts        # Results averaging and benchmark generation
│   └── display.ts           # Formatted output (summary tables)
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

### Comparison Modes
Built-in A/B comparison (e.g., `craboodle compare <evals-dir> --variants with_skill,without_skill`). Currently, callers define variants as separate scenarios and compute deltas downstream.

### Watch Mode
Re-run scenarios when scenario.yml files change. Useful during scenario development.

### Cost Tracking
Track and report API costs per scenario, per iteration, and overall.

### Scenario Templates
`craboodle init` to scaffold a new evals directory with base.yml and example scenarios.

### Streaming Progress
Real-time progress updates during parallel execution (currently batch-style reporting).

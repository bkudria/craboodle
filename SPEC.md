# craboodle — Eval Pipeline Orchestrator

## Overview

craboodle is a TypeScript CLI that orchestrates evaluation pipelines for Claude Code configurations. It discovers scenarios, runs them through scuttlerun (headless session driver), grades outputs with pincenez (LLM judge), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results. Each invocation is a fresh run — no history, no iterations, no accumulated state.

craboodle is **designed for generality**; skill eval is the first proven use case. It works with any directory of scenario definitions — CLAUDE.md tuning, sub-agent definitions, combo config evaluation, regression testing, skill evaluations, or any other use case requiring "run Claude, grade the output, report results."

### Motivating Problem

Evaluating Claude Code configurations (skills, prompts, CLAUDE.md variants, sub-agents, combo configs) requires orchestrating a multi-step pipeline: run sessions, grade outputs against checks, handle repetitions, and average results. This orchestration was previously a ~1000-line bash script (`run-eval.sh`) tightly coupled to skillcraft. craboodle extracts the orchestration into a standalone, typed, testable tool.

### Non-Goals

craboodle is a **test runner**, not:

- **A session driver** — scuttlerun runs sessions. craboodle invokes scuttlerun.
- **A grader** — pincenez grades outputs. craboodle invokes pincenez.
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
| Scenario discovery | Directory convention | Glob `*/scenario.yaml` in evals dir |
| Repeats | Built-in with averaging | Average pass rates across N reps |
| Pass rate semantics | Raw fractional data with optional ratchet | Reports 0.33, 0.67, etc. Optional `min_pass_rate` in craboodle.yaml gates the exit code |
| Configuration | Separated tool configs | craboodle.yaml (pipeline), base.yaml (scuttlerun defaults), scenario.yaml (scuttlerun), checks.yaml (pincenez) |
| Output | Streaming YAML to stdout | Per-scenario streaming; valid YAML after each scenario block completes. Arrival order. Consumers process final output |
| Output style | Compact pass, verbose fail | Passing checks: check + pass_rate. Failures include per-rep evidence |
| Artifacts | Temp dir (preserved) | Intermediate files kept for debugging; temp dir path included in output YAML |
| Validation | Strict (Zod strict mode) | Fail fast on zero checks, empty prompt, or unknown keys. No permissive/forward-compatible mode |
| Error handling | Skip failed reps | Failed reps excluded from averaging, reported in per-scenario `errors` array. Other reps/scenarios unaffected |
| Parallelism | Flat (scenario, rep) pool | All work items in one pool; `--concurrency` limits. Run-then-grade per rep (slot held for both) |
| Output format | Raw scuttlerun transcript | YAML transcript passed to pincenez as-is. No extraction or transformation step |
| Grading scope | Transcript as primary input | Pincenez receives the transcript file. It can also inspect the filesystem via Read tool if checks require it (the transcript contains the project dir path) |

---

## Architecture

```
                          craboodle run <evals-dir>
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             scenario-a/     scenario-b/     scenario-c/
             scenario.yaml    scenario.yaml    scenario.yaml
             checks.yaml      checks.yaml      checks.yaml
                    │              │              │
          ┌─────── │ ──── x repeats ────────┐
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ scuttlerun   │ → output.yaml  │
          │  │  base.yaml + │               │
          │  │  scenario.yaml               │
          │  └─────────────┘                │
          │        │                        │
          │        ▼                        │
          │  ┌─────────────┐                │
          │  │ pincenez     │ → grading.yaml │
          │  │  checks.yaml │               │
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

Discovers scenarios by globbing `<evals-dir>/*/scenario.yaml`. Each scenario directory's basename is its ID. Scenarios are sorted alphabetically by ID for deterministic ordering.

#### 2. Config Pass-through

Each scenario directory contains two files for the two subprocess tools:
- **scenario.yaml** — a pure scuttlerun config file (prompt + any scuttlerun overrides)
- **checks.yaml** — a pure pincenez checks file (checks array with optional context)

craboodle passes these files directly to the respective tools. For scuttlerun, the optional **base config** (`<evals-dir>/base.yaml`) provides shared defaults — model, tools, permissions, user persona. scuttlerun's native config merging handles the layering: `scuttlerun base.yaml scenario.yaml` (later files override earlier ones, deep merge on objects, replace on scalars/arrays).

#### 3. Runner + Grader (Flat Pool)

All (scenario, rep) pairs are placed into a single work pool bounded by `--concurrency`. There is no distinction between scenario-level and rep-level parallelism.

For each (scenario, rep) pair, the flow is sequential — the pool slot is held for both steps:
1. **Run**: invoke `scuttlerun <merged-config>` → `output.yaml`
2. **Grade**: invoke `pincenez <checks-file> <output>` → `grading.yaml`

Pincenez handles per-check parallelism internally (one LLM call per check, concurrent).

craboodle manages:
- Pool scheduling with configurable concurrency
- Output and grading files in a temp directory
- Averaging grading results across reps per check
- Streaming scenario results to stdout as each scenario's reps complete

craboodle does not impose its own timeouts. scuttlerun handles session timeouts; if scuttlerun times out, craboodle reports it as a scuttlerun-stage error.

---

## Scenario Configuration

### Directory Structure

The evals directory contains scenario definitions, pipeline configuration, and shared defaults — no run artifacts:

```
<evals-dir>/
├── craboodle.yaml                   # Pipeline config (version, min_pass_rate, etc.)
├── base.yaml                        # Shared scuttlerun defaults (optional)
├── scenario-a/
│   ├── scenario.yaml                # Scuttlerun input (prompt, config overrides)
│   ├── checks.yaml                  # Pincenez checks (id-as-key format)
│   └── fixture.py                   # Additional files (optional, ignored by craboodle)
├── scenario-b/
│   ├── scenario.yaml
│   └── checks.yaml
└── scenario-c/
    ├── scenario.yaml
    └── checks.yaml
```

Intermediate artifacts (scuttlerun outputs, pincenez gradings) are written to a temp directory that is preserved after the run for debugging. The temp directory path is included in the YAML output.

### scenario.yaml

A pure scuttlerun config file. Contains the prompt and any scuttlerun config overrides for this scenario. The scenario's ID is its directory basename. craboodle does not parse or validate scenario.yaml — it passes the file directly to scuttlerun alongside base.yaml.

Scenario directories may contain additional files (fixtures, reference data, seed files) alongside scenario.yaml and checks.yaml. craboodle ignores all files except these two — additional files can be referenced by the scenario's scuttlerun config (e.g., via `project.files` relative paths).

```yaml
# scenario.yaml — pure scuttlerun config
prompt: |
  Write a function that validates email addresses.
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

### checks.yaml

A pure pincenez checks file. Each check uses pincenez's id-as-key format. An optional `context:` field orients the grading judge about what task produced the output.

```yaml
# checks.yaml — pure pincenez checks
context: |
  The agent was asked to write an email validation function.
  The user cares about edge case handling.

checks:
  - validates-format:
      check: "Output contains a function that validates email format"
      note: "Look for regex or string parsing that checks for @ and domain"
  - handles-edge-cases:
      check: "Function handles edge cases like empty string and missing @"
  - includes-tests:
      check: "Output includes at least one test or example usage"
```

### Evaluating Different Config Types

Since scenario.yaml is a pure scuttlerun config, it supports all Claude Code configuration types via scuttlerun's `project:` and `sdk:` fields directly. Here are scenario patterns for each (showing scenario.yaml and checks.yaml pairs):

#### Skills

```yaml
# scenario.yaml
prompt: "Write a haiku about the ocean"
project:
  skills:
    - ~/.claude/skills/haiku-writer
```

```yaml
# checks.yaml
checks:
  - follows-pattern:
      check: "Output follows 5-7-5 syllable pattern"
```

#### CLAUDE.md Instructions

```yaml
# scenario.yaml
prompt: "Write a function to parse URLs"
project:
  claude_md: |
    Always validate user input before processing.
    Include error handling for edge cases.
```

```yaml
# checks.yaml
checks:
  - validates-input:
      check: "Output includes input validation for malformed URLs"
```

#### Hooks and Settings

```yaml
# scenario.yaml
prompt: "Commit the changes"
project:
  settings:
    hooks:
      PreToolUse:
        - matcher: Bash
          hooks:
            - type: command
              command: "echo 'hook fired'"
```

```yaml
# checks.yaml
checks:
  - hook-ran:
      check: "Agent ran the pre-commit hook before committing"
```

#### MCP Servers

```yaml
# scenario.yaml
prompt: "Look up the documentation for the 'zod' library"
sdk:
  mcp_servers:
    docs-server:
      command: "node"
      args: ["./docs-mcp-server.js"]
```

```yaml
# checks.yaml
checks:
  - zod-details:
      check: "Output contains Zod-specific API details"
```

#### Sub-agents (Agent Tool)

```yaml
# scenario.yaml
prompt: "Research the best approach and implement it"
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
```

```yaml
# checks.yaml
checks:
  - used-sub-agent:
      check: "Agent spawned a sub-agent for research before implementing"
```

#### Full-Stack Combos

```yaml
# scenario.yaml
prompt: "Set up a new TypeScript project"
project:
  skills:
    - ~/.claude/skills/typescript-setup
  claude_md: |
    Use strict TypeScript. Always enable noUncheckedIndexedAccess.
  settings:
    env:
      NODE_ENV: development
  files:
    .prettierrc: |
      { "semi": false, "singleQuote": true }
```

```yaml
# checks.yaml
checks:
  - uses-linter:
      check: "Project uses the configured linter"
  - tsconfig-matches:
      check: "tsconfig matches the team standard"
```

---

### craboodle.yaml

Pipeline configuration file at the evals directory root. Contains craboodle-specific settings only — no scuttlerun fields.

```yaml
# craboodle.yaml — pipeline config
version: "1"              # required: eval format version (craboodle rejects unknown versions)
min_pass_rate: 0.8        # minimum acceptable scenario pass rate (0-1, optional)
max_budget_usd: 5.0       # stop scheduling reps after this total spend (optional)
repeats: 5                # default repetitions per scenario (optional, overrides CLI default)
```

#### `version` (required)

The eval format version. Currently the only supported value is `"1"`. craboodle rejects unknown versions with a clear error, ensuring forward compatibility as the format evolves. When craboodle.yaml is missing entirely, version checking is skipped.

#### `min_pass_rate` (ratchet)

When present, craboodle checks each scenario's pass_rate against this threshold after all scenarios complete. If any scenario falls below the threshold (or has `pass_rate: null` from all-failed reps), craboodle reports the failures to stderr and exits with code 3. This provides a CI-compatible binary signal from non-binary eval scores, analogous to a code coverage ratchet.

#### `max_budget_usd` (budget cap)

When present, craboodle tracks cumulative cost (agent + grading) across all work items. Once total spend exceeds the cap, remaining work items are skipped with a budget-exceeded error. Completed reps are still reported. This is best-effort — up to `concurrency` items may be in flight when the cap is reached.

#### `repeats`

Default number of repetitions per scenario. Overrides the CLI default of 3. The `--repeats` CLI flag overrides this value.

### base.yaml

Optional file at the evals directory root. Contains shared scuttlerun defaults only — model, tools, permissions, user persona. craboodle passes this file directly to scuttlerun; it does not parse or modify it.

```yaml
# base.yaml — shared scuttlerun defaults
model: claude-sonnet-4-6
tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Edit
project:
  claude_md: |
    Use relative paths. Do not use absolute paths.
```

### Config Merging

For each scenario, craboodle invokes scuttlerun with both config files:

```bash
scuttlerun base.yaml scenario.yaml
```

scuttlerun's native config merging handles the layering: later files override earlier ones (deep merge on objects, replace on scalars/arrays). craboodle does not build, extract, or transform configs — it passes files through directly.

---

## CLI Interface

```
craboodle — Eval pipeline orchestrator for Claude Code

Usage:
  craboodle run <evals-dir> [options]     Run eval pipeline
  craboodle list <evals-dir> [options]    List and validate scenarios
  craboodle lint <evals-dir> [options]    Lint checks for quality issues
  craboodle init <dir>                    Scaffold a new evals directory

Run options:
  --repeats N            Number of repetitions per scenario (default: 3, or craboodle.yaml repeats)
  --concurrency N        Max parallel (scenario, rep) work items (default: 10)
  --scenario, --scenarios PATTERN     Filter scenarios by ID (exact match, glob wildcard, or comma-separated)
  --agent-model MODEL    Override scuttlerun model for all scenarios
  --grader-model MODEL   Override pincenez model for all checks

List options:
  --scenario, --scenarios PATTERN     Filter scenarios by ID

Lint options:
  --concurrency N        Max parallel pincenez lint invocations (default: 10)
  --scenario, --scenarios PATTERN     Filter scenarios by ID
  --grader-model MODEL   Override pincenez model for linting

General:
  --verbose, -v          Verbose logging (to stderr)
  -h, --help             Show help
  --version              Show version
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pipeline completed successfully with at least some successful data. Individual rep/scenario failures are reported in output but do not affect the exit code. |
| 1 | Configuration error (invalid scenario YAML, missing required fields, invalid `min_pass_rate`, zero checks) |
| 2 | Infrastructure error (scuttlerun or pincenez binary not found, evals directory missing, zero scenarios discovered, or zero successful reps across all scenarios). |
| 3 | Threshold failure: one or more scenarios fell below `min_pass_rate` (see craboodle.yaml). Failures are reported to stderr. |

---

## Output

Results stream to stdout as YAML, scenario by scenario for human-readable progress during long runs. `artifact_dir` is emitted first, then the `scenarios:` key, then each scenario's results are appended as array items as they complete (arrival order). The output is valid YAML after each scenario block is fully written. Consumers process the final complete output after craboodle exits.

All `pass_rate` values are raw fractional data (0.0–1.0). A scenario's `pass_rate` is the mean of its per-check pass rates.

Passing checks (pass_rate == 1.0) are compact (check + pass_rate). Checks with pass_rate < 1.0 include per-rep failure evidence from pincenez — like rspec showing stack traces only for failures. If a rep failed due to a scuttlerun or pincenez error, it is excluded from averaging and reported in the scenario's `errors` array. If all reps fail for a scenario, the scenario appears with `pass_rate: null` and its `errors` array.

### Example Output

```yaml
artifact_dir: /tmp/craboodle-run-a1b2c3
scenarios:
  - id: email-validator
    checks:
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
    cost_usd: 0.0294
    agent_cost_usd: 0.0234
    grading_cost_usd: 0.006
    errors:
      - rep: 3
        stage: scuttlerun
        error: "timeout after 120s"
  - id: url-parser
    checks:
      - check: "Parses query strings correctly"
        pass_rate: 1.0
      - check: "Handles malformed URLs gracefully"
        pass_rate: 1.0
    pass_rate: 1.0
total_cost_usd: 0.045
```

---

## Execution Flow

### `craboodle run <evals-dir>`

1. **Discover scenarios** — glob `<evals-dir>/*/scenario.yaml`, sort by ID
2. **Load base config** — read `<evals-dir>/base.yaml` if it exists
3. **Create temp directory** — for all intermediate artifacts
4. **Stream `artifact_dir`** — write the temp directory path to stdout as the first YAML key
5. **Build work items:** Enumerate all (scenario, rep) pairs. Each scenario has a scenario.yaml (passed to scuttlerun) and checks.yaml (passed to pincenez).
6. **Execute work pool (flat pool, up to --concurrency):** All (scenario, rep) pairs compete for pool slots. For each pair:
   a. Run `scuttlerun <config>` → `<tmpdir>/<scenario>/rep-M/output.yaml`
   b. Run `pincenez <checks-file> <output>` → `<tmpdir>/<scenario>/rep-M/grading.yaml`
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
scuttlerun base.yaml scenario.yaml > output.yaml
```

base.yaml provides shared defaults; scenario.yaml provides scenario-specific config (prompt + overrides). Both are pure scuttlerun config files passed directly — craboodle does not build, extract, or transform them. The raw scuttlerun YAML transcript (streaming conversation output) is captured as-is — no extraction or transformation step.

### pincenez

craboodle invokes pincenez as a subprocess:
```bash
pincenez checks.yaml output.yaml > grading.yaml
```

Each scenario's checks.yaml is a pure pincenez checks file passed directly — craboodle does not build or transform it. Pincenez receives the transcript file as its primary input. Tool call arguments in the transcript contain file contents, which the grading judge can inspect directly. Pincenez can also use its Read tool to inspect the scuttlerun project directory when checks require filesystem-level verification — the transcript includes the project dir path.

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
│   ├── config.ts            # craboodle.yaml config parsing
│   ├── discovery.ts         # Scenario directory discovery
│   ├── pool.ts              # Flat (scenario, rep) work pool with concurrency control
│   ├── runner.ts            # scuttlerun/pincenez subprocess invocation per rep
│   ├── output.ts            # Results averaging and streaming YAML output
│   └── cleanup.ts           # Old artifact directory cleanup
├── tests/
│   └── ...
└── examples/
    ├── hook-and-settings/    # Example: hook/settings constraint eval
    │   ├── base.yaml
    │   ├── works-without-bash/
    │   │   ├── scenario.yaml
    │   │   └── checks.yaml
    │   └── hook-gates-commit/
    │       ├── scenario.yaml
    │       └── checks.yaml
    ├── haiku-writer/         # Example: skill eval with multi-turn
    │   ├── base.yaml
    │   ├── topic-provided/
    │   │   ├── scenario.yaml
    │   │   └── checks.yaml
    │   └── topic-not-provided/
    │       ├── scenario.yaml
    │       └── checks.yaml
    └── claude-md-instruction/ # Example: TDD instruction eval
        ├── craboodle.yaml
        ├── base.yaml
        ├── with-tdd/
        │   ├── scenario.yaml
        │   └── checks.yaml
        └── tdd-under-pressure/
            ├── scenario.yaml
            └── checks.yaml
```

---

## Future Considerations

Out of scope for v1, noted for future work:

### Watch Mode
Re-run scenarios when scenario.yaml files change. Useful during scenario development.



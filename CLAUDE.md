# craboodle

Eval pipeline orchestrator for Claude Code. Runs scenarios through scuttlerun, grades with pincenez, streams YAML results.

## Build commands

```bash
npm run build        # TypeScript compilation (tsc)
npm run dev          # Run CLI via tsx (no build step)
```

## Test commands

```bash
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage # vitest with v8 coverage
```

## Project overview

TypeScript CLI that orchestrates eval pipelines. Reads `<root>/evals.yaml`, discovers `<root>/evals/*/scenario.yaml` directories, stages a filtered view of `<root>` (excluding the scenarios dir), passes scenario.yaml to scuttlerun and checks.yaml to pincenez, averages across repetitions, and streams results as YAML.

See [GOALS.md](GOALS.md) for design philosophy and [craboodle.allium](craboodle.allium) for the behavioural specification.

## Architecture

- `src/cli.ts` — Commander CLI entry point
- `src/config.ts` — evals.yaml parsing and mode detection (skill/plugin/generic)
- `src/staged-view.ts` — Filtered tempdir view of `<root>` (excludes scenarios dir)
- `src/prepare-run.ts` — Stages the view, rewrites skill paths, materialises base config
- `src/discovery.ts` — Scenario directory discovery (glob)
- `src/pool.ts` — Flat (scenario, rep) work pool with concurrency control
- `src/runner.ts` — scuttlerun/pincenez subprocess invocation
- `src/output.ts` — Results averaging and streaming YAML output
- `src/cleanup.ts` — Old artifact directory cleanup (craboodle-run-* and craboodle-staged-*)

## Key decisions

- Hardwired to scuttlerun + pincenez — no pluggable runners/graders
- Raw fractional pass rates — no verdicts, no majority voting
- Flat concurrency pool over all (scenario, rep) pairs
- Streaming YAML output (scenario by scenario, arrival order)
- Unified pipeline + base config in a single `evals.yaml` at the project root; per-scenario configs split across `scenario.yaml` (scuttlerun) and `checks.yaml` (pincenez)
- Staged filtered view: at run time, the project root is symlink-mirrored into a tempdir with the scenarios dir excluded, so the eval agent sees a clean tree and self-referential `project.skills: [.]` Just Works

## Authoritative artifacts

`craboodle.allium`, `src/`, `tests/`, and `GOALS.md` are peer artifacts of the same system — the behavioural contract, the mechanism, the verification, and the design intent. The four must reflect each other. Changing any one obliges checking and updating the others; conflicts between them are reconciled, not decided unilaterally.

- `craboodle.allium` — what the system must do (Allium spec; authoritative contract)
- `src/` — how it does it (TypeScript implementation)
- `tests/` — proof it does what the spec says (vitest suite under `tests/`)
- `GOALS.md` — why the system exists in this shape (design intent and principles)

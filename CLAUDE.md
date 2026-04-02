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

TypeScript CLI that orchestrates eval pipelines. Discovers `*/scenario.yaml` directories, passes scenario.yaml to scuttlerun and checks.yaml to pincenez, averages across repetitions, and streams results as YAML.

See [GOALS.md](GOALS.md) for design philosophy and [SPEC.md](SPEC.md) for full technical specification.

## Architecture

- `src/cli.ts` — Commander CLI entry point
- `src/config.ts` — Craboodle config parsing (craboodle.yaml)
- `src/discovery.ts` — Scenario directory discovery (glob)
- `src/pool.ts` — Flat (scenario, rep) work pool with concurrency control
- `src/runner.ts` — scuttlerun/pincenez subprocess invocation
- `src/output.ts` — Results averaging and streaming YAML output
- `src/cleanup.ts` — Old artifact directory cleanup

## Key decisions

- Hardwired to scuttlerun + pincenez — no pluggable runners/graders
- Raw fractional pass rates — no verdicts, no majority voting
- Flat concurrency pool over all (scenario, rep) pairs
- Streaming YAML output (scenario by scenario, arrival order)
- Separated tool configs: scenario.yaml (scuttlerun), checks.yaml (pincenez), craboodle.yaml (pipeline)

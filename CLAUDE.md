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

TypeScript CLI that orchestrates eval pipelines. Discovers `*/scenario.yml` directories, builds merged scuttlerun configs, runs sessions, grades outputs against assertion rubrics via pincenez, averages across repetitions, and streams results as YAML.

See [GOALS.md](GOALS.md) for design philosophy and [SPEC.md](SPEC.md) for full technical specification.

## Architecture

- `src/cli.ts` — Commander CLI entry point
- `src/config.ts` — Scenario and base config parsing (Zod, strict mode)
- `src/discovery.ts` — Scenario directory discovery (glob)
- `src/builder.ts` — Config builder (merge base + scenario → scuttlerun config + rubric)
- `src/pool.ts` — Flat (scenario, rep) work pool with concurrency control
- `src/runner.ts` — scuttlerun/pincenez subprocess invocation
- `src/results.ts` — Results averaging and streaming YAML output

## Key decisions

- Hardwired to scuttlerun + pincenez — no pluggable runners/graders
- Raw fractional pass rates — no verdicts, no majority voting
- Flat concurrency pool over all (scenario, rep) pairs
- Streaming YAML output (scenario by scenario, arrival order)
- Strict Zod validation — unknown keys cause exit 1

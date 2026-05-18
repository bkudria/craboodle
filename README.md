# craboodle

> **0.x.** Craboodle is in active development; minor versions may include breaking changes until 1.0.

Eval pipeline orchestrator for Claude Code.

craboodle discovers scenarios, runs them through [scuttlerun](https://github.com/bkudria/scuttlerun) (headless session driver), grades outputs with [pincenez](https://github.com/bkudria/pincenez) (LLM judge), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results.

## How It Works

craboodle orchestrates two companion tools:

1. **scuttlerun** runs a headless Claude session with a synthetic user, producing a transcript
2. **pincenez** grades that transcript against a checks file using an LLM judge

For each scenario, craboodle runs scuttlerun N times, grades each run with pincenez, and averages the pass rates across repetitions.

## Quick Start

```bash
# Scaffold a new eval suite
craboodle init ./evals

# Validate scenarios
craboodle list ./evals

# Check checks quality (no sessions run)
craboodle lint ./evals

# Run the eval pipeline
craboodle run ./evals
```

## Exit Codes

Shared taxonomy across scuttlerun/pincenez/craboodle. Codes 5–7 are scuttlerun-only (budget/timeout/max_turns); craboodle emits:

| Code | Meaning |
|------|---------|
| 0 | Pipeline completed |
| 1 | Config/input error (also: lint found issues) |
| 2 | Runtime error (caught exception in run/lint action) |
| 3 | Threshold failure (`min_pass_rate` ratchet) |
| 4 | Infrastructure/dependency error (no scenarios, empty filter, zero successful reps) |
| 130 | Interrupted (SIGINT) |

## Documentation

- [GOALS.md](GOALS.md) — design philosophy, principles, and project goals
- [craboodle.allium](craboodle.allium) — behavioural specification (the authoritative contract)

## License

[MIT](LICENSE)

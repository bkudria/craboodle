# craboodle

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

## Documentation

- [GOALS.md](GOALS.md) — design philosophy, principles, and project goals
- [SPEC.md](SPEC.md) — technical specification, architecture, and configuration reference

## License

[MIT](LICENSE)

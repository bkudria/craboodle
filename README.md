# craboodle

Eval pipeline orchestrator for Claude Code.

craboodle discovers scenarios, runs them through [scuttlerun](https://github.com/bkudria/scuttlerun) (headless session driver), grades outputs with [pincenez](https://github.com/bkudria/pincenez) (LLM rubric grader), manages repetitions with averaging, and streams results to stdout as YAML.

Think of craboodle as **rspec for eval scenarios**: given a directory of scenarios, run them, grade them, report results.

## Usage

```bash
craboodle run <evals-dir> [--repeats N] [--concurrency N]
```

## Documentation

- [GOALS.md](GOALS.md) — design philosophy, principles, and project goals
- [SPEC.md](SPEC.md) — technical specification, architecture, and configuration reference

## License

[MIT](LICENSE)

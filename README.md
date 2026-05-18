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

## Installation

### Prerequisites

- **Node.js ≥ 24** (see [`.nvmrc`](.nvmrc) and `engines.node` in [package.json](package.json)).
- **[scuttlerun](https://github.com/bkudria/scuttlerun)** and **[pincenez](https://github.com/bkudria/pincenez)** installed and on `PATH`. craboodle invokes them as subprocesses.
- **`ANTHROPIC_API_KEY`** exported in your environment. craboodle never reads or logs it; scuttlerun and pincenez do (see [SECURITY.md](SECURITY.md)).

### Install

```bash
# Global install (provides the `craboodle` command)
npm install -g craboodle

# Or run without installing
npx craboodle <command> [args]
```

## Usage

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

## Development

Clone the repo and install dependencies:

```bash
git clone https://github.com/bkudria/craboodle.git
cd craboodle
npm install
```

Common commands:

```bash
npm run dev          # Run the CLI via tsx (no build step)
npm run build        # TypeScript compilation to dist/
npm test             # Run the vitest suite
npm run test:watch   # Run vitest in watch mode
npm run test:coverage # Run vitest with v8 coverage
npm run lint         # ESLint over src/ and tests/
npm run format       # Prettier write
npm run format:check # Prettier check (CI uses this)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and PR guidelines.

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

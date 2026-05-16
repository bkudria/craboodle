# Contributing

## Development setup

See the [Development section in the README](README.md#development) for build, test, and run commands.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), enforced via a `commit-msg` hook (commitlint).

Examples:

```
feat: add --json output format
fix: handle missing scenarios directory without crashing
docs: clarify scenarios discovery
chore(deps): bump zod to 4.0.1
```

The hook is installed automatically when you run `npm install` (via the `prepare` script).

## Pull requests

- Target the `main` branch.
- CI must pass (`lint`, `format:check`, `build`, `test`) — see [.github/workflows/ci.yml](.github/workflows/ci.yml).
- Do not edit `CHANGELOG.md` or bump `package.json` manually. Releases are driven by Conventional Commit messages on `main` via [release-please](RELEASING.md).

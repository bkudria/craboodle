# Releasing

Craboodle uses [release-please](https://github.com/googleapis/release-please) to automate version bumps, changelog generation, git tagging, and npm publishing. Releases are driven entirely by Conventional Commit messages on `main` — no manual version bumps, no hand-edited `CHANGELOG.md` entries.

## How a release happens

1. **Commits land on `main`.** Every PR uses [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint via the Husky `commit-msg` hook).
2. **release-please opens (or updates) a release PR.** On every push to `main`, [`.github/workflows/release-please.yml`](.github/workflows/release-please.yml) runs. It scans commits since the last release and maintains a single open PR titled `chore(main): release <version>`.
3. **The release PR proposes a version bump and CHANGELOG update.** release-please derives the next version from the unreleased commits (see mapping below) and prepends a new dated release section to `CHANGELOG.md`. It also bumps `package.json`'s `version` and updates `.release-please-manifest.json`.
4. **A maintainer merges the release PR.** That merge is the release trigger:
   - release-please creates the git tag (e.g. `v0.2.0`) and a GitHub Release.
   - The `publish` job in the same workflow runs `npm publish --access public`. Authentication is via npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived token. With OIDC, npm automatically generates [provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

No other action is required. Do not push tags by hand. Do not edit `CHANGELOG.md` directly.

## Commit type → version bump

release-please follows SemVer:

| Commit shape                                                          | Bump                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `fix:` …, `perf:` …                                                   | patch (`0.1.0` → `0.1.1`)                                                              |
| `feat:` …                                                             | minor (`0.1.0` → `0.2.0`)                                                              |
| `feat!:` …, `fix!:` …, or any commit with a `BREAKING CHANGE:` footer | major (`0.1.0` → `1.0.0`)                                                              |
| `docs:`, `chore:`, `refactor:`, `test:`, `build:`, `ci:`, `style:`    | no release; included in CHANGELOG only if release-please is configured to surface them |

While the project is `0.x`, breaking changes bump the minor (`0.1.0` → `0.2.0`); SemVer treats `0.x` as unstable. This is enforced by `bump-minor-pre-major: true` in `release-please-config.json`.

## Configuration

- [`release-please-config.json`](release-please-config.json) — single-package Node project, changelog at `CHANGELOG.md`, tags without component prefix.
- [`.release-please-manifest.json`](.release-please-manifest.json) — current released version (source of truth for release-please).
- [`.github/workflows/release-please.yml`](.github/workflows/release-please.yml) — the workflow itself; the `publish` job depends on the `release_created` output and authenticates to npm via OIDC trusted publishing (no `NPM_TOKEN`).

## Prerequisites for publishing

The `publish` job needs:

- A configured **trusted publisher** on the `craboodle` package's npm settings page, pointing at this repo and the `release-please.yml` workflow.
- `id-token: write` permission on the workflow (already set) so the OIDC handshake can issue a short-lived publish credential and sign provenance.
- npm CLI ≥ 11.5.1 and Node.js ≥ 22.14.0 in the runner (the workflow pins Node 24, which bundles npm 11.x).
- The repository setting **"Allow GitHub Actions to create and approve pull requests"** must be enabled, or release-please cannot open the release PR. Set via the Actions → General page, or:
  ```bash
  gh api repos/bkudria/craboodle/actions/permissions/workflow -X PUT \
    --input - <<'EOF'
  {"default_workflow_permissions": "write", "can_approve_pull_request_reviews": true}
  EOF
  ```

## Bootstrapping the first release

Trusted publishing has one limitation: it cannot perform the _very first_ publish of a package. The trusted publisher cannot be configured on npm until the package name exists in the registry. The fix is a one-time manual placeholder publish to claim the name; every release from `0.1.0` onward then uses OIDC.

This sequence is only run once, when the package is genuinely ready to be released for the first time:

1. **Publish the placeholder.** From a clean checkout, in a scratch directory:

   ```bash
   mkdir -p /tmp/craboodle-bootstrap && cd /tmp/craboodle-bootstrap
   cp <repo>/LICENSE <repo>/README.md .
   cat > package.json <<'JSON'
   {
     "name": "craboodle",
     "version": "0.0.1",
     "description": "Eval pipeline orchestrator for Claude Code — placeholder for name reservation; use 0.1.0+",
     "license": "MIT",
     "author": "Benjamin Kudria <ben@kudria.net>",
     "homepage": "https://github.com/bkudria/craboodle#readme",
     "repository": { "type": "git", "url": "git+https://github.com/bkudria/craboodle.git" },
     "bugs": { "url": "https://github.com/bkudria/craboodle/issues" },
     "files": ["README.md", "LICENSE"],
     "publishConfig": { "access": "public" }
   }
   JSON
   npm publish --access public        # interactive — prompts for 2FA OTP
   npm deprecate craboodle@0.0.1 "Placeholder for name reservation; install 0.1.0 or later."
   ```

2. **Configure the trusted publisher on npmjs.com.** On the `craboodle` package settings page → Publishing access → add a trusted publisher with:
   - Organization: `bkudria`
   - Repository: `craboodle`
   - Workflow filename: `release-please.yml`
   - Environment: _(leave blank)_

3. **Sync the manifest to the placeholder version.** In this repo:

   ```bash
   jq '.["."] = "0.0.1"' .release-please-manifest.json > .release-please-manifest.json.tmp \
     && mv .release-please-manifest.json.tmp .release-please-manifest.json
   git commit -am "chore: bootstrap release-please manifest to 0.0.1"
   git push
   ```

   Without this, release-please treats `0.0.0` as "no release yet" and proposes `1.0.0`. Matching the placeholder makes the next bump a normal `0.0.1` → `0.1.0`.

4. **Merge any open feature commits.** The next push to `main` will trigger release-please to open a `chore(main): release 0.1.0` PR. Merge that PR; the `publish` job will publish `0.1.0` via OIDC with automatic SLSA provenance.

After this, all subsequent releases follow the automated flow above — no further manual steps.

### Common bootstrap pitfalls (learned the hard way)

- **Do not** start with manifest at `0.0.0` and expect a `0.1.0` proposal — release-please defaults to `1.0.0` when manifest is `0.0.0`.
- **Do not** add `npm install -g npm@latest` to the publish job — it corrupts the global npm install in CI. Pin Node 24 instead; it bundles npm 11.x natively.
- **Do not** set an `NPM_TOKEN` secret or pass `--provenance` to `npm publish` — OIDC trusted publishing handles auth and provenance automatically. The only required permission is `id-token: write`.
- **Do not** hand-write a `## [Unreleased]` section in `CHANGELOG.md`. release-please prepends new release sections; it does not rewrite an `[Unreleased]` block.

## If a publish fails

If the `publish` job fails after the release PR is merged (e.g. transient npm registry error), fix the underlying issue and re-run the failed `publish` job from the Actions tab. Do not delete the tag or release.

If the failure requires a code change (e.g. broken build, missing trusted publisher config), delete the tag and GitHub Release, ship the fix as a `fix:` commit, and let release-please open a new release PR for the next version.

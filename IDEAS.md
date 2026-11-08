# Ideas

Candidate future directions — under consideration, not commitments.
[GOALS.md](GOALS.md) describes what is built and why; this file holds what
might come next. Entries come from a hand-driven probe of Claude Code hooks on
2026-11-04 and the fabrica eval suite run with craboodle the same day;
scuttlerun's IDEAS.md holds the transcript changes these depend on. Not
ordered by priority.

- **Retire the stale hook caveat in the claude-code-evals skill.** The
  hook-and-settings example now asserts on `hook:` entries (scuttlerun
  0.5.0+), and its "PreToolUse hooks may not fire in all Agent SDK modes"
  note is gone. The same caveat still sits in the claude-code-evals skill's
  config-type-patterns reference; settings and plugin hooks do fire under the
  TypeScript SDK. The edit is under skillcraft's gate. The example remains
  the only end-to-end proof of the hook channel, since the vitest suite cannot
  exercise the SDK; keep it to one rep in CI.
- **Regrading kept transcripts.** Iterating on check wording re-ran whole
  sessions; the hand loop that avoided it (find the newest run dir under
  /var/folders by `ls -dt`, two retries on an aliased ls, then pincenez per
  rep) graded without the `--context` craboodle passes, so its verdicts were
  not comparable to a run — and artifact_dir had been line 1 of the saved
  output all along. Every ingredient exists: artifacts are preserved per rep,
  pincenez grades any file, and the grounding context is
  `scuttlerun --dry-run` parsed for `prompt`. Now: document the per-rep
  one-liner with `--context "$(scuttlerun --dry-run … | yq .prompt)"` in
  `--help`. Open: a `regrade` subcommand that reuses an artifact_dir's
  transcripts, re-resolves grounding from the current scenario and writes a
  new run dir naming its source would reproduce run grounding and isolate
  grader variance from agent variance, but it is the first command consuming
  a prior run's artifacts and grazes "each run is independent"; scope it as
  reuse-these-transcripts, never a comparison, and warn when the dry-run
  prompt differs. Promote only if regrading after check rewording keeps
  recurring.
- **A hook-facts suite (weak).** One scenario per headless-reproducible probe
  fact (PostToolUse on AskUserQuestion carries `tool_response.answers` keyed
  by question text; the transcript tail at PreToolUse lacks the current
  turn's assistant message while PostToolUse's has it; Stop carries
  last_assistant_message; a PreToolUse deny with a reason is followed by a
  re-ask; a skill-frontmatter hook still fires on a Bash call in a later
  turn), graded from the fixture's hook log. Weak because it characterises
  Claude Code, not a configuration: a flip is news on a CLI bump, not a
  regression on a commit, so it does not belong in examples; if kept, it
  lives next to its consumer (fabrica's evals) with only the facts that
  design leans on, and two of the listed facts are model behaviour or need a
  scripted second turn. Facts about what a hook printed can now be graded
  from `hook:` entries; facts about a hook's input still need its log. The
  header provenance entry in scuttlerun's IDEAS.md is what lets such a run
  state which CLI version the facts held for.

# Ideas

Candidate future directions — under consideration, not commitments.
[GOALS.md](GOALS.md) describes what is built and why; this file holds what
might come next. Entries come from a hand-driven probe of Claude Code hooks on
2026-11-04 and the fabrica eval suite run with craboodle the same day;
scuttlerun's IDEAS.md holds the transcript changes these depend on. Not
ordered by priority.

- **Fix the hook-and-settings example.** Its scenario carries the note
  "PreToolUse hooks may not fire in all Agent SDK modes", its check asserts
  the hook's echo "appears in the transcript", which scuttlerun never carries
  and the pincenez judge is told to fail, and the `init` hooks placeholder
  says to assert against side effects. Settings-defined hooks do fire under
  the TypeScript SDK: fabrica's suite registers SessionStart, PreToolUse and
  PostToolUse hooks through `project.settings`, and every scenario passed
  with them active. Phase 1 now: delete the note, have the hook append to a
  file under `$CLAUDE_PROJECT_DIR`, point the check's `note` at it (the judge
  reads it; see pincenez's file-reading entry). Phase 2 once scuttlerun emits
  `hook:` entries: assert on them (fired for every Bash call, exit_code 0,
  output present) and change the `init` placeholder to say so. This example
  is the only end-to-end proof of the hook channel, since the vitest suite
  cannot exercise the SDK; keep it to one rep in CI. The same stale caveat
  sits in the claude-code-evals skill's config-type-patterns reference, an
  edit under skillcraft's gate.
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
  scripted second turn. The header provenance entry in scuttlerun's IDEAS.md
  is what lets such a run state which CLI version the facts held for.

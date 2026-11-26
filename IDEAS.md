# Ideas

Candidate future directions — under consideration, not commitments.
[GOALS.md](GOALS.md) describes what is built and why; this file holds what
might come next. Most entries come from a hand-driven probe of Claude Code
hooks on 2026-11-04 and the fabrica eval suite run with craboodle the same
day; scuttlerun's IDEAS.md holds the transcript changes those depend on. Not
ordered by priority.

- **A hook-facts suite (weak).** One scenario per headless-reproducible probe
  fact (PostToolUse on AskUserQuestion carries `tool_response.answers` keyed
  by question text; the transcript tail at PreToolUse lacks the current
  turn's assistant message while PostToolUse's has it; Stop carries
  last_assistant_message; a PreToolUse deny with a reason is followed by a
  re-ask; a skill-frontmatter hook still fires on a Bash call in a later
  turn), graded from the probe log of carapace, the hook-probe fixture
  beside the three tools. Weak because it characterises Claude Code, not a
  configuration: a flip is news on a CLI bump, not a regression on a
  commit, so it does not belong in examples; if kept, it lives next to its
  consumer (fabrica's evals) with only the facts that design leans on, and
  two of the listed facts are model behaviour or need a scripted second
  turn. Facts about what a hook printed can now be graded
  from `hook:` entries, and whether a PreToolUse hook blocked the call from
  its `result:` entry (scuttlerun 0.6.0+), whose `is_error` is true when it
  does. A call that went through has a result entry only if it is a Bash,
  AskUserQuestion or ExitPlanMode call, and a timeout or interrupt can leave
  any call without one. Facts about a hook's input still need carapace's
  log. Its first run (CLI 2.1.332) re-settled the listed facts: all held
  except the re-ask after a deny, which happened in one of two samples.
  scuttlerun's transcript header names the Claude Code version
  (`claude_code`, bkudria/scuttlerun#118), so such a run states which CLI
  version the facts held for.
- **`regrade --repeats`.** Grade each kept transcript N times to measure
  grader variance apart from agent variance. Deferred because it changes
  what a rep is: today a regrade has exactly its source's reps, so pass_rate
  and error_rate count transcripts, and N gradings of one transcript would
  weigh it N times and need a rep numbering that no longer matches the
  source's rep-N dirs.

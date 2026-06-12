export const HELP_TEXT = `
Directory Structure:
  craboodle reads <root>/evals.yaml and discovers scenarios under <root>/evals/:

    <root>/                            # skill root (next to SKILL.md), plugin
    │                                  #   root (next to .claude-plugin/plugin.json),
    │                                  #   or a generic eval suite
    ├── evals.yaml                     # Pipeline + scuttlerun base config
    ├── evals/
    │   ├── scenario-a/
    │   │   ├── scenario.yaml          # Scuttlerun input (prompt, config)
    │   │   └── checks.yaml            # Pincenez checks (id-as-key format)
    │   └── scenario-b/
    │       ├── scenario.yaml
    │       └── checks.yaml
    └── ...                            # other skill / plugin assets, ignored
                                       #   at scenario-discovery time

  At run time craboodle stages a filtered view of <root> into $TMPDIR
  (excluding the scenarios dir) and invokes scuttlerun against the staged
  view, so \`project.skills: [.]\` cleanly self-references the skill / plugin.

evals.yaml Schema:
  Single config file at <root>. Holds pipeline knobs at top level and a
  scuttlerun base config under scenarios.base.

    version: "1"                       # Schema version (required)
    min_pass_rate: 0.8                 # Ratchet threshold — exit 3 if any scenario
                                       #   falls below (optional, 0-1)
    max_error_rate: 0.1                # Reliability gate — exit 4 if a scenario's
                                       #   crash rate exceeds it (optional, 0-1;
                                       #   active only with min_pass_rate; default 0
                                       #   when gating: any crashed rep fails)
    max_budget_usd: 10.0               # Budget cap (optional)
    repeats: 3                         # Repetitions per scenario (optional, default: 3)
                                       #   Overridden by --repeats flag if passed
    artifact_retention_days: 7         # tmp-dir GC window (optional, default: 7;
                                       #   0 disables cleanup)

    scenarios:
      path: evals                      # subdir holding scenario folders (optional,
                                       #   single dir name, default: "evals")
      base:                            # required; scuttlerun config applied to every
                                       #   scenario. Arbitrary scuttlerun keys allowed.
        model: claude-sonnet-4-6
        tools:
          - Read
          - Write
          - Bash
        project:
          skills:
            - .                        # self-reference for standalone skills
          claude_md: |
            Use relative paths. Do not use absolute paths.

scenario.yaml Schema:
  Pure scuttlerun input file. Contains prompt and any scuttlerun config overrides.

    prompt: |
      Write a function that validates email addresses.

    # Any other scuttlerun config keys (model, tools, user, project, etc.)
    model: claude-sonnet-4-6
    user:
      persona: "A developer who wants thorough validation"

checks.yaml Schema:
  Pure pincenez checks file. Each check is an id-as-key object in a list.

    context: Background for judges     # Optional. Superseded during run and
                                       #   lint: the scenario's resolved prompt
                                       #   is passed as pincenez --context,
                                       #   which takes precedence; this field
                                       #   applies only when prompt resolution
                                       #   fails. Per-check guidance belongs in
                                       #   the check's note field.
    checks:
      - validates-email:
          check: "Output contains a function that validates email format"
          note: "Look for regex or string parsing that checks for @ and domain"
      - handles-edge-cases:
          check: "Function handles edge cases like empty string and missing @"

Output Format:
  YAML streamed to stdout, scenario by scenario (arrival order):

    artifact_dir: /tmp/craboodle-run-abc123
    scenarios:
      - id: email-validator
        checks:
          - check: "Output contains a function that validates email format"
            pass_rate: 1.0
          - check: "Function handles edge cases"
            pass_rate: 0.5
            failures:
              - rep: 1
                evidence: "No empty string handling found"
        pass_rate: 0.83
        cost_usd: 0.0294
        agent_cost_usd: 0.0234
        grading_cost_usd: 0.006
    total_cost_usd: 0.0294
    result: pass
    exit_code: 0

  Passing checks are compact (check + pass_rate). Failing checks
  include per-rep evidence. pass_rate is a fraction (0.0-1.0), never binary.
  cost_usd includes both agent (scuttlerun) and grading (pincenez) costs.
  The stream always ends with result + exit_code naming the run outcome
  (mirroring the process exit code); if they are missing, the run was
  interrupted or crashed before completing.

Examples:
  # Scaffold an evals.yaml at the skill / plugin root. Mode is auto-detected:
  #   SKILL.md -> skill, .claude-plugin/plugin.json -> plugin, else generic.
  # In plugin mode it also scaffolds one placeholder scenario per component
  # (skill / agent / command / hooks / mcp) under evals/<type>-<id>-placeholder/,
  # plus a composition-placeholder when the plugin has two or more components.
  # Incremental and safe to re-run: existing files are never overwritten, and it
  # skips components already covered by a suite (a scenario dir matching
  # <type>-<id> / <type>-<id>-*, or a nested skills/<id>/evals/ suite).
  craboodle init ./my-skill

  # List and validate scenarios without running
  craboodle list ./my-skill

  # Lint checks for quality issues (no sessions run)
  craboodle lint ./my-skill

  # Run all scenarios for a skill
  craboodle run ./my-skill

  # Override model and repetition count
  craboodle run ./my-skill --agent-model claude-sonnet-4-6 --repeats 5

  # Run a single scenario by ID
  craboodle run ./my-skill --scenario email-validator

  # Use a stronger grader model
  craboodle run ./my-skill --grader-model claude-sonnet-4-6

  # CI quality gate with yq
  craboodle run ./my-skill | yq '.scenarios[].pass_rate'

Exit Codes (shared scuttlerun/pincenez/craboodle taxonomy; codes 6-7 scuttlerun-only):
  0   Pipeline completed successfully
  1   Refusal (list found invalid scenarios; lint reported issues)
  2   Load failure (evals.yaml schema/version/range) or runtime error (caught exception in run/lint)
  3   Threshold failure (min_pass_rate ratchet violated)
  4   Infrastructure/dependency error (no scenarios, empty filter, zero successful reps)
  5   Budget exhausted (max_budget_usd)
  130 Interrupted (SIGINT)

Fail-fast:
  When min_pass_rate is set, the run aborts remaining queued reps as soon as
  any completed scenario falls below the threshold. Queued items report
  "Aborted (fail-fast)" in their errors. In-flight reps still finish.`;

#!/usr/bin/env node

import { Command } from "commander";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, mkdir, readFile, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify, parse } from "yaml";
import { resolve } from "node:path";

import pLimit from "p-limit";
import { loadCraboodleConfig, checkBaseConfig, DEFAULT_REPEATS } from "./config.js";
import { cleanOldArtifacts } from "./cleanup.js";
import { discoverScenarios, filterScenarios } from "./discovery.js";
import { runScuttlerun, runPincenez, runPincenezLint, listScuttlerunConfig } from "./runner.js";
import { executePool, type WorkItem } from "./pool.js";
import { runStaged } from "./staged.js";
import {
  parseGrading,
  parseCostFromTranscript,
  averageResults,
  streamHeader,
  streamScenarioYaml,
  streamTotalCost,
  parseLintResult,
  streamLintScenarioYaml,
  streamLintTotals,
  writeYamlArrayItem,
  type GradingCheck,
  type ScenarioOutput,
  type LintTotals,
} from "./output.js";

interface RunOptions {
  repeats: number;
  concurrency: number;
  agentModel?: string;
  graderModel?: string;
  scenarios?: string;
  verbose?: boolean;
}

type RepOutcome =
  | { type: "success"; grading: GradingCheck[]; costUsd: number | null; gradingCostUsd: number | null; transcriptPath: string }
  | { type: "error"; rep: number; stage: string; message: string; transcriptPath?: string };

async function runCommand(
  evalsDir: string,
  opts: RunOptions,
): Promise<void> {
  const resolvedDir = resolve(evalsDir);

  // Discover scenarios
  let scenarios = await discoverScenarios(resolvedDir);
  if (scenarios.length === 0) {
    process.stderr.write(
      `[craboodle] No scenarios found in ${resolvedDir}\n`,
    );
    process.exit(2);
  }

  // Apply scenario filter
  if (opts.scenarios) {
    scenarios = filterScenarios(scenarios, opts.scenarios);
    if (scenarios.length === 0) {
      process.stderr.write(
        `[craboodle] No scenarios match filter: ${opts.scenarios}\n`,
      );
      process.exit(2);
    }
  }

  if (opts.verbose) {
    process.stderr.write(
      `[craboodle] Found ${scenarios.length} scenario(s)\n`,
    );
  }

  // Load craboodle config
  const craboodleConfig = await loadCraboodleConfig(join(resolvedDir, "craboodle.yaml"));

  if (opts.verbose && craboodleConfig.version) {
    process.stderr.write(`[craboodle] Eval format version: ${craboodleConfig.version}\n`);
  }

  // Check base config existence
  const basePath = await checkBaseConfig(join(resolvedDir, "base.yaml"));

  // Clean old artifacts before creating new ones
  await cleanOldArtifacts(7, { verbose: opts.verbose });

  // Create artifact directory
  const artifactDir = await mkdtemp(join(tmpdir(), "craboodle-run-"));

  // Stream header
  streamHeader(artifactDir);

  // Determine repeats from craboodle config or CLI option
  const repeats = craboodleConfig.repeats ?? opts.repeats;

  const scuttleLimit = pLimit(opts.concurrency);
  const pincenezLimit = pLimit(opts.concurrency);

  type StageAResult = { ok: true } | { ok: false; outcome: RepOutcome };

  // Build work items
  const workItems: WorkItem<RepOutcome>[] = [];
  for (const scenario of scenarios) {
    const checksPath = join(dirname(scenario.configPath), "checks.yaml");

    for (let rep = 1; rep <= repeats; rep++) {
      workItems.push({
        scenarioId: scenario.id,
        rep,
        fn: async (): Promise<RepOutcome> => {
          const repDir = join(artifactDir, scenario.id, `rep-${rep}`);
          await mkdir(repDir, { recursive: true });

          const outputPath = join(repDir, "output.yaml");
          const gradingPath = join(repDir, "grading.yaml");

          const stageA = async (): Promise<StageAResult> => {
            if (opts.verbose) {
              process.stderr.write(
                `[craboodle] ${scenario.id} rep ${rep}: running scuttlerun\n`,
              );
            }
            const scuttlerunResult = await runScuttlerun({
              scenarioPath: scenario.configPath,
              basePath,
              outputPath,
              agentModel: opts.agentModel,
            });
            if (!scuttlerunResult.success) {
              return {
                ok: false,
                outcome: {
                  type: "error",
                  rep,
                  stage: scuttlerunResult.error.stage,
                  message: scuttlerunResult.error.message,
                  transcriptPath: outputPath,
                },
              };
            }
            return { ok: true };
          };

          const stageB = async (_a: StageAResult): Promise<RepOutcome> => {
            if (opts.verbose) {
              process.stderr.write(
                `[craboodle] ${scenario.id} rep ${rep}: running pincenez\n`,
              );
            }
            const pincenezResult = await runPincenez({
              checksPath,
              outputPath,
              gradingPath,
              graderModel: opts.graderModel,
            });
            if (!pincenezResult.success) {
              return {
                type: "error",
                rep,
                stage: pincenezResult.error.stage,
                message: pincenezResult.error.message,
                transcriptPath: outputPath,
              };
            }
            const gradingContent = await readFile(gradingPath, "utf8");
            const gradingResult = parseGrading(gradingContent);
            const outputContent = await readFile(outputPath, "utf8");
            const costUsd = parseCostFromTranscript(outputContent);
            return {
              type: "success",
              grading: gradingResult.checks,
              costUsd,
              gradingCostUsd: gradingResult.costUsd,
              transcriptPath: outputPath,
            };
          };

          const result = await runStaged(
            scuttleLimit,
            pincenezLimit,
            stageA,
            (a) => a.ok,
            stageB,
          );
          if (typeof result === "object" && "ok" in result && result.ok === false) {
            return result.outcome;
          }
          return result as RepOutcome;
        },
      });
    }
  }

  // Execute pool with arrival-order streaming
  let hasAnySuccess = false;
  let failFastTriggered = false;
  const scenarioOutputs: ScenarioOutput[] = [];

  await executePool(workItems, workItems.length, {
    budgetUsd: craboodleConfig.maxBudgetUsd,
    costOf: (outcome: RepOutcome) => {
      if (outcome.type !== "success") return 0;
      let cost = 0;
      if (outcome.costUsd !== null) cost += outcome.costUsd;
      if (outcome.gradingCostUsd !== null) cost += outcome.gradingCostUsd;
      return cost;
    },
    shouldAbort: () => failFastTriggered,
    onScenarioComplete: (scenarioId, repResults) => {
      const successfulGradings: GradingCheck[][] = [];
      const repTranscripts: string[] = [];
      const errors: Array<{ rep: number; stage: string; error: string }> = [];
      let agentCost = 0;
      let gradingCost = 0;

      for (const result of repResults) {
        if (result.type === "success") {
          const outcome = result.data;
          if (outcome.type === "success") {
            successfulGradings.push(outcome.grading);
            repTranscripts.push(outcome.transcriptPath);
            hasAnySuccess = true;
            if (outcome.costUsd !== null) {
              agentCost += outcome.costUsd;
            }
            if (outcome.gradingCostUsd !== null) {
              gradingCost += outcome.gradingCostUsd;
            }
          } else {
            errors.push({
              rep: outcome.rep,
              stage: outcome.stage,
              error: outcome.message,
              ...(outcome.transcriptPath ? { transcript: outcome.transcriptPath } : {}),
            });
          }
        } else {
          errors.push({
            rep: result.rep,
            stage: "unknown",
            error: result.error,
          });
        }
      }

      let scenarioOutput: ScenarioOutput;

      const totalScenarioCost = agentCost + gradingCost;
      const round4 = (n: number) => Math.round(n * 10000) / 10000;
      const costFields = {
        ...(totalScenarioCost > 0 ? { cost_usd: round4(totalScenarioCost) } : {}),
        ...(agentCost > 0 ? { agent_cost_usd: round4(agentCost) } : {}),
        ...(gradingCost > 0 ? { grading_cost_usd: round4(gradingCost) } : {}),
      };

      if (successfulGradings.length === 0) {
        scenarioOutput = {
          id: scenarioId,
          checks: [],
          pass_rate: null,
          ...costFields,
          errors,
        };
      } else {
        const averaged = averageResults(successfulGradings, repTranscripts);
        scenarioOutput = {
          id: scenarioId,

          checks: averaged.checks,
          pass_rate: averaged.pass_rate,
          ...costFields,
          ...(errors.length > 0 ? { errors } : {}),
        };
      }

      scenarioOutputs.push(scenarioOutput);
      streamScenarioYaml(scenarioOutput);

      if (opts.verbose) {
        process.stderr.write(
          `[craboodle] ${scenarioId}: pass_rate=${scenarioOutput.pass_rate}\n`,
        );
      }

      if (
        craboodleConfig.minPassRate !== undefined &&
        (scenarioOutput.pass_rate === null ||
          scenarioOutput.pass_rate < craboodleConfig.minPassRate)
      ) {
        if (!failFastTriggered && opts.verbose) {
          process.stderr.write(
            `[craboodle] Fail-fast triggered: ${scenarioId} pass_rate=${scenarioOutput.pass_rate} < ${craboodleConfig.minPassRate}\n`,
          );
        }
        failFastTriggered = true;
      }
    },
  });

  // Stream total cost
  const totalCostRaw = scenarioOutputs.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const totalCost = Math.round(totalCostRaw * 10000) / 10000;
  if (totalCost > 0) {
    streamTotalCost(totalCost);
  }

  if (!hasAnySuccess) {
    process.exit(2);
  }

  // Check ratchet threshold
  if (craboodleConfig.minPassRate !== undefined) {
    const failures = scenarioOutputs.filter(
      (s) => s.pass_rate === null || s.pass_rate < craboodleConfig.minPassRate!,
    );
    if (failures.length > 0) {
      process.stderr.write(`[craboodle] Threshold check failed (min_pass_rate: ${craboodleConfig.minPassRate}):\n`);
      for (const f of failures) {
        process.stderr.write(`  ${f.id}: ${f.pass_rate ?? "null"} < ${craboodleConfig.minPassRate}\n`);
      }
      process.exit(3);
    }
  }
}

const HELP_TEXT = `
Directory Structure:
  craboodle discovers scenarios by globbing */scenario.{yaml,yml} within <evals-dir>:

    <evals-dir>/
    ├── craboodle.yaml                 # Craboodle config (version, thresholds)
    ├── base.yaml                      # Scuttlerun defaults (optional)
    ├── scenario-a/
    │   ├── scenario.yaml              # Scuttlerun input (prompt, config)
    │   └── checks.yaml                # Pincenez checks (id-as-key format)
    ├── scenario-b/
    │   ├── scenario.yaml
    │   └── checks.yaml
    └── ...

craboodle.yaml Schema:
  Pipeline configuration. Controls version, thresholds, and repetitions.

    version: "1"                       # Schema version (required)
    min_pass_rate: 0.8                 # Ratchet threshold — exit 3 if any scenario
                                       #   falls below (optional, 0-1)
    max_budget_usd: 10.0               # Budget cap (optional)
    repeats: 3                          # Repetitions per scenario (optional, default: 3)

base.yaml Schema:
  Pure scuttlerun defaults applied to all scenarios. Passed as base config
  to scuttlerun. No craboodle-specific keys.

    model: claude-sonnet-4-6
    tools:
      - Read
      - Write
      - Bash
    project:
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

  Passing checks are compact (check + pass_rate). Failing checks
  include per-rep evidence. pass_rate is a fraction (0.0-1.0), never binary.
  cost_usd includes both agent (scuttlerun) and grading (pincenez) costs.

Examples:
  # List and validate scenarios without running
  craboodle list ./evals

  # Lint checks for quality issues (no sessions run)
  craboodle lint ./evals

  # Run all scenarios in an evals directory
  craboodle run ./evals

  # Override model and repetition count
  craboodle run ./evals --agent-model claude-sonnet-4-6 --repeats 5

  # Run a single scenario by ID
  craboodle run ./evals --scenario email-validator

  # Use a stronger grader model
  craboodle run ./evals --grader-model claude-sonnet-4-6

  # CI quality gate with yq
  craboodle run ./evals | yq '.scenarios[].pass_rate'

Exit Codes:
  0   Pipeline completed successfully
  1   Configuration error (invalid YAML, missing fields, unknown keys)
  2   Infrastructure error (no scenarios found, tools not installed)
  3   Threshold failure (min_pass_rate ratchet violated)

Fail-fast:
  When min_pass_rate is set, the run aborts remaining queued reps as soon as
  any completed scenario falls below the threshold. Queued items report
  "Aborted (fail-fast)" in their errors. In-flight reps still finish.`;

const program = new Command();

program
  .name("craboodle")
  .description("Eval pipeline orchestrator for Claude Code")
  .version("0.1.0")
  .addHelpText("after", HELP_TEXT);

program
  .command("run <evals-dir>")
  .description("Run eval pipeline")
  .option("--repeats <n>", "Number of repetitions per scenario", String(DEFAULT_REPEATS))
  .option(
    "--concurrency <n>",
    "Max parallel items per stage (scuttlerun and pincenez run in independent pools)",
    "10",
  )
  .option("--scenario, --scenarios <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
  .option("--agent-model <model>", "Override scuttlerun model for all scenarios")
  .option("--grader-model <model>", "Override pincenez model for all checks")
  .option("-v, --verbose", "Verbose logging (to stderr)")
  .action(async (evalsDir: string, cmdOpts: Record<string, string>) => {
    try {
      await runCommand(evalsDir, {
        repeats: parseInt(cmdOpts.repeats, 10),
        concurrency: parseInt(cmdOpts.concurrency, 10),
        agentModel: cmdOpts.agentModel,
        graderModel: cmdOpts.graderModel,
        scenarios: cmdOpts.scenarios,
        verbose: !!cmdOpts.verbose,
      });
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(2);
    }
  });

program
  .command("list <evals-dir>")
  .description("List and validate scenarios (including scuttlerun config validation)")
  .option("--scenario, --scenarios <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
  .option("-v, --verbose", "Verbose logging (to stderr)")
  .action(async (evalsDir: string, cmdOpts: { scenarios?: string; verbose?: boolean }) => {
    try {
      const resolvedDir = resolve(evalsDir);

      // Discover scenarios
      let scenarios = await discoverScenarios(resolvedDir);
      if (scenarios.length === 0) {
        process.stderr.write(`[craboodle] No scenarios found in ${resolvedDir}\n`);
        process.exit(2);
      }

      if (cmdOpts.scenarios) {
        scenarios = filterScenarios(scenarios, cmdOpts.scenarios);
        if (scenarios.length === 0) {
          process.stderr.write(`[craboodle] No scenarios match filter: ${cmdOpts.scenarios}\n`);
          process.exit(2);
        }
      }

      // Load craboodle config
      const craboodleConfig = await loadCraboodleConfig(join(resolvedDir, "craboodle.yaml"));

      // Check base config existence
      const basePath = await checkBaseConfig(join(resolvedDir, "base.yaml"));

      // Output base config summary
      const baseSummary: Record<string, unknown> = {};
      if (craboodleConfig.version) baseSummary.version = craboodleConfig.version;
      if (craboodleConfig.minPassRate !== undefined) baseSummary.min_pass_rate = craboodleConfig.minPassRate;
      process.stdout.write(stringify({ base: baseSummary }, { lineWidth: 0 }));

      // Validate each scenario
      process.stdout.write(`scenarios:\n`);
      let totalChecks = 0;
      let invalidCount = 0;

      for (const scenario of scenarios) {
        try {
          // Parse checks.yaml to count checks
          const checksPath = join(dirname(scenario.configPath), "checks.yaml");
          const checksContent = await readFile(checksPath, "utf8");
          const checksData = parse(checksContent) as Record<string, unknown>;
          const checksArray = checksData.checks;
          const checkCount = Array.isArray(checksArray) ? checksArray.length : Object.keys(checksData).length;
          totalChecks += checkCount;

          const item: Record<string, unknown> = {
            id: scenario.id,
            checks: checkCount,
          };

          // Validate merged scuttlerun config via subprocess
          const result = await listScuttlerunConfig({
            scenarioPath: scenario.configPath,
            basePath,
          });

          item.valid = result.success;
          if (!result.success) {
            item.error = result.error.message;
            invalidCount++;
          }

          process.stdout.write(writeYamlArrayItem(item) + "\n");
        } catch (err: unknown) {
          process.stderr.write(
            `[craboodle] Config error in ${scenario.id}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      }

      process.stdout.write(stringify({ total: `${scenarios.length} scenarios, ${totalChecks} checks` }, { lineWidth: 0 }));
      if (invalidCount > 0) {
        process.stdout.write(stringify({ invalid: invalidCount }, { lineWidth: 0 }));
        process.exit(1);
      }
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  });

interface LintOptions {
  concurrency: number;
  graderModel?: string;
  scenarios?: string;
  verbose?: boolean;
}

async function lintCommand(
  evalsDir: string,
  opts: LintOptions,
): Promise<void> {
  const resolvedDir = resolve(evalsDir);

  // Discover scenarios
  let scenarios = await discoverScenarios(resolvedDir);
  if (scenarios.length === 0) {
    process.stderr.write(`[craboodle] No scenarios found in ${resolvedDir}\n`);
    process.exit(2);
  }

  // Apply scenario filter
  if (opts.scenarios) {
    scenarios = filterScenarios(scenarios, opts.scenarios);
    if (scenarios.length === 0) {
      process.stderr.write(`[craboodle] No scenarios match filter: ${opts.scenarios}\n`);
      process.exit(2);
    }
  }

  if (opts.verbose) {
    process.stderr.write(`[craboodle] Linting ${scenarios.length} scenario(s)\n`);
  }

  // Load craboodle config (validates structure)
  await loadCraboodleConfig(join(resolvedDir, "craboodle.yaml"));

  // Stream header
  process.stdout.write("scenarios:\n");

  // Run pincenez lint per scenario with concurrency control
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(opts.concurrency);

  const totals: LintTotals = {
    scenarios_total: scenarios.length,
    scenarios_with_issues: 0,
    checks_total: 0,
    checks_with_issues: 0,
  };
  let hasAnySuccess = false;

  const promises = scenarios.map((scenario) =>
    limit(async () => {
      const checksPath = join(dirname(scenario.configPath), "checks.yaml");

      if (opts.verbose) {
        process.stderr.write(`[craboodle] ${scenario.id}: linting checks\n`);
      }

      // Read scenario prompt to pass as context for tautological detection
      let context: string | undefined;
      try {
        const scenarioContent = await readFile(scenario.configPath, "utf8");
        const scenarioYaml = parse(scenarioContent) as Record<string, unknown>;
        if (typeof scenarioYaml?.prompt === "string") {
          context = scenarioYaml.prompt;
        }
      } catch {
        // scenario.yaml is optional for lint — proceed without context
      }

      const result = await runPincenezLint({
        checksPath,
        graderModel: opts.graderModel,
        context,
      });

      if (!result.success) {
        process.stderr.write(
          `[craboodle] ${scenario.id}: pincenez lint failed: ${result.error.message}\n`,
        );
        return;
      }

      hasAnySuccess = true;
      const checks = parseLintResult(result.stdout);
      const withIssues = checks.filter((a) => a.issues.length > 0).length;

      totals.checks_total += checks.length;
      totals.checks_with_issues += withIssues;
      if (withIssues > 0) {
        totals.scenarios_with_issues += 1;
      }

      streamLintScenarioYaml({
        id: scenario.id,
        checks,
        checks_total: checks.length,
        checks_with_issues: withIssues,
      });
    }),
  );

  await Promise.allSettled(promises);

  // Stream totals
  streamLintTotals(totals);

  if (!hasAnySuccess) {
    process.exit(2);
  }

  if (totals.checks_with_issues > 0) {
    process.exit(1);
  }
}

program
  .command("lint <evals-dir>")
  .description("Lint checks for quality issues without running evals")
  .option("--concurrency <n>", "Max parallel pincenez lint invocations", "10")
  .option("--scenario, --scenarios <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
  .option("--grader-model <model>", "Override pincenez model for linting")
  .option("-v, --verbose", "Verbose logging (to stderr)")
  .action(async (evalsDir: string, cmdOpts: Record<string, string>) => {
    try {
      await lintCommand(evalsDir, {
        concurrency: parseInt(cmdOpts.concurrency, 10),
        graderModel: cmdOpts.graderModel,
        scenarios: cmdOpts.scenarios,
        verbose: !!cmdOpts.verbose,
      });
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(2);
    }
  });

program
  .command("init <dir>")
  .description("Scaffold a new evals directory with craboodle.yaml")
  .action(async (dir: string) => {
    const resolvedDir = resolve(dir);

    // Check if directory already has eval files
    try {
      await access(join(resolvedDir, "craboodle.yaml"));
      process.stderr.write(`[craboodle] ${resolvedDir} already contains craboodle.yaml\n`);
      process.exit(1);
    } catch {
      // craboodle.yaml doesn't exist, good
    }

    try {
      const dirStat = await stat(resolvedDir);
      if (dirStat.isDirectory()) {
        const { glob: globFn } = await import("glob");
        const existing = await globFn("*/scenario.{yaml,yml}", { cwd: resolvedDir });
        if (existing.length > 0) {
          process.stderr.write(`[craboodle] ${resolvedDir} already contains scenario files\n`);
          process.exit(1);
        }
      }
    } catch {
      // directory doesn't exist, we'll create it
    }

    await mkdir(resolvedDir, { recursive: true });

    const craboodleContent =
      `version: "1"\n` +
      `# min_pass_rate:      # uncomment and set; reachable values are k/(checks*reps)\n` +
      `# max_budget_usd:\n` +
      `# repeats:\n`;
    await writeFile(join(resolvedDir, "craboodle.yaml"), craboodleContent);

    const baseContent =
      `# base.yaml — shared scuttlerun config for all scenarios in this suite.\n` +
      `# Every scenario.yaml is deep-merged onto this base; arrays like \`tools\` REPLACE\n` +
      `# the defaults rather than extending them, so list every tool you need.\n` +
      `# Scuttlerun's defaults at time of scaffold are shown below — uncomment and edit.\n` +
      `#\n` +
      `# model: claude-haiku-4-5\n` +
      `# tools:\n` +
      `#   - Read\n` +
      `#   - Write\n` +
      `#   - Edit\n` +
      `#   - Bash\n` +
      `#   - Glob\n` +
      `#   - Grep\n` +
      `#   - AskUserQuestion\n` +
      `#   - Skill\n` +
      `# project:\n` +
      `#   claude_md: |\n` +
      `#     # Project-level instructions here\n` +
      `#   skills:\n` +
      `#     - /absolute/path/to/skill\n` +
      `# user:\n` +
      `#   max_turns: 30\n`;
    await writeFile(join(resolvedDir, "base.yaml"), baseContent);

    process.stdout.write(`Created ${resolvedDir}/\n`);
    process.stdout.write(`  craboodle.yaml\n`);
    process.stdout.write(`  base.yaml\n`);
    process.stdout.write(`\nNext steps:\n`);
    process.stdout.write(`  Create <scenario-id>/scenario.yaml and <scenario-id>/checks.yaml\n`);
    process.stdout.write(`  craboodle list ${dir}     # validate scenarios\n`);
    process.stdout.write(`  craboodle lint ${dir}     # check quality\n`);
    process.stdout.write(`  craboodle run ${dir}      # run eval pipeline\n`);
  });

program.parse();

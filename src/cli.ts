#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, readFile, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify, Document, Scalar, visit } from "yaml";
import { resolve } from "node:path";

import { loadScenarioConfig, loadBaseConfig } from "./config.js";
import { cleanOldArtifacts } from "./cleanup.js";
import { discoverScenarios, filterScenarios } from "./discovery.js";
import { buildScuttlerunOverride, buildChecksFile } from "./builder.js";
import { runScuttlerun, runPincenez, runPincenezLint, listScuttlerunConfig } from "./runner.js";
import { executePool, type WorkItem } from "./pool.js";
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
  scenario?: string;
  verbose?: boolean;
}

type RepOutcome =
  | { type: "success"; grading: GradingCheck[]; costUsd: number | null; gradingCostUsd: number | null }
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
  if (opts.scenario) {
    scenarios = filterScenarios(scenarios, opts.scenario);
    if (scenarios.length === 0) {
      process.stderr.write(
        `[craboodle] No scenarios match filter: ${opts.scenario}\n`,
      );
      process.exit(2);
    }
  }

  if (opts.verbose) {
    process.stderr.write(
      `[craboodle] Found ${scenarios.length} scenario(s)\n`,
    );
  }

  // Load base config
  const { version, minPassRate, maxBudgetUsd, scuttlerunConfig: baseConfig } = await loadBaseConfig(join(resolvedDir, "base.yaml"));

  if (opts.verbose && version) {
    process.stderr.write(`[craboodle] Eval format version: ${version}\n`);
  }

  // Clean old artifacts before creating new ones
  await cleanOldArtifacts(7, { verbose: opts.verbose });

  // Create artifact directory
  const artifactDir = await mkdtemp(join(tmpdir(), "craboodle-run-"));

  // Write filtered base config (without craboodle keys) for scuttlerun
  let basePath: string | null = null;
  if (baseConfig) {
    basePath = join(artifactDir, "base.yaml");
    await writeFile(basePath, stringify(baseConfig));
  }

  // Stream header
  streamHeader(artifactDir);

  // Load all scenario configs
  const scenarioConfigs = new Map<
    string,
    Awaited<ReturnType<typeof loadScenarioConfig>>
  >();
  for (const scenario of scenarios) {
    try {
      const config = await loadScenarioConfig(scenario.configPath);
      scenarioConfigs.set(scenario.id, config);
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Config error in ${scenario.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  }

  // Build work items
  const workItems: WorkItem<RepOutcome>[] = [];
  for (const scenario of scenarios) {
    const config = scenarioConfigs.get(scenario.id)!;
    const scenarioRepeats = config.repeats ?? opts.repeats;
    for (let rep = 1; rep <= scenarioRepeats; rep++) {
      workItems.push({
        scenarioId: scenario.id,
        rep,
        fn: async (): Promise<RepOutcome> => {
          const repDir = join(artifactDir, scenario.id, `rep-${rep}`);
          await mkdir(repDir, { recursive: true });

          const override = buildScuttlerunOverride(config);
          const checksFile = buildChecksFile(config);

          // Write checks file
          const checksPath = join(repDir, "checks.yaml");
          await writeFile(checksPath, stringify(checksFile));

          const outputPath = join(repDir, "output.yaml");
          const gradingPath = join(repDir, "grading.yaml");

          if (opts.verbose) {
            process.stderr.write(
              `[craboodle] ${scenario.id} rep ${rep}: running scuttlerun\n`,
            );
          }

          // Run scuttlerun
          const scuttlerunResult = await runScuttlerun({
            override,
            basePath,
            outputPath,
            tmpDir: repDir,
            agentModel: opts.agentModel,
          });

          if (!scuttlerunResult.success) {
            return {
              type: "error",
              rep,
              stage: scuttlerunResult.error.stage,
              message: scuttlerunResult.error.message,
              transcriptPath: outputPath,
            };
          }

          if (opts.verbose) {
            process.stderr.write(
              `[craboodle] ${scenario.id} rep ${rep}: running pincenez\n`,
            );
          }

          // Run pincenez
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

          // Parse grading
          const gradingContent = await readFile(gradingPath, "utf8");
          const gradingResult = parseGrading(gradingContent);

          // Parse cost from scuttlerun output
          const outputContent = await readFile(outputPath, "utf8");
          const costUsd = parseCostFromTranscript(outputContent);

          return { type: "success", grading: gradingResult.checks, costUsd, gradingCostUsd: gradingResult.costUsd };
        },
      });
    }
  }

  // Execute pool with arrival-order streaming
  let hasAnySuccess = false;
  const scenarioOutputs: ScenarioOutput[] = [];

  await executePool(workItems, opts.concurrency, {
    budgetUsd: maxBudgetUsd,
    costOf: (outcome: RepOutcome) => {
      if (outcome.type !== "success") return 0;
      let cost = 0;
      if (outcome.costUsd !== null) cost += outcome.costUsd;
      if (outcome.gradingCostUsd !== null) cost += outcome.gradingCostUsd;
      return cost;
    },
    onScenarioComplete: (scenarioId, repResults) => {
      const config = scenarioConfigs.get(scenarioId)!;

      const successfulGradings: GradingCheck[][] = [];
      const errors: Array<{ rep: number; stage: string; error: string }> = [];
      let agentCost = 0;
      let gradingCost = 0;

      for (const result of repResults) {
        if (result.type === "success") {
          const outcome = result.data;
          if (outcome.type === "success") {
            successfulGradings.push(outcome.grading);
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
      const costFields = {
        ...(totalScenarioCost > 0 ? { cost_usd: totalScenarioCost } : {}),
        ...(agentCost > 0 ? { agent_cost_usd: agentCost } : {}),
        ...(gradingCost > 0 ? { grading_cost_usd: gradingCost } : {}),
      };

      if (successfulGradings.length === 0) {
        scenarioOutput = {
          id: scenarioId,

          checks: config.checks.map((a) => ({
            check: a.check,
            pass_rate: 0,
          })),
          pass_rate: null,
          ...costFields,
          errors,
        };
      } else {
        const averaged = averageResults(successfulGradings);
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
    },
  });

  // Stream total cost
  const totalCost = scenarioOutputs.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  if (totalCost > 0) {
    streamTotalCost(totalCost);
  }

  if (!hasAnySuccess) {
    process.exit(2);
  }

  // Check ratchet threshold
  if (minPassRate !== undefined) {
    const failures = scenarioOutputs.filter(
      (s) => s.pass_rate === null || s.pass_rate < minPassRate,
    );
    if (failures.length > 0) {
      process.stderr.write(`[craboodle] Threshold check failed (min_pass_rate: ${minPassRate}):\n`);
      for (const f of failures) {
        process.stderr.write(`  ${f.id}: ${f.pass_rate ?? "null"} < ${minPassRate}\n`);
      }
      process.exit(3);
    }
  }
}

const HELP_TEXT = `
Directory Structure:
  craboodle discovers scenarios by globbing */scenario.yaml within <evals-dir>:

    <evals-dir>/
    ├── base.yaml                    # Shared defaults (optional)
    ├── scenario-a/
    │   └── scenario.yaml            # Scenario definition
    ├── scenario-b/
    │   └── scenario.yaml
    └── ...

scenario.yaml Schema:
  Only 'prompt' and 'checks' are required. All other fields are optional.

    # --- Prompt (required, sent to scuttlerun) ---
    prompt: |
      Write a function that validates email addresses.

    # --- Checks (required, sent to pincenez) ---
    checks:
      - check: "Output contains a function that validates email format"
        note: "Look for regex or string parsing that checks for @ and domain"
      - check: "Function handles edge cases like empty string and missing @"

    # --- Context (optional, sent to pincenez for grading orientation) ---
    context: |
      The agent was asked to write an email validation function.

    # --- Repeats override (optional) ---
    # Per-scenario repeat count. Overrides --repeats for this scenario.
    repeats: 5

    # --- Scuttlerun overrides (optional) ---
    # Passthrough: any scuttlerun config fields. Craboodle does not
    # validate these — they are forwarded to scuttlerun as-is.
    # Common overrides: model, tools, user.persona, max_turns, project.files
    # Run 'scuttlerun run --help' for the full scuttlerun config reference.
    scuttlerun:
      model: claude-sonnet-4-6
      user:
        persona: "A developer who wants thorough validation"
      project:
        files:
          existing-code.py: |
            def placeholder():
                pass

  Field Reference:
    prompt              The task for the agent (required)
    checks[].check      Binary claim to evaluate (required)
    checks[].note       Grading hint for the judge (optional)
    context             Task description for the grader (optional, defaults to prompt)
    repeats             Per-scenario repeat count override (optional)
    scuttlerun          Scuttlerun config overrides, not validated (optional)

base.yaml Schema:
  Shared defaults applied to all scenarios. Craboodle owns 'version' and
  'min_pass_rate'; all other keys pass through to scuttlerun as base config.

    version: "1"                    # Schema version (required)
    min_pass_rate: 0.8              # Ratchet threshold — exit 3 if any scenario
                                    #   falls below (optional, 0-1)
    # --- Everything below passes through to scuttlerun ---
    model: claude-sonnet-4-6
    tools:
      - Read
      - Write
      - Bash
    user:
      turn_policy: single
    project:
      claude_md: |
        Use relative paths. Do not use absolute paths.
      skills:
        - ~/.claude/skills/my-skill

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
  3   Threshold failure (min_pass_rate ratchet violated)`;

const program = new Command();

program
  .name("craboodle")
  .description("Eval pipeline orchestrator for Claude Code")
  .version("0.1.0")
  .addHelpText("after", HELP_TEXT);

program
  .command("run <evals-dir>")
  .description("Run eval pipeline")
  .option("--repeats <n>", "Number of repetitions per scenario", "3")
  .option(
    "--concurrency <n>",
    "Max parallel (scenario, rep) work items",
    "10",
  )
  .option("--scenario <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
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
        scenario: cmdOpts.scenario,
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
  .option("--scenario <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
  .option("-v, --verbose", "Verbose logging (to stderr)")
  .action(async (evalsDir: string, cmdOpts: { scenario?: string; verbose?: boolean }) => {
    try {
      const resolvedDir = resolve(evalsDir);

      // Discover scenarios
      let scenarios = await discoverScenarios(resolvedDir);
      if (scenarios.length === 0) {
        process.stderr.write(`[craboodle] No scenarios found in ${resolvedDir}\n`);
        process.exit(2);
      }

      if (cmdOpts.scenario) {
        scenarios = filterScenarios(scenarios, cmdOpts.scenario);
        if (scenarios.length === 0) {
          process.stderr.write(`[craboodle] No scenarios match filter: ${cmdOpts.scenario}\n`);
          process.exit(2);
        }
      }

      // Load and validate base config
      const base = await loadBaseConfig(join(resolvedDir, "base.yaml"));

      // Write base config for scuttlerun validation
      let basePath: string | null = null;
      let tmpDir: string | null = null;
      if (base.scuttlerunConfig) {
        tmpDir = await mkdtemp(join(tmpdir(), "craboodle-list-"));
        basePath = join(tmpDir, "base.yaml");
        await writeFile(basePath, stringify(base.scuttlerunConfig));
      }

      // Output base config summary
      const baseSummary: Record<string, unknown> = {};
      if (base.version) baseSummary.version = base.version;
      if (base.minPassRate !== undefined) baseSummary.min_pass_rate = base.minPassRate;
      process.stdout.write(stringify({ base: baseSummary }, { lineWidth: 0 }));

      // Load and validate each scenario
      process.stdout.write(`scenarios:\n`);
      let totalChecks = 0;
      let invalidCount = 0;

      for (const scenario of scenarios) {
        try {
          const config = await loadScenarioConfig(scenario.configPath);
          const checkCount = config.checks.length;
          totalChecks += checkCount;

          const item: Record<string, unknown> = {
            id: scenario.id,
            checks: checkCount,
          };
          if (config.repeats) item.repeats = config.repeats;

          // Validate merged scuttlerun config via subprocess
          if (!tmpDir) {
            tmpDir = await mkdtemp(join(tmpdir(), "craboodle-list-"));
          }
          const override = buildScuttlerunOverride(config);
          const result = await listScuttlerunConfig({
            override,
            basePath,
            tmpDir,
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

      // Clean up temp dir
      if (tmpDir) {
        const { rm } = await import("node:fs/promises");
        await rm(tmpDir, { recursive: true }).catch(() => {});
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
  scenario?: string;
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
  if (opts.scenario) {
    scenarios = filterScenarios(scenarios, opts.scenario);
    if (scenarios.length === 0) {
      process.stderr.write(`[craboodle] No scenarios match filter: ${opts.scenario}\n`);
      process.exit(2);
    }
  }

  if (opts.verbose) {
    process.stderr.write(`[craboodle] Linting ${scenarios.length} scenario(s)\n`);
  }

  // Load base config (validates structure)
  await loadBaseConfig(join(resolvedDir, "base.yaml"));

  // Create transient temp dir for rubric files
  const tmpDir = await mkdtemp(join(tmpdir(), "craboodle-lint-"));

  // Load all scenario configs
  const scenarioConfigs = new Map<
    string,
    Awaited<ReturnType<typeof loadScenarioConfig>>
  >();
  for (const scenario of scenarios) {
    try {
      const config = await loadScenarioConfig(scenario.configPath);
      scenarioConfigs.set(scenario.id, config);
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Config error in ${scenario.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  }

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
      const config = scenarioConfigs.get(scenario.id)!;
      const checksFile = buildChecksFile(config);

      // Write checks file to temp
      const checksPath = join(tmpDir, `${scenario.id}-checks.yaml`);
      await writeFile(checksPath, stringify(checksFile));

      if (opts.verbose) {
        process.stderr.write(`[craboodle] ${scenario.id}: linting ${config.checks.length} check(s)\n`);
      }

      const result = await runPincenezLint({
        checksPath,
        graderModel: opts.graderModel,
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

  // Clean up temp dir
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true }).catch(() => {});

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
  .option("--scenario <pattern>", "Filter scenarios by ID (exact, glob, or comma-separated)")
  .option("--grader-model <model>", "Override pincenez model for linting")
  .option("-v, --verbose", "Verbose logging (to stderr)")
  .action(async (evalsDir: string, cmdOpts: Record<string, string>) => {
    try {
      await lintCommand(evalsDir, {
        concurrency: parseInt(cmdOpts.concurrency, 10),
        graderModel: cmdOpts.graderModel,
        scenario: cmdOpts.scenario,
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
  .description("Scaffold a new evals directory with base.yaml and example scenario")
  .action(async (dir: string) => {
    const resolvedDir = resolve(dir);

    // Check if directory already has eval files
    try {
      await access(join(resolvedDir, "base.yaml"));
      process.stderr.write(`[craboodle] ${resolvedDir} already contains base.yaml\n`);
      process.exit(1);
    } catch {
      // base.yaml doesn't exist, good
    }

    try {
      const dirStat = await stat(resolvedDir);
      if (dirStat.isDirectory()) {
        const { glob: globFn } = await import("glob");
        const existing = await globFn("*/scenario.yaml", { cwd: resolvedDir });
        if (existing.length > 0) {
          process.stderr.write(`[craboodle] ${resolvedDir} already contains scenario files\n`);
          process.exit(1);
        }
      }
    } catch {
      // directory doesn't exist, we'll create it
    }

    // Create directory structure
    await mkdir(join(resolvedDir, "hello-world"), { recursive: true });

    // Write base.yaml
    const baseContent = stringify({ version: "1", min_pass_rate: 0.8 });
    await writeFile(join(resolvedDir, "base.yaml"), baseContent);

    // Write example scenario
    const scenarioObj = {
      prompt: "Write a function that adds two numbers. Include input validation.\n",
      checks: [
        { check: "Output contains a function that adds two numbers", note: "Look for a function definition with addition logic" },
        { check: "Function validates inputs are numbers", note: "Look for type checking, parsing, or error handling for non-numeric inputs" },
      ],
    };
    const scenarioDoc = new Document(scenarioObj);
    visit(scenarioDoc, {
      Scalar(_key, node) {
        if (typeof node.value === "string" && node.value.includes("\n")) {
          node.type = Scalar.BLOCK_LITERAL;
        }
      },
    });
    await writeFile(join(resolvedDir, "hello-world", "scenario.yaml"), scenarioDoc.toString({ lineWidth: 0 }));

    process.stdout.write(`Created ${resolvedDir}/\n`);
    process.stdout.write(`  base.yaml\n`);
    process.stdout.write(`  hello-world/scenario.yaml\n`);
    process.stdout.write(`\nNext steps:\n`);
    process.stdout.write(`  craboodle list ${dir}     # validate scenarios\n`);
    process.stdout.write(`  craboodle lint ${dir}     # check quality\n`);
    process.stdout.write(`  craboodle run ${dir}      # run eval pipeline\n`);
  });

program.parse();

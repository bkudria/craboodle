#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { resolve } from "node:path";

import { loadScenarioConfig, loadBaseConfig } from "./config.js";
import { cleanOldArtifacts } from "./cleanup.js";
import { discoverScenarios, filterScenarios } from "./discovery.js";
import { buildScuttlerunOverride, buildRubric } from "./builder.js";
import { runScuttlerun, runPincenez } from "./runner.js";
import { executePool, type WorkItem } from "./pool.js";
import {
  parseGrading,
  parseCostFromTranscript,
  averageResults,
  streamHeader,
  streamScenarioYaml,
  streamTotalCost,
  type GradingAssertion,
  type ScenarioOutput,
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
  | { type: "success"; grading: GradingAssertion[]; costUsd: number | null }
  | { type: "error"; rep: number; stage: string; message: string };

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
  const { version, minPassRate, scuttlerunConfig: baseConfig } = await loadBaseConfig(join(resolvedDir, "base.yml"));

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
    basePath = join(artifactDir, "base.yml");
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
          const rubric = buildRubric(config);

          // Write rubric
          const rubricPath = join(repDir, "rubric.yml");
          await writeFile(rubricPath, stringify(rubric));

          const outputPath = join(repDir, "output.yml");
          const gradingPath = join(repDir, "grading.yml");

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
            };
          }

          if (opts.verbose) {
            process.stderr.write(
              `[craboodle] ${scenario.id} rep ${rep}: running pincenez\n`,
            );
          }

          // Run pincenez
          const pincenezResult = await runPincenez({
            rubricPath,
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
            };
          }

          // Parse grading
          const gradingContent = await readFile(gradingPath, "utf8");
          const grading = parseGrading(gradingContent);

          // Parse cost from scuttlerun output
          const outputContent = await readFile(outputPath, "utf8");
          const costUsd = parseCostFromTranscript(outputContent);

          return { type: "success", grading, costUsd };
        },
      });
    }
  }

  // Execute pool
  const poolResults = await executePool(workItems, opts.concurrency);

  // Process results per scenario
  let hasAnySuccess = false;
  const scenarioOutputs: ScenarioOutput[] = [];
  for (const scenario of scenarios) {
    const config = scenarioConfigs.get(scenario.id)!;
    const repResults = poolResults.get(scenario.id) || [];

    const successfulGradings: GradingAssertion[][] = [];
    const errors: Array<{ rep: number; stage: string; error: string }> = [];
    let scenarioCost = 0;

    for (const result of repResults) {
      if (result.type === "success") {
        const outcome = result.data;
        if (outcome.type === "success") {
          successfulGradings.push(outcome.grading);
          hasAnySuccess = true;
          if (outcome.costUsd !== null) {
            scenarioCost += outcome.costUsd;
          }
        } else {
          errors.push({
            rep: outcome.rep,
            stage: outcome.stage,
            error: outcome.message,
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

    if (successfulGradings.length === 0) {
      scenarioOutput = {
        id: scenario.id,
        ...(config.labels ? { labels: config.labels } : {}),
        assertions: config.assertions.map((a) => ({
          check: a.check,
          pass_rate: 0,
        })),
        pass_rate: null,
        ...(scenarioCost > 0 ? { cost_usd: scenarioCost } : {}),
        errors,
      };
    } else {
      const averaged = averageResults(successfulGradings);
      scenarioOutput = {
        id: scenario.id,
        ...(config.labels ? { labels: config.labels } : {}),
        assertions: averaged.assertions,
        pass_rate: averaged.pass_rate,
        ...(scenarioCost > 0 ? { cost_usd: scenarioCost } : {}),
        ...(errors.length > 0 ? { errors } : {}),
      };
    }

    scenarioOutputs.push(scenarioOutput);
    streamScenarioYaml(scenarioOutput);

    if (opts.verbose) {
      process.stderr.write(
        `[craboodle] ${scenario.id}: pass_rate=${scenarioOutput.pass_rate}\n`,
      );
    }
  }

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
  craboodle discovers scenarios by globbing */scenario.yml within <evals-dir>:

    <evals-dir>/
    ├── base.yml                    # Shared defaults (optional)
    ├── scenario-a/
    │   └── scenario.yml            # Scenario definition
    ├── scenario-b/
    │   └── scenario.yml
    └── ...

scenario.yml Schema:
  Only 'prompt' and 'assertions' are required. All other fields are optional.

    # --- Prompt (required, sent to scuttlerun) ---
    prompt: |
      Write a function that validates email addresses.

    # --- Assertions (required, sent to pincenez as rubric) ---
    assertions:
      - check: "Output contains a function that validates email format"
        note: "Look for regex or string parsing that checks for @ and domain"
      - check: "Function handles edge cases like empty string and missing @"

    # --- Labels (optional, passthrough to output) ---
    # Key-value pairs for downstream comparison/grouping.
    # Craboodle does not interpret labels — they pass through to output as-is.
    labels:
      name: "Human-readable scenario name"
      config: optimized

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
    assertions[].check  Binary claim to evaluate (required)
    assertions[].note   Grading hint for the judge (optional)
    labels              Key-value metadata, passed through to output (optional)
    context             Task description for the grader (optional, defaults to prompt)
    repeats             Per-scenario repeat count override (optional)
    scuttlerun          Scuttlerun config overrides, not validated (optional)

base.yml Schema:
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
        labels:
          config: optimized
        assertions:
          - check: "Output contains a function that validates email format"
            pass_rate: 1.0
          - check: "Function handles edge cases"
            pass_rate: 0.5
            failures:
              - rep: 1
                evidence: "No empty string handling found"
        pass_rate: 0.83
        cost_usd: 0.0234
    total_cost_usd: 0.0234

  Passing assertions are compact (check + pass_rate). Failing assertions
  include per-rep evidence. pass_rate is a fraction (0.0-1.0), never binary.

Examples:
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
  .option("--grader-model <model>", "Override pincenez model for all assertions")
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

program.parse();

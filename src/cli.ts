#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { resolve } from "node:path";

import { loadScenarioConfig, loadBaseConfig } from "./config.js";
import { discoverScenarios } from "./discovery.js";
import { buildScuttlerunOverride, buildRubric } from "./builder.js";
import { runScuttlerun, runPincenez } from "./runner.js";
import { executePool, type WorkItem } from "./pool.js";
import {
  parseGrading,
  averageResults,
  streamHeader,
  streamScenarioYaml,
  type GradingAssertion,
  type ScenarioOutput,
} from "./output.js";

interface RunOptions {
  repeats: number;
  concurrency: number;
  agentModel?: string;
  graderModel?: string;
  verbose?: boolean;
}

type RepOutcome =
  | { type: "success"; grading: GradingAssertion[] }
  | { type: "error"; rep: number; stage: string; message: string };

async function runCommand(
  evalsDir: string,
  opts: RunOptions,
): Promise<void> {
  const resolvedDir = resolve(evalsDir);

  // Discover scenarios
  const scenarios = await discoverScenarios(resolvedDir);
  if (scenarios.length === 0) {
    process.stderr.write(
      `[craboodle] No scenarios found in ${resolvedDir}\n`,
    );
    process.exit(2);
  }

  if (opts.verbose) {
    process.stderr.write(
      `[craboodle] Found ${scenarios.length} scenario(s)\n`,
    );
  }

  // Load base config
  const { minPassRate, scuttlerunConfig: baseConfig } = await loadBaseConfig(join(resolvedDir, "base.yml"));

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
    for (let rep = 1; rep <= opts.repeats; rep++) {
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

          return { type: "success", grading };
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

    for (const result of repResults) {
      if (result.type === "success") {
        const outcome = result.data;
        if (outcome.type === "success") {
          successfulGradings.push(outcome.grading);
          hasAnySuccess = true;
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
        errors,
      };
    } else {
      const averaged = averageResults(successfulGradings);
      scenarioOutput = {
        id: scenario.id,
        ...(config.labels ? { labels: config.labels } : {}),
        assertions: averaged.assertions,
        pass_rate: averaged.pass_rate,
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

const program = new Command();

program
  .name("craboodle")
  .description("Eval pipeline orchestrator for Claude Code")
  .version("0.1.0");

program
  .command("run <evals-dir>")
  .description("Run eval pipeline")
  .option("--repeats <n>", "Number of repetitions per scenario", "3")
  .option(
    "--concurrency <n>",
    "Max parallel (scenario, rep) work items",
    "10",
  )
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

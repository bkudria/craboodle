import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import pLimit from 'p-limit';
import { formatErrorWithHint } from '../messages.js';
import { installSignalHandler } from '../signals.js';
import { resolveRepeatsFromRawFlag } from '../config.js';
import { cleanOldArtifacts } from '../cleanup.js';
import { filterScenarios } from '../discovery.js';
import { runScuttlerun, runPincenez } from '../runner.js';
import { findMissingBinaries, formatMissingBinariesError } from '../preflight.js';
import { executePool, type WorkItem } from '../pool.js';
import { runStaged } from '../staged.js';
import { loadStageBResult } from '../stage-b-load.js';
import { prepareRun } from '../prepare-run.js';
import {
  averageResults,
  streamHeader,
  streamScenarioYaml,
  streamTotalCost,
  type GradingCheck,
  type ScenarioOutput,
} from '../output.js';

export interface RunOptions {
  repeats: string | undefined;
  concurrency: number;
  agentModel?: string;
  graderModel?: string;
  scenarios?: string;
  verbose?: boolean;
}

type RepOutcome =
  | {
      type: 'success';
      grading: GradingCheck[];
      costUsd: number | null;
      gradingCostUsd: number | null;
      transcriptPath: string;
    }
  | { type: 'error'; rep: number; stage: string; message: string; transcriptPath?: string };

export async function runCommand(root: string, opts: RunOptions): Promise<void> {
  const controller = new AbortController();
  let interrupted = false;
  const uninstallSignal = installSignalHandler({
    controller,
    onFirstSignal: () => {
      interrupted = true;
    },
  });

  try {
    return await runCommandInner(root, opts, controller, () => interrupted);
  } finally {
    uninstallSignal();
    if (interrupted) {
      process.exit(130);
    }
  }
}

async function runCommandInner(
  root: string,
  opts: RunOptions,
  controller: AbortController,
  isInterrupted: () => boolean,
): Promise<void> {
  const resolvedRoot = resolve(root);

  // Pre-flight: companion CLIs must be on PATH
  const missing = await findMissingBinaries(['scuttlerun', 'pincenez']);
  if (missing.length > 0) {
    process.stderr.write(formatMissingBinariesError(missing));
    process.exit(4);
  }

  // Load evals.yaml, stage filtered view, materialise scuttlerun base config,
  // and discover scenarios.
  const prepared = await prepareRun(resolvedRoot);
  const { basePath, pipeline } = prepared;
  let scenarios = prepared.scenarios;

  if (scenarios.length === 0) {
    process.stderr.write(
      formatErrorWithHint(
        `No scenarios found in ${resolvedRoot}`,
        `craboodle init ${resolvedRoot}`,
        'craboodle --help',
      ),
    );
    process.exit(4);
  }

  // Apply scenario filter
  if (opts.scenarios) {
    scenarios = filterScenarios(scenarios, opts.scenarios);
    if (scenarios.length === 0) {
      process.stderr.write(
        formatErrorWithHint(
          `No scenarios match filter: ${opts.scenarios}`,
          `craboodle list ${resolvedRoot} to see available IDs`,
          'craboodle --help',
        ),
      );
      process.exit(4);
    }
  }

  if (opts.verbose) {
    process.stderr.write(`[craboodle] Found ${scenarios.length} scenario(s)\n`);
  }

  // Clean old artifacts before creating new ones (0 = disabled)
  await cleanOldArtifacts(pipeline.artifactRetentionDays ?? 7, { verbose: opts.verbose });

  // Create artifact directory
  const artifactDir = await mkdtemp(join(tmpdir(), 'craboodle-run-'));

  // Stream header
  streamHeader(artifactDir);

  // Determine repeats: CLI flag > evals.yaml > DEFAULT_REPEATS
  const repeats = resolveRepeatsFromRawFlag(opts.repeats, pipeline.repeats);

  const scuttleLimit = pLimit(opts.concurrency);
  const pincenezLimit = pLimit(opts.concurrency);

  type StageAResult = { ok: true } | { ok: false; outcome: RepOutcome };

  // Build work items
  const workItems: WorkItem<RepOutcome>[] = [];
  for (const scenario of scenarios) {
    const checksPath = join(dirname(scenario.configPath), 'checks.yaml');

    for (let rep = 1; rep <= repeats; rep++) {
      workItems.push({
        scenarioId: scenario.id,
        rep,
        fn: async (): Promise<RepOutcome> => {
          const repDir = join(artifactDir, scenario.id, `rep-${rep}`);
          await mkdir(repDir, { recursive: true });

          const outputPath = join(repDir, 'output.yaml');
          const gradingPath = join(repDir, 'grading.yaml');

          const stageA = async (): Promise<StageAResult> => {
            if (opts.verbose) {
              process.stderr.write(`[craboodle] ${scenario.id} rep ${rep}: running scuttlerun\n`);
            }
            const scuttlerunResult = await runScuttlerun({
              scenarioPath: scenario.configPath,
              basePath,
              outputPath,
              agentModel: opts.agentModel,
              signal: controller.signal,
            });
            if (!scuttlerunResult.success) {
              return {
                ok: false,
                outcome: {
                  type: 'error',
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
              process.stderr.write(`[craboodle] ${scenario.id} rep ${rep}: running pincenez\n`);
            }
            const pincenezResult = await runPincenez({
              checksPath,
              outputPath,
              gradingPath,
              graderModel: opts.graderModel,
              signal: controller.signal,
            });
            if (!pincenezResult.success) {
              return {
                type: 'error',
                rep,
                stage: pincenezResult.error.stage,
                message: pincenezResult.error.message,
                transcriptPath: outputPath,
              };
            }
            return loadStageBResult({ gradingPath, outputPath, rep });
          };

          const result = await runStaged(scuttleLimit, pincenezLimit, stageA, (a) => a.ok, stageB);
          if (typeof result === 'object' && 'ok' in result && result.ok === false) {
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
  let budgetExceeded = false;
  const scenarioOutputs: ScenarioOutput[] = [];

  await executePool(workItems, workItems.length, {
    budgetUsd: pipeline.maxBudgetUsd,
    costOf: (outcome: RepOutcome) => {
      if (outcome.type !== 'success') return 0;
      let cost = 0;
      if (outcome.costUsd !== null) cost += outcome.costUsd;
      if (outcome.gradingCostUsd !== null) cost += outcome.gradingCostUsd;
      return cost;
    },
    shouldAbort: () => failFastTriggered,
    isInterrupted: () => isInterrupted(),
    onBudgetExceeded: () => {
      budgetExceeded = true;
    },
    onScenarioComplete: (scenarioId, repResults) => {
      const successfulGradings: GradingCheck[][] = [];
      const repTranscripts: string[] = [];
      const errors: Array<{ rep: number; stage: string; error: string }> = [];
      let agentCost = 0;
      let gradingCost = 0;

      for (const result of repResults) {
        if (result.type === 'success') {
          const outcome = result.data;
          if (outcome.type === 'success') {
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
            stage: result.reason ?? 'unknown',
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
      streamScenarioYaml(scenarioOutput, { artifactDir });

      if (opts.verbose) {
        process.stderr.write(`[craboodle] ${scenarioId}: pass_rate=${scenarioOutput.pass_rate}\n`);
      }

      if (
        pipeline.minPassRate !== undefined &&
        (scenarioOutput.pass_rate === null || scenarioOutput.pass_rate < pipeline.minPassRate)
      ) {
        if (!failFastTriggered && opts.verbose) {
          process.stderr.write(
            `[craboodle] Fail-fast triggered: ${scenarioId} pass_rate=${scenarioOutput.pass_rate} < ${pipeline.minPassRate}\n`,
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

  if (isInterrupted()) {
    return;
  }

  if (budgetExceeded) {
    process.stderr.write(
      formatErrorWithHint(
        `Budget exceeded (max_budget_usd: ${pipeline.maxBudgetUsd})`,
        'raise max_budget_usd in evals.yaml',
        'craboodle --help',
      ),
    );
    process.exit(5);
  }

  if (!hasAnySuccess) {
    process.exit(4);
  }

  // Check ratchet threshold
  const minPassRate = pipeline.minPassRate;
  if (minPassRate !== undefined) {
    const failures = scenarioOutputs.filter(
      (s) => s.pass_rate === null || s.pass_rate < minPassRate,
    );
    if (failures.length > 0) {
      process.stderr.write(`[craboodle] Threshold check failed (min_pass_rate: ${minPassRate}):\n`);
      for (const f of failures) {
        process.stderr.write(`  ${f.id}: ${f.pass_rate ?? 'null'} < ${minPassRate}\n`);
      }
      process.stderr.write('  Try: re-run with -v for per-rep failure context\n');
      process.stderr.write('  See: craboodle --help\n');
      process.exit(3);
    }
  }
}

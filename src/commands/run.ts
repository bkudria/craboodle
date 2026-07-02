import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import pLimit from 'p-limit';
import { formatErrorWithHint } from '../errors.js';
import { installSignalHandler } from '../signals.js';
import { parseTimeoutFlag, resolveRepeatsFromRawFlag } from '../config.js';
import { cleanOldArtifacts } from '../cleanup.js';
import { filterScenarios } from '../discovery.js';
import { runScuttlerun, runPincenez } from '../runner.js';
import { resolveScenarioGrounding, type ScenarioGrounding } from '../grounding.js';
import { findMissingBinaries, formatMissingBinariesError } from '../preflight.js';
import { executePool, type WorkItem } from '../pool.js';
import { runStaged } from '../staged.js';
import {
  loadStageBResult,
  readTranscriptCost,
  repOutcomeCost,
  type RepOutcome,
} from '../stage-b-load.js';
import { prepareRun } from '../prepare-run.js';
import {
  averageResults,
  evaluateGate,
  resolveRunVerdict,
  scenarioErrorRate,
  streamHeader,
  streamScenarioYaml,
  streamTotalCost,
  streamVerdict,
  type GradingCheck,
  type ScenarioOutput,
} from '../output.js';
import { EXIT_INFRA_ERROR, EXIT_SIGINT } from '../exit-codes.js';

// Resolve the scenario's prompt once, shared across all reps; lazy so
// scenarios whose reps never reach grading skip the dry-run entirely.
function makeGroundingResolver(
  scenario: { id: string; configPath: string },
  basePath: string,
  signal: AbortSignal,
): () => Promise<ScenarioGrounding> {
  let promise: Promise<ScenarioGrounding> | undefined;
  return () =>
    (promise ??= resolveScenarioGrounding(
      scenario.id,
      scenario.configPath,
      basePath,
      'grading',
      signal,
    ));
}

export interface RunOptions {
  repeats: string | undefined;
  concurrency: number;
  timeout?: string;
  agentModel?: string;
  graderModel?: string;
  auth?: string;
  scenarios?: string;
  verbose?: boolean;
}

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
      process.exit(EXIT_SIGINT);
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
    process.exit(EXIT_INFRA_ERROR);
  }

  // Parse the timeout flag early so validation errors surface before staging.
  const cliTimeout = parseTimeoutFlag(opts.timeout);

  // Load evals.yaml, stage filtered view, materialise scuttlerun base config,
  // and discover scenarios. The CLI timeout (if any) is injected into the
  // materialised base config so scuttlerun receives it via its top-level
  // `timeout:` field; evals.yaml's top-level `timeout:` is the fallback.
  const prepared = await prepareRun(resolvedRoot, { cliTimeout });
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
    process.exit(EXIT_INFRA_ERROR);
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
      process.exit(EXIT_INFRA_ERROR);
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

  // Credential preference forwarded to both tools: CLI flag > evals.yaml
  const auth = opts.auth ?? pipeline.auth;

  const scuttleLimit = pLimit(opts.concurrency);
  const pincenezLimit = pLimit(opts.concurrency);

  type StageAResult = { ok: true } | { ok: false; outcome: RepOutcome };

  // Build work items
  const workItems: WorkItem<RepOutcome>[] = [];
  for (const scenario of scenarios) {
    const checksPath = join(dirname(scenario.configPath), 'checks.yaml');

    const getGrounding = makeGroundingResolver(scenario, basePath, controller.signal);

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
              auth,
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
                  costUsd: await readTranscriptCost(scuttlerunResult.error.transcriptPath),
                  ...(scuttlerunResult.error.exitCode !== undefined
                    ? { exitCode: scuttlerunResult.error.exitCode }
                    : {}),
                  ...(scuttlerunResult.error.transcriptPath !== undefined
                    ? { transcriptPath: scuttlerunResult.error.transcriptPath }
                    : {}),
                },
              };
            }
            return { ok: true };
          };

          const stageB = async (_a: StageAResult): Promise<RepOutcome> => {
            if (opts.verbose) {
              process.stderr.write(`[craboodle] ${scenario.id} rep ${rep}: running pincenez\n`);
            }
            const grounding = await getGrounding();
            const pincenezResult = await runPincenez({
              checksPath,
              outputPath,
              gradingPath,
              graderModel: opts.graderModel,
              context: grounding.context,
              auth,
              signal: controller.signal,
            });
            if (!pincenezResult.success) {
              return {
                type: 'error',
                rep,
                stage: pincenezResult.error.stage,
                message: pincenezResult.error.message,
                costUsd: await readTranscriptCost(outputPath),
                ...(pincenezResult.error.exitCode !== undefined
                  ? { exitCode: pincenezResult.error.exitCode }
                  : {}),
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
    costOf: repOutcomeCost,
    shouldAbort: () => failFastTriggered,
    isInterrupted: () => isInterrupted(),
    onBudgetExceeded: () => {
      budgetExceeded = true;
    },
    onScenarioComplete: (scenarioId, repResults) => {
      const successfulGradings: GradingCheck[][] = [];
      const repTranscripts: string[] = [];
      const errors: NonNullable<ScenarioOutput['errors']> = [];
      let agentCost = 0;
      let gradingCost = 0;
      const round4 = (n: number) => Math.round(n * 10000) / 10000;

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
            if (outcome.costUsd !== null) {
              agentCost += outcome.costUsd;
            }
            errors.push({
              rep: outcome.rep,
              stage: outcome.stage,
              error: outcome.message,
              ...(outcome.exitCode !== undefined ? { exit_code: outcome.exitCode } : {}),
              ...(outcome.transcriptPath ? { transcript: outcome.transcriptPath } : {}),
              ...(outcome.costUsd !== null ? { agent_cost_usd: round4(outcome.costUsd) } : {}),
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
      const costFields = {
        ...(totalScenarioCost > 0 ? { cost_usd: round4(totalScenarioCost) } : {}),
        ...(agentCost > 0 ? { agent_cost_usd: round4(agentCost) } : {}),
        ...(gradingCost > 0 ? { grading_cost_usd: round4(gradingCost) } : {}),
      };
      const errorRate = scenarioErrorRate(successfulGradings.length, errors);

      if (successfulGradings.length === 0) {
        scenarioOutput = {
          id: scenarioId,
          checks: [],
          pass_rate: null,
          error_rate: errorRate,
          ...costFields,
          errors,
        };
      } else {
        const averaged = averageResults(successfulGradings, repTranscripts);
        scenarioOutput = {
          id: scenarioId,
          checks: averaged.checks,
          pass_rate: averaged.pass_rate,
          error_rate: errorRate,
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
            `[craboodle] min_pass_rate breached by ${scenarioId} (pass_rate=${scenarioOutput.pass_rate} < ${pipeline.minPassRate}) — remaining queued reps will be aborted (fail-fast)\n`,
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

  // Gate the run. Reliability (error_rate) takes precedence over quality
  // (pass_rate), and both apply only when min_pass_rate opts the suite into
  // gating — otherwise the run is pure data collection.
  const gate = evaluateGate(scenarioOutputs, {
    minPassRate: pipeline.minPassRate,
    maxErrorRate: pipeline.maxErrorRate,
  });

  const verdict = resolveRunVerdict({ budgetExceeded, hasAnySuccess, gateKind: gate.kind });
  streamVerdict(verdict);

  if (budgetExceeded) {
    process.stderr.write(
      formatErrorWithHint(
        `Budget exceeded (max_budget_usd: ${pipeline.maxBudgetUsd})`,
        'raise max_budget_usd in evals.yaml',
        'craboodle --help',
      ),
    );
  } else if (!hasAnySuccess) {
    // No stderr detail: every rep's failure was already forwarded as it happened.
  } else if (gate.kind === 'reliability') {
    const maxErrorRate = pipeline.maxErrorRate ?? 0;
    process.stderr.write(
      `[craboodle] Reliability check failed (max_error_rate: ${maxErrorRate}):\n`,
    );
    for (const f of gate.failures) {
      const rate = Math.round((f.error_rate ?? 0) * 100) / 100;
      process.stderr.write(`  ${f.id}: error_rate=${rate} > ${maxErrorRate}\n`);
    }
    process.stderr.write(
      '  Crashed reps are excluded from pass_rate; inspect the scenario errors block.\n',
    );
    process.stderr.write('  See: craboodle --help\n');
  } else if (gate.kind === 'quality') {
    const minPassRate = pipeline.minPassRate;
    process.stderr.write(`[craboodle] Threshold check failed (min_pass_rate: ${minPassRate}):\n`);
    for (const f of gate.failures) {
      process.stderr.write(`  ${f.id}: ${f.pass_rate ?? 'null'} < ${minPassRate}\n`);
    }
    process.stderr.write('  Try: re-run with -v for per-rep failure context\n');
    process.stderr.write('  See: craboodle --help\n');
  }

  // process.exitCode (not process.exit) so Node flushes buffered stdout —
  // process.exit can truncate a piped stream, dropping the verdict trailer.
  process.exitCode = verdict.exitCode;
}

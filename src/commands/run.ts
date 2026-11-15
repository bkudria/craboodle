import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import pLimit from 'p-limit';
import { parseTimeoutFlag, resolveRepeatsFromRawFlag } from '../config.js';
import { cleanOldArtifacts } from '../cleanup.js';
import { runScuttlerun } from '../runner.js';
import { executePool, type WorkItem } from '../pool.js';
import { runStaged } from '../staged.js';
import { readTranscriptCost, repOutcomeCost, type RepOutcome } from '../stage-b-load.js';
import { prepareRun } from '../prepare-run.js';
import { streamHeader } from '../output.js';
import {
  finishGrading,
  gradeRep,
  makeGroundingResolver,
  makeScenarioStreamer,
  requireCompanionBinaries,
  selectRootScenarios,
  withInterruptHandling,
} from './grading-stage.js';

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
  return withInterruptHandling((controller, isInterrupted) =>
    runCommandInner(root, opts, controller, isInterrupted),
  );
}

async function runCommandInner(
  root: string,
  opts: RunOptions,
  controller: AbortController,
  isInterrupted: () => boolean,
): Promise<void> {
  const resolvedRoot = resolve(root);

  await requireCompanionBinaries();

  // Parse the timeout flag early so validation errors surface before staging.
  const cliTimeout = parseTimeoutFlag(opts.timeout);

  // Load evals.yaml, stage filtered view, materialise scuttlerun base config,
  // and discover scenarios. The CLI timeout (if any) is injected into the
  // materialised base config so scuttlerun receives it via its top-level
  // `timeout:` field; evals.yaml's top-level `timeout:` is the fallback.
  const prepared = await prepareRun(resolvedRoot, { cliTimeout });
  const { basePath, pipeline } = prepared;
  const scenarios = selectRootScenarios(prepared.scenarios, resolvedRoot, opts.scenarios);

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
        fn: async (admit): Promise<RepOutcome> => {
          const repDir = join(artifactDir, scenario.id, `rep-${rep}`);
          const outputPath = join(repDir, 'output.yaml');
          const gradingPath = join(repDir, 'grading.yaml');

          const stageA = async (): Promise<StageAResult> => {
            // The pool starts every item at once; a rep is dispatched only
            // when it gets its session slot, so that is where it is skipped.
            // A skipped rep leaves no rep dir behind.
            admit();
            await mkdir(repDir, { recursive: true });
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

          const stageB = (_a: StageAResult): Promise<RepOutcome> =>
            gradeRep({
              scenarioId: scenario.id,
              rep,
              checksPath,
              outputPath,
              gradingPath,
              getGrounding,
              graderModel: opts.graderModel,
              auth,
              signal: controller.signal,
              verbose: opts.verbose,
            });

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
  let budgetExceeded = false;
  const streamer = makeScenarioStreamer({
    artifactDir,
    minPassRate: pipeline.minPassRate,
    verbose: opts.verbose,
  });

  await executePool(workItems, workItems.length, {
    budgetUsd: pipeline.maxBudgetUsd,
    costOf: repOutcomeCost,
    shouldAbort: () => streamer.state.failFastTriggered,
    isInterrupted: () => isInterrupted(),
    onBudgetExceeded: () => {
      budgetExceeded = true;
    },
    onScenarioComplete: streamer.onScenarioComplete,
  });

  finishGrading({
    scenarioOutputs: streamer.state.scenarioOutputs,
    hasAnySuccess: streamer.state.hasAnySuccess,
    budgetExceeded,
    isInterrupted,
    pipeline,
  });
}

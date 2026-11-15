import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { cleanOldArtifacts } from '../cleanup.js';
import { executePool, type WorkItem } from '../pool.js';
import { prepareRun } from '../prepare-run.js';
import { streamHeader } from '../output.js';
import { repOutcomeCost, type RepOutcome } from '../stage-b-load.js';
import type { ScenarioGrounding } from '../grounding.js';
import {
  comparePrompt,
  planRegradeScenarios,
  readFirstUserPrompt,
  scanSourceRun,
  sourceRepProblem,
  type SourceRep,
  type SourceRun,
} from '../regrade-source.js';
import {
  finishGrading,
  gradeRep,
  makeGroundingResolver,
  makeScenarioStreamer,
  requireCompanionBinaries,
  selectRootScenarios,
  withInterruptHandling,
} from './grading-stage.js';
import { filterScenarios } from '../discovery.js';
import { formatErrorWithHint } from '../errors.js';
import { EXIT_INFRA_ERROR } from '../exit-codes.js';

export interface RegradeOptions {
  concurrency: number;
  graderModel?: string;
  auth?: string;
  scenarios?: string;
  verbose?: boolean;
}

interface StagedRep {
  scenarioId: string;
  rep: number;
  repDir: string;
  outputPath: string;
  transcriptCopied: boolean;
  problem?: string;
}

// Every source rep gets its rep dir and transcript copy before any grading,
// so a regrade's own artifact dir has the same rep population as its source.
async function stageSourceRep(
  artifactDir: string,
  scenarioId: string,
  sourceRep: SourceRep,
): Promise<StagedRep> {
  const repDir = join(artifactDir, scenarioId, `rep-${sourceRep.rep}`);
  await mkdir(repDir, { recursive: true });
  const outputPath = join(repDir, 'output.yaml');
  let copyError: string | undefined;
  if (sourceRep.hasTranscript) {
    try {
      await copyFile(join(sourceRep.repDir, 'output.yaml'), outputPath);
    } catch (err: unknown) {
      copyError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    scenarioId,
    rep: sourceRep.rep,
    repDir,
    outputPath,
    transcriptCopied: sourceRep.hasTranscript && copyError === undefined,
    problem: sourceRepProblem(sourceRep, copyError),
  };
}

function sourceErrorItem(staged: StagedRep, problem: string): WorkItem<RepOutcome> {
  return {
    scenarioId: staged.scenarioId,
    rep: staged.rep,
    fn: async () => ({
      type: 'error',
      rep: staged.rep,
      stage: 'source',
      message: problem,
      costUsd: null,
      ...(staged.transcriptCopied ? { transcriptPath: staged.outputPath } : {}),
    }),
  };
}

async function readTranscriptPrompt(outputPath: string): Promise<string | undefined> {
  try {
    return readFirstUserPrompt(await readFile(outputPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Compares each regraded transcript's prompt with the scenario's current one,
 * warning at most once per scenario for each outcome worth a warning.
 */
function makePromptDriftCheck() {
  const changed = new Set<string>();
  const unchecked = new Set<string>();
  const check = async (
    scenarioId: string,
    getGrounding: () => Promise<ScenarioGrounding>,
    outputPath: string,
  ): Promise<void> => {
    const { context } = await getGrounding();
    const outcome = comparePrompt(context, await readTranscriptPrompt(outputPath));
    if (outcome === 'changed' && !changed.has(scenarioId)) {
      changed.add(scenarioId);
      process.stderr.write(
        `[craboodle] ${scenarioId}: prompt changed since the source run; grading anyway\n`,
      );
    } else if (outcome === 'unchecked' && !unchecked.has(scenarioId)) {
      unchecked.add(scenarioId);
      process.stderr.write(
        `[craboodle] ${scenarioId}: could not check whether the prompt changed since the source run\n`,
      );
    }
  };
  return { check, changed };
}

const INVALID_SOURCE: Record<Exclude<SourceRun['kind'], 'run'>, string> = {
  missing: 'Artifact dir not found',
  'not-a-directory': 'Artifact dir is not a directory',
  'not-a-run': 'Artifact dir is not a craboodle run directory',
};

export async function regradeCommand(
  root: string,
  sourceArtifactDir: string,
  opts: RegradeOptions,
): Promise<void> {
  return withInterruptHandling((controller, isInterrupted) =>
    regradeCommandInner({ root, sourceArtifactDir, opts, controller, isInterrupted }),
  );
}

async function regradeCommandInner(args: {
  root: string;
  sourceArtifactDir: string;
  opts: RegradeOptions;
  controller: AbortController;
  isInterrupted: () => boolean;
}): Promise<void> {
  const { opts, controller, isInterrupted } = args;
  const resolvedRoot = resolve(args.root);
  const sourceDir = resolve(args.sourceArtifactDir);

  await requireCompanionBinaries();

  const sourceRun = await scanSourceRun(sourceDir);
  if (sourceRun.kind !== 'run') {
    process.stderr.write(
      formatErrorWithHint(
        `${INVALID_SOURCE[sourceRun.kind]}: ${sourceDir}`,
        'pass the artifact_dir a craboodle run printed; it holds <scenario>/rep-<N>/output.yaml',
        'craboodle --help',
      ),
    );
    process.exit(EXIT_INFRA_ERROR);
  }

  const prepared = await prepareRun(resolvedRoot);
  const { basePath, pipeline } = prepared;
  const rootScenarios = selectRootScenarios(prepared.scenarios, resolvedRoot, opts.scenarios);
  const sourceIds = [...sourceRun.scenarios.keys()].map((id) => ({ id }));
  const filteredSourceIds = opts.scenarios ? filterScenarios(sourceIds, opts.scenarios) : sourceIds;
  const plan = planRegradeScenarios(
    filteredSourceIds.map((s) => s.id),
    rootScenarios,
  );
  for (const id of plan.sourceOnly) {
    process.stderr.write(`[craboodle] ${id}: not in the eval root; skipped\n`);
  }
  for (const id of plan.rootOnly) {
    process.stderr.write(`[craboodle] ${id}: not in the source run; skipped\n`);
  }
  if (plan.selected.length === 0) {
    process.stderr.write(
      formatErrorWithHint(
        `No scenarios in common between ${sourceDir} and ${resolvedRoot}`,
        'pass the eval root the source run was made from',
        'craboodle --help',
      ),
    );
    process.exit(EXIT_INFRA_ERROR);
  }

  await cleanOldArtifacts(pipeline.artifactRetentionDays ?? 7, {
    verbose: opts.verbose,
    keep: [sourceRun.realDir],
  });
  const artifactDir = await mkdtemp(join(tmpdir(), 'craboodle-run-'));
  streamHeader(artifactDir, sourceDir);

  const auth = opts.auth ?? pipeline.auth;
  const drift = makePromptDriftCheck();
  // Source errors go first: the pool dispatches in order, so no budget cut
  // can label an ungraded source rep as skipped.
  const sourceErrorItems: WorkItem<RepOutcome>[] = [];
  const gradeItems: WorkItem<RepOutcome>[] = [];
  for (const scenario of plan.selected) {
    const checksPath = join(dirname(scenario.configPath), 'checks.yaml');
    const getGrounding = makeGroundingResolver(scenario, basePath, controller.signal);
    for (const sourceRep of sourceRun.scenarios.get(scenario.id) ?? []) {
      const staged = await stageSourceRep(artifactDir, scenario.id, sourceRep);
      if (staged.problem !== undefined) {
        process.stderr.write(`[craboodle] ${scenario.id} rep ${staged.rep}: ${staged.problem}\n`);
        sourceErrorItems.push(sourceErrorItem(staged, staged.problem));
        continue;
      }
      gradeItems.push({
        scenarioId: scenario.id,
        rep: staged.rep,
        fn: async () => {
          await drift.check(scenario.id, getGrounding, staged.outputPath);
          return gradeRep({
            scenarioId: scenario.id,
            rep: staged.rep,
            checksPath,
            outputPath: staged.outputPath,
            gradingPath: join(staged.repDir, 'grading.yaml'),
            getGrounding,
            graderModel: opts.graderModel,
            auth,
            signal: controller.signal,
            verbose: opts.verbose,
            attributeAgentCost: false,
          });
        },
      });
    }
  }

  let budgetExceeded = false;
  const streamer = makeScenarioStreamer({
    artifactDir,
    minPassRate: pipeline.minPassRate,
    verbose: opts.verbose,
    failFast: false,
    decorate: (output) =>
      drift.changed.has(output.id) ? { ...output, prompt_changed: true } : output,
  });

  await executePool([...sourceErrorItems, ...gradeItems], opts.concurrency, {
    budgetUsd: pipeline.maxBudgetUsd,
    costOf: repOutcomeCost,
    isInterrupted,
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

import { formatErrorWithHint } from '../errors.js';
import { installSignalHandler } from '../signals.js';
import { runPincenez } from '../runner.js';
import { resolveScenarioGrounding, type ScenarioGrounding } from '../grounding.js';
import { loadStageBResult, readTranscriptCost, type RepOutcome } from '../stage-b-load.js';
import { summarizeScenario } from '../scenario-summary.js';
import type { WorkResult } from '../pool.js';
import {
  evaluateGate,
  resolveRunVerdict,
  streamScenarioYaml,
  streamTotalCost,
  streamVerdict,
  type ScenarioOutput,
} from '../output.js';
import { EXIT_SIGINT } from '../exit-codes.js';

/**
 * Run `body` with a SIGINT handler installed; the first signal aborts the
 * controller and, once `body` settles, exits with the interrupt code.
 */
export async function withInterruptHandling(
  body: (controller: AbortController, isInterrupted: () => boolean) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let interrupted = false;
  const uninstallSignal = installSignalHandler({
    controller,
    onFirstSignal: () => {
      interrupted = true;
    },
  });

  try {
    return await body(controller, () => interrupted);
  } finally {
    uninstallSignal();
    if (interrupted) {
      process.exit(EXIT_SIGINT);
    }
  }
}

// Resolve the scenario's prompt once, shared across all reps; lazy so
// scenarios whose reps never reach grading skip the dry-run entirely.
export function makeGroundingResolver(
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

export interface GradeRepOptions {
  scenarioId: string;
  rep: number;
  checksPath: string;
  outputPath: string;
  gradingPath: string;
  getGrounding: () => Promise<ScenarioGrounding>;
  graderModel?: string;
  auth?: string;
  signal: AbortSignal;
  verbose?: boolean;
}

/** Grade one rep's transcript with pincenez and load the grading it wrote. */
export async function gradeRep(opts: GradeRepOptions): Promise<RepOutcome> {
  const { rep, outputPath, gradingPath } = opts;
  if (opts.verbose) {
    process.stderr.write(`[craboodle] ${opts.scenarioId} rep ${rep}: running pincenez\n`);
  }
  const grounding = await opts.getGrounding();
  const pincenezResult = await runPincenez({
    checksPath: opts.checksPath,
    outputPath,
    gradingPath,
    graderModel: opts.graderModel,
    context: grounding.context,
    auth: opts.auth,
    signal: opts.signal,
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
}

export interface ScenarioStreamState {
  scenarioOutputs: ScenarioOutput[];
  hasAnySuccess: boolean;
  failFastTriggered: boolean;
}

/**
 * The pool's onScenarioComplete for a grading run: summarise the scenario,
 * stream its block, and trip fail-fast when it breaches min_pass_rate.
 */
export function makeScenarioStreamer(opts: {
  artifactDir: string;
  minPassRate?: number;
  verbose?: boolean;
}): {
  state: ScenarioStreamState;
  onScenarioComplete: (scenarioId: string, repResults: WorkResult<RepOutcome>[]) => void;
} {
  const state: ScenarioStreamState = {
    scenarioOutputs: [],
    hasAnySuccess: false,
    failFastTriggered: false,
  };
  const { minPassRate } = opts;

  const onScenarioComplete = (scenarioId: string, repResults: WorkResult<RepOutcome>[]) => {
    const { output: scenarioOutput, anySuccess } = summarizeScenario(scenarioId, repResults);
    state.hasAnySuccess ||= anySuccess;

    state.scenarioOutputs.push(scenarioOutput);
    streamScenarioYaml(scenarioOutput, { artifactDir: opts.artifactDir });

    if (opts.verbose) {
      process.stderr.write(`[craboodle] ${scenarioId}: pass_rate=${scenarioOutput.pass_rate}\n`);
    }

    if (
      minPassRate !== undefined &&
      (scenarioOutput.pass_rate === null || scenarioOutput.pass_rate < minPassRate)
    ) {
      if (!state.failFastTriggered && opts.verbose) {
        process.stderr.write(
          `[craboodle] min_pass_rate breached by ${scenarioId} (pass_rate=${scenarioOutput.pass_rate} < ${minPassRate}) — remaining queued reps will be aborted (fail-fast)\n`,
        );
      }
      state.failFastTriggered = true;
    }
  };

  return { state, onScenarioComplete };
}

export interface FinishGradingOptions {
  scenarioOutputs: ScenarioOutput[];
  hasAnySuccess: boolean;
  budgetExceeded: boolean;
  isInterrupted: () => boolean;
  pipeline: { minPassRate?: number; maxErrorRate?: number; maxBudgetUsd?: number };
}

/**
 * Stream the run total and, unless interrupted, gate the run, stream its
 * verdict trailer, explain a failing verdict on stderr and set the exit code.
 */
export function finishGrading(opts: FinishGradingOptions): void {
  const { scenarioOutputs, hasAnySuccess, budgetExceeded, pipeline } = opts;

  const totalCostRaw = scenarioOutputs.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const totalCost = Math.round(totalCostRaw * 10000) / 10000;
  if (totalCost > 0) {
    streamTotalCost(totalCost);
  }

  if (opts.isInterrupted()) {
    return;
  }

  // Reliability (error_rate) takes precedence over quality (pass_rate), and
  // both apply only when min_pass_rate opts the suite into gating; otherwise
  // the run is pure data collection.
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

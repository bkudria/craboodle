import type { WorkResult } from './pool.js';
import type { RepOutcome } from './stage-b-load.js';
import {
  averageResults,
  scenarioErrorRate,
  type GradingCheck,
  type ScenarioOutput,
} from './output.js';

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Fold one scenario's rep results into its streamed block: averaged checks
 * over the graded reps, an errors entry per rep that was not graded, and the
 * scenario's cost fields. `anySuccess` says whether any rep was graded.
 */
export function summarizeScenario(
  scenarioId: string,
  repResults: WorkResult<RepOutcome>[],
): { output: ScenarioOutput; anySuccess: boolean } {
  const successfulGradings: GradingCheck[][] = [];
  const repTranscripts: string[] = [];
  const errors: NonNullable<ScenarioOutput['errors']> = [];
  let agentCost = 0;
  let gradingCost = 0;

  for (const result of repResults) {
    if (result.type === 'success') {
      const outcome = result.data;
      if (outcome.type === 'success') {
        successfulGradings.push(outcome.grading);
        repTranscripts.push(outcome.transcriptPath);
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

  const totalScenarioCost = agentCost + gradingCost;
  const costFields = {
    ...(totalScenarioCost > 0 ? { cost_usd: round4(totalScenarioCost) } : {}),
    ...(agentCost > 0 ? { agent_cost_usd: round4(agentCost) } : {}),
    ...(gradingCost > 0 ? { grading_cost_usd: round4(gradingCost) } : {}),
  };
  const errorRate = scenarioErrorRate(successfulGradings.length, errors);
  const anySuccess = successfulGradings.length > 0;

  if (!anySuccess) {
    return {
      anySuccess,
      output: {
        id: scenarioId,
        checks: [],
        pass_rate: null,
        error_rate: errorRate,
        ...costFields,
        errors,
      },
    };
  }

  const averaged = averageResults(successfulGradings, repTranscripts);
  return {
    anySuccess,
    output: {
      id: scenarioId,
      checks: averaged.checks,
      pass_rate: averaged.pass_rate,
      error_rate: errorRate,
      ...costFields,
      ...(errors.length > 0 ? { errors } : {}),
    },
  };
}

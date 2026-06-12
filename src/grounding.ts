import { listScuttlerunConfig } from './runner.js';
import { parseDryRunSummary } from './output.js';

export interface ScenarioGrounding {
  context?: string;
  availableTools?: string[];
}

export type GroundingPurpose = 'lint' | 'grading';

const MISSING_PROMPT_DEGRADATION: Record<GroundingPurpose, string> = {
  lint: 'tautology detection degraded',
  grading: 'grading context degraded',
};

/**
 * Resolve the scenario's effective config via `scuttlerun --dry-run` so the
 * pincenez judge is grounded in the resolved (post-merge) prompt — and, for
 * lint, the tool list for availability judgments. Degrades to an empty
 * grounding with a stderr warning when resolution fails.
 */
export async function resolveScenarioGrounding(
  scenarioId: string,
  scenarioPath: string,
  basePath: string,
  purpose: GroundingPurpose,
  signal?: AbortSignal,
): Promise<ScenarioGrounding> {
  const result = await listScuttlerunConfig({ scenarioPath, basePath, signal });
  if (!result.success || result.stdout === undefined) {
    process.stderr.write(
      `[craboodle] ${scenarioId}: could not resolve scenario config (scuttlerun --dry-run failed); ${purpose} grounding degraded\n`,
    );
    return {};
  }

  const summary = parseDryRunSummary(result.stdout);
  if (summary.prompt === undefined) {
    process.stderr.write(
      `[craboodle] ${scenarioId}: scenario has no prompt; ${MISSING_PROMPT_DEGRADATION[purpose]}\n`,
    );
  }
  return {
    ...(summary.prompt !== undefined ? { context: summary.prompt } : {}),
    ...(summary.tools !== undefined ? { availableTools: summary.tools } : {}),
  };
}

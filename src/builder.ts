import type { Check, ScenarioConfig } from "./config.js";

export interface ChecksFile {
  checks: Check[];
  context: string;
}

export function buildScuttlerunOverride(
  scenario: ScenarioConfig,
): Record<string, unknown> {
  return {
    ...scenario.scuttlerun,
    prompt: scenario.prompt,
  };
}

export function buildChecksFile(scenario: ScenarioConfig): ChecksFile {
  return {
    checks: scenario.checks,
    context: scenario.context ?? scenario.prompt,
  };
}

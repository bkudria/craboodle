import type { Assertion, ScenarioConfig } from "./config.js";

export interface Rubric {
  assertions: Assertion[];
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

export function buildRubric(scenario: ScenarioConfig): Rubric {
  return {
    assertions: scenario.assertions,
    context: scenario.context ?? scenario.prompt,
  };
}

import { parse, stringify } from "yaml";

export interface GradingAssertion {
  id: string;
  check: string;
  pass: boolean | null;
  evidence: string;
}

export interface AssertionOutput {
  check: string;
  pass_rate: number;
  failures?: Array<{ rep: number; evidence: string }>;
}

export interface ScenarioOutput {
  id: string;
  labels?: Record<string, string>;
  assertions: AssertionOutput[];
  pass_rate: number | null;
  errors?: Array<{ rep: number; stage: string; error: string }>;
}

export function parseGrading(yaml: string): GradingAssertion[] {
  const parsed = parse(yaml) as {
    assertions: GradingAssertion[];
    pass_rate: number;
  };
  return parsed.assertions;
}

export function averageResults(
  repGradings: GradingAssertion[][],
): { assertions: AssertionOutput[]; pass_rate: number } {
  if (repGradings.length === 0) {
    return { assertions: [], pass_rate: 0 };
  }

  const assertionCount = repGradings[0].length;
  const assertions: AssertionOutput[] = [];

  for (let i = 0; i < assertionCount; i++) {
    const check = repGradings[0][i].check;
    let passSum = 0;
    const failures: Array<{ rep: number; evidence: string }> = [];

    for (let rep = 0; rep < repGradings.length; rep++) {
      const result = repGradings[rep][i];
      if (result.pass === true) {
        passSum += 1;
      } else {
        failures.push({ rep: rep + 1, evidence: result.evidence });
      }
    }

    const passRate =
      Math.round((passSum / repGradings.length) * 100) / 100;

    if (passRate === 1.0) {
      assertions.push({ check, pass_rate: passRate });
    } else {
      assertions.push({ check, pass_rate: passRate, failures });
    }
  }

  const scenarioPassRate =
    assertions.length > 0
      ? Math.round(
          (assertions.reduce((sum, a) => sum + a.pass_rate, 0) /
            assertions.length) *
            100,
        ) / 100
      : 0;

  return { assertions, pass_rate: scenarioPassRate };
}

export function streamHeader(artifactDir: string): void {
  process.stdout.write(`artifact_dir: ${artifactDir}\nscenarios:\n`);
}

export function streamScenarioYaml(scenario: ScenarioOutput): void {
  const item: Record<string, unknown> = { id: scenario.id };

  if (scenario.labels) {
    item.labels = scenario.labels;
  }

  item.assertions = scenario.assertions;
  item.pass_rate = scenario.pass_rate;

  if (scenario.errors && scenario.errors.length > 0) {
    item.errors = scenario.errors;
  }

  const serialized = stringify([item], { lineWidth: 0 }).trimEnd();
  process.stdout.write(serialized + "\n");
}

import { parse, stringify, Document, Scalar, visit } from "yaml";
import { z } from "zod/v4";

const GradingAssertionSchema = z.object({
  id: z.string(),
  check: z.string(),
  pass: z.boolean().nullable(),
  evidence: z.string(),
});

const GradingOutputSchema = z.object({
  assertions: z.array(GradingAssertionSchema).min(1),
  pass_rate: z.number(),
  cost_usd: z.number().optional(),
});

export type GradingAssertion = z.infer<typeof GradingAssertionSchema>;

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
  cost_usd?: number;
  agent_cost_usd?: number;
  grading_cost_usd?: number;
  errors?: Array<{ rep: number; stage: string; error: string; transcript?: string }>;
}

/**
 * Parse cost_usd from a scuttlerun transcript YAML.
 * Returns null if not found or not a number.
 */
export function parseCostFromTranscript(yaml: string): number | null {
  try {
    const parsed = parse(yaml) as Record<string, unknown>;
    if (typeof parsed.cost_usd === "number") {
      return parsed.cost_usd;
    }
    return null;
  } catch {
    return null;
  }
}

export interface GradingResult {
  assertions: GradingAssertion[];
  costUsd: number | null;
}

export function parseGrading(yaml: string): GradingResult {
  const raw = parse(yaml);
  const parsed = GradingOutputSchema.parse(raw);
  return {
    assertions: parsed.assertions,
    costUsd: parsed.cost_usd ?? null,
  };
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

export function writeYamlArrayItem(item: Record<string, unknown>): string {
  const doc = new Document(item);
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === "string" && node.value.includes("\n")) {
        node.type = Scalar.BLOCK_LITERAL;
      }
    },
  });
  const serialized = doc.toString({ lineWidth: 0 }).trimEnd();
  const lines = serialized.split("\n");
  return lines
    .map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`))
    .join("\n");
}

export function streamHeader(artifactDir: string): void {
  process.stdout.write(stringify({ artifact_dir: artifactDir }, { lineWidth: 0 }));
  process.stdout.write("scenarios:\n");
}

export function streamScenarioYaml(scenario: ScenarioOutput): void {
  const item: Record<string, unknown> = { id: scenario.id };

  if (scenario.labels) {
    item.labels = scenario.labels;
  }

  item.assertions = scenario.assertions;
  item.pass_rate = scenario.pass_rate;

  if (scenario.cost_usd !== undefined) {
    item.cost_usd = Math.round(scenario.cost_usd * 10000) / 10000;
  }

  if (scenario.agent_cost_usd !== undefined && scenario.agent_cost_usd > 0) {
    item.agent_cost_usd = Math.round(scenario.agent_cost_usd * 10000) / 10000;
  }

  if (scenario.grading_cost_usd !== undefined && scenario.grading_cost_usd > 0) {
    item.grading_cost_usd = Math.round(scenario.grading_cost_usd * 10000) / 10000;
  }

  if (scenario.errors && scenario.errors.length > 0) {
    item.errors = scenario.errors;
  }

  process.stdout.write(writeYamlArrayItem(item) + "\n");
}

export function streamTotalCost(totalCostUsd: number): void {
  process.stdout.write(stringify({ total_cost_usd: Math.round(totalCostUsd * 10000) / 10000 }, { lineWidth: 0 }));
}

// --- Lint output ---

export interface LintAssertionOutput {
  id: string;
  check: string;
  issues: string[];
}

export interface LintScenarioOutput {
  id: string;
  assertions: LintAssertionOutput[];
  assertions_total: number;
  assertions_with_issues: number;
}

export interface LintTotals {
  scenarios_total: number;
  scenarios_with_issues: number;
  assertions_total: number;
  assertions_with_issues: number;
}

export function parseLintResult(yaml: string): LintAssertionOutput[] {
  const parsed = parse(yaml) as {
    assertions: Array<{ id: string; check: string; issues: string[] }>;
  };
  return parsed.assertions.map((a) => ({
    id: a.id,
    check: a.check,
    issues: a.issues ?? [],
  }));
}

export function streamLintScenarioYaml(scenario: LintScenarioOutput): void {
  const item: Record<string, unknown> = {
    id: scenario.id,
    assertions: scenario.assertions,
    assertions_total: scenario.assertions_total,
    assertions_with_issues: scenario.assertions_with_issues,
  };

  process.stdout.write(writeYamlArrayItem(item) + "\n");
}

export function streamLintTotals(totals: LintTotals): void {
  process.stdout.write(stringify(totals, { lineWidth: 0 }));
}

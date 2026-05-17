import { parse, stringify, Document, Scalar, visit, isSeq, YAMLMap, YAMLSeq } from 'yaml';
import type { Node } from 'yaml';
import { z } from 'zod/v4';

const GradingCheckSchema = z.object({
  id: z.string(),
  check: z.string(),
  pass: z.boolean().nullable(),
  evidence: z.string(),
});

const GradingOutputSchema = z.object({
  checks: z.array(GradingCheckSchema).min(1),
  pass_rate: z.number(),
  cost_usd: z.number().optional(),
});

export type GradingCheck = z.infer<typeof GradingCheckSchema>;

export interface CheckOutput {
  check: string;
  pass_rate: number;
  failures?: Array<{ rep: number; evidence: string; transcript?: string }>;
}

export interface ScenarioOutput {
  id: string;
  checks: CheckOutput[];
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
    if (typeof parsed.cost_usd === 'number') {
      return parsed.cost_usd;
    }
    return null;
  } catch {
    return null;
  }
}

export interface GradingResult {
  checks: GradingCheck[];
  costUsd: number | null;
}

export function parseGrading(yaml: string): GradingResult {
  const raw = parse(yaml);
  const parsed = GradingOutputSchema.parse(raw);
  return {
    checks: parsed.checks,
    costUsd: parsed.cost_usd ?? null,
  };
}

export function averageResults(
  repGradings: GradingCheck[][],
  repTranscripts?: string[],
): { checks: CheckOutput[]; pass_rate: number } {
  if (repGradings.length === 0) {
    return { checks: [], pass_rate: 0 };
  }

  const checkCount = repGradings[0].length;
  const checks: CheckOutput[] = [];

  for (let i = 0; i < checkCount; i++) {
    const check = repGradings[0][i].check;
    let passSum = 0;
    const failures: Array<{ rep: number; evidence: string; transcript?: string }> = [];

    for (let rep = 0; rep < repGradings.length; rep++) {
      const result = repGradings[rep][i];
      if (result.pass === true) {
        passSum += 1;
      } else {
        failures.push({
          rep: rep + 1,
          evidence: result.evidence,
          ...(repTranscripts?.[rep] ? { transcript: repTranscripts[rep] } : {}),
        });
      }
    }

    const passRate = Math.round((passSum / repGradings.length) * 100) / 100;

    if (passRate === 1.0) {
      checks.push({ check, pass_rate: passRate });
    } else {
      checks.push({ check, pass_rate: passRate, failures });
    }
  }

  const scenarioPassRate =
    checks.length > 0
      ? Math.round((checks.reduce((sum, a) => sum + a.pass_rate, 0) / checks.length) * 100) / 100
      : 0;

  return { checks, pass_rate: scenarioPassRate };
}

function wordWrap(text: string, width: number): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur.length === 0) {
      cur = word;
    } else if (cur.length + 1 + word.length <= width) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

function wrapAndBlockify(_key: unknown, node: Scalar): void {
  if (typeof node.value !== 'string') return;
  let value: string = node.value;
  if (!value.includes('\n') && value.length > 80) {
    value = wordWrap(value, 80);
    node.value = value;
  }
  if (value.includes('\n')) {
    node.type = Scalar.BLOCK_LITERAL;
  }
}

export function writeYamlArrayItem(item: Record<string, unknown>): string {
  const doc = new Document(item);
  visit(doc, { Scalar: wrapAndBlockify });
  const serialized = doc.toString({ lineWidth: 0 }).trimEnd();
  const lines = serialized.split('\n');
  return lines.map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`)).join('\n');
}

export function streamHeader(artifactDir: string): void {
  process.stdout.write(stringify({ artifact_dir: artifactDir }, { lineWidth: 0 }));
  process.stdout.write('scenarios:\n');
}

export function streamScenarioYaml(scenario: ScenarioOutput): void {
  const content: Record<string, unknown> = {
    checks: scenario.checks,
    pass_rate: scenario.pass_rate,
  };

  if (scenario.cost_usd !== undefined) {
    content.cost_usd = Math.round(scenario.cost_usd * 10000) / 10000;
  }

  if (scenario.agent_cost_usd !== undefined && scenario.agent_cost_usd > 0) {
    content.agent_cost_usd = Math.round(scenario.agent_cost_usd * 10000) / 10000;
  }

  if (scenario.grading_cost_usd !== undefined && scenario.grading_cost_usd > 0) {
    content.grading_cost_usd = Math.round(scenario.grading_cost_usd * 10000) / 10000;
  }

  if (scenario.errors && scenario.errors.length > 0) {
    content.errors = scenario.errors;
  }

  const item = { [scenario.id]: content };

  const doc = new Document(item);
  visit(doc, { Scalar: wrapAndBlockify });

  // Add blank lines between items in all sequences (checks, failures, errors)
  visit(doc, (_key, node) => {
    if (isSeq(node)) {
      for (let i = 1; i < node.items.length; i++) {
        (node.items[i] as Node).spaceBefore = true;
      }
    }
  });

  // Add blank line before summary fields (pass_rate, cost, etc.)
  const contentNode = doc.getIn([scenario.id], true) as YAMLMap;
  for (const pair of contentNode.items) {
    const key = pair.key as Scalar;
    if (key.value === 'pass_rate') {
      key.spaceBefore = true;
      break;
    }
  }

  const serialized = doc.toString({ lineWidth: 0 }).trimEnd();
  const lines = serialized.split('\n');
  const yamlItem = lines
    .map((line, i) => {
      if (i === 0) return `  - ${line}`;
      if (line === '') return '';
      return `    ${line}`;
    })
    .join('\n');

  process.stdout.write(yamlItem + '\n\n');
}

export function streamTotalCost(totalCostUsd: number): void {
  process.stdout.write(
    stringify({ total_cost_usd: Math.round(totalCostUsd * 10000) / 10000 }, { lineWidth: 0 }),
  );
}

// --- Lint output ---

export interface LintCheckOutput {
  id: string;
  check: string;
  issues: unknown[];
}

export interface LintScenarioOutput {
  id: string;
  checks: LintCheckOutput[];
  checks_total: number;
  checks_with_issues: number;
}

export interface LintTotals {
  scenarios_total: number;
  scenarios_with_issues: number;
  checks_total: number;
  checks_with_issues: number;
}

export function parseLintResult(yaml: string): LintCheckOutput[] {
  const parsed = parse(yaml) as {
    checks: Array<{ id: string; check: string; issues: string[] }>;
  };
  return parsed.checks.map((a) => ({
    id: a.id,
    check: a.check,
    issues: a.issues ?? [],
  }));
}

export function streamLintScenarioYaml(scenario: LintScenarioOutput): void {
  const issueChecks = scenario.checks.filter((c) => c.issues.length > 0);
  if (issueChecks.length === 0) {
    return;
  }

  const checks = issueChecks.map((c) => {
    const { id, ...rest } = c;
    return { [id]: rest };
  });

  const item: Record<string, unknown> = {
    [scenario.id]: {
      checks,
      checks_total: scenario.checks_total,
      checks_with_issues: scenario.checks_with_issues,
    },
  };

  const doc = new Document(item);
  visit(doc, { Scalar: wrapAndBlockify });

  // Add blank lines between check items
  const checksNode = doc.getIn([scenario.id, 'checks'], true) as YAMLSeq;
  for (let i = 1; i < checksNode.items.length; i++) {
    (checksNode.items[i] as Node).spaceBefore = true;
  }

  const serialized = doc.toString({ lineWidth: 0 }).trimEnd();
  const lines = serialized.split('\n');
  const yamlItem = lines
    .map((line, i) => {
      if (i === 0) return `  - ${line}`;
      if (line === '') return '';
      return `    ${line}`;
    })
    .join('\n');

  process.stdout.write(yamlItem + '\n\n');
}

export function streamLintTotals(totals: LintTotals): void {
  process.stdout.write(
    stringify(
      {
        scenarios_total: totals.scenarios_total,
        scenarios_with_issues: totals.scenarios_with_issues,
      },
      { lineWidth: 0 },
    ),
  );
  process.stdout.write('\n');
  process.stdout.write(
    stringify(
      {
        checks_total: totals.checks_total,
        checks_with_issues: totals.checks_with_issues,
      },
      { lineWidth: 0 },
    ),
  );
}

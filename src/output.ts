import {
  parse,
  Document,
  Scalar,
  visit,
  isSeq,
  isMap,
  isPair,
  isDocument,
  YAMLMap,
  YAMLSeq,
} from 'yaml';
import type { Node, Pair } from 'yaml';
import wrap from 'word-wrap';
import { relative, isAbsolute } from 'node:path';
import { z } from 'zod';

export const LINE_WIDTH = 80;
const ENTRY_PREFIX_WIDTH = 4;
export const DOC_LINE_WIDTH = LINE_WIDTH - ENTRY_PREFIX_WIDTH;

function hardWrapToWidth(text: string, width: number): string {
  if (width <= 0) return text;
  return text
    .split('\n')
    .map((line) =>
      line.length <= width ? line : wrap(line, { width, indent: '', trim: true, cut: false }),
    )
    .join('\n');
}

function getKeyDisplayLength(key: unknown): number {
  if (key == null) return 0;
  const value = typeof key === 'object' && 'value' in (key as object) ? (key as Scalar).value : key;
  return String(value).length;
}

function getContainerIndent(path: readonly unknown[]): number {
  // Indent (in chars) at which the immediate parent's keys/items appear.
  // Skips the Document wrapper and the root container, which sit at col 0.
  let count = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    if (i === 0 && isDocument(a as Node | Document)) continue;
    if (i === 1 && (isMap(a as Node) || isSeq(a as Node))) continue;
    if (isMap(a as Node) || isSeq(a as Node)) count++;
  }
  return count * 2;
}

function applyDepthAwareWrap(doc: Document, outerPrefix: number, totalWidth: number): void {
  visit(doc, {
    Scalar(key, node, path) {
      if (typeof node.value !== 'string') return;
      // Skip pair-key scalars; we only wrap values and seq items.
      if (key === 'key') return;

      const parent = path[path.length - 1];
      const containerIndent = getContainerIndent(path);

      let inlinePrefix: number;
      if (isPair(parent)) {
        inlinePrefix = getKeyDisplayLength((parent as Pair).key) + 2; // "key: "
      } else if (isSeq(parent)) {
        inlinePrefix = 2; // "- "
      } else {
        inlinePrefix = 0;
      }

      const inlineCol = outerPrefix + containerIndent + inlinePrefix;
      const inlineBudget = Math.max(0, totalWidth - inlineCol);
      const contentCol = outerPrefix + containerIndent + 2;
      const contentBudget = Math.max(0, totalWidth - contentCol);

      const value = node.value;
      if (value.includes('\n')) {
        // Literal preserves text verbatim, so pre-wrap each internal line to
        // the content budget — the lib won't re-wrap literal content.
        node.value = hardWrapToWidth(value, contentBudget);
        node.type = Scalar.BLOCK_LITERAL;
      } else if (value.length > inlineBudget) {
        // Folded lets the yaml lib wrap based on lineWidth, which accounts
        // for indent automatically. No pre-wrap (it would inject paragraph
        // breaks in the parsed value).
        node.type = Scalar.BLOCK_FOLDED;
      }
    },
  });
}

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

  const idOrder: string[] = [];
  const idToCheck = new Map<string, string>();
  for (const repChecks of repGradings) {
    for (const c of repChecks) {
      if (!idToCheck.has(c.id)) {
        idOrder.push(c.id);
        idToCheck.set(c.id, c.check);
      }
    }
  }

  const rep0Ids = new Set(repGradings[0].map((c) => c.id));
  for (let rep = 1; rep < repGradings.length; rep++) {
    const repIds = new Set(repGradings[rep].map((c) => c.id));
    const missing = [...rep0Ids].filter((id) => !repIds.has(id));
    const extra = [...repIds].filter((id) => !rep0Ids.has(id));
    if (missing.length > 0 || extra.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
      if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`);
      process.stderr.write(
        `[craboodle] rep ${rep + 1} check ids differ from rep 1 — ${parts.join('; ')}\n`,
      );
    }
  }

  const checks: CheckOutput[] = [];

  for (const id of idOrder) {
    const check = idToCheck.get(id);
    if (!check) {
      throw new Error(`internal: idOrder includes id "${id}" missing from idToCheck`);
    }
    let passSum = 0;
    const failures: Array<{ rep: number; evidence: string; transcript?: string }> = [];

    for (let rep = 0; rep < repGradings.length; rep++) {
      const result = repGradings[rep].find((c) => c.id === id);
      if (result?.pass === true) {
        passSum += 1;
      } else {
        failures.push({
          rep: rep + 1,
          evidence: result?.evidence ?? '(check missing from this rep)',
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

export function writeYamlArrayItem(item: Record<string, unknown>): string {
  const doc = new Document(item);
  applyDepthAwareWrap(doc, ENTRY_PREFIX_WIDTH, LINE_WIDTH);
  const serialized = doc.toString({ lineWidth: DOC_LINE_WIDTH }).trimEnd();
  const lines = serialized.split('\n');
  return lines.map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`)).join('\n');
}

function serializeTopLevel(item: Record<string, unknown>): string {
  const doc = new Document(item);
  applyDepthAwareWrap(doc, 0, LINE_WIDTH);
  return doc.toString({ lineWidth: LINE_WIDTH });
}

export function streamHeader(artifactDir: string): void {
  process.stdout.write(serializeTopLevel({ artifact_dir: artifactDir }));
  process.stdout.write('scenarios:\n');
}

function relativizeTranscript(transcript: string, artifactDir?: string): string {
  if (!artifactDir || !isAbsolute(transcript)) return transcript;
  return relative(artifactDir, transcript);
}

export interface StreamScenarioOptions {
  artifactDir?: string;
}

export function streamScenarioYaml(
  scenario: ScenarioOutput,
  options: StreamScenarioOptions = {},
): void {
  const { artifactDir } = options;
  const checks = scenario.checks.map((c) => {
    if (!c.failures) return c;
    return {
      ...c,
      failures: c.failures.map((f) =>
        f.transcript ? { ...f, transcript: relativizeTranscript(f.transcript, artifactDir) } : f,
      ),
    };
  });

  const content: Record<string, unknown> = {
    checks,
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
    content.errors = scenario.errors.map((e) =>
      e.transcript ? { ...e, transcript: relativizeTranscript(e.transcript, artifactDir) } : e,
    );
  }

  const item = { [scenario.id]: content };

  const doc = new Document(item);
  applyDepthAwareWrap(doc, ENTRY_PREFIX_WIDTH, LINE_WIDTH);

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

  const serialized = doc.toString({ lineWidth: DOC_LINE_WIDTH }).trimEnd();
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
    serializeTopLevel({ total_cost_usd: Math.round(totalCostUsd * 10000) / 10000 }),
  );
}

// --- Lint output ---

export interface LintIssue {
  anti_pattern: string;
  suggestion: string;
}

export interface LintCheckOutput {
  id: string;
  check: string;
  issues: LintIssue[];
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
    checks: Array<{ id: string; check: string; issues: LintIssue[] }>;
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
  applyDepthAwareWrap(doc, ENTRY_PREFIX_WIDTH, LINE_WIDTH);

  // Add blank lines between check items
  const checksNode = doc.getIn([scenario.id, 'checks'], true) as YAMLSeq;
  for (let i = 1; i < checksNode.items.length; i++) {
    (checksNode.items[i] as Node).spaceBefore = true;
  }

  const serialized = doc.toString({ lineWidth: DOC_LINE_WIDTH }).trimEnd();
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
    serializeTopLevel({
      scenarios_total: totals.scenarios_total,
      scenarios_with_issues: totals.scenarios_with_issues,
    }),
  );
  process.stdout.write('\n');
  process.stdout.write(
    serializeTopLevel({
      checks_total: totals.checks_total,
      checks_with_issues: totals.checks_with_issues,
    }),
  );
}

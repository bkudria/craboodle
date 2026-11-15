import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, isSeq, parseAllDocuments } from 'yaml';
import { parseGrading } from './output.js';

export interface SourceRep {
  rep: number;
  repDir: string;
  hasTranscript: boolean;
  grading: 'ok' | 'missing' | 'invalid';
}

export type SourceRun =
  | { kind: 'missing' }
  | { kind: 'not-a-directory' }
  | { kind: 'not-a-run' }
  | { kind: 'run'; realDir: string; scenarios: Map<string, SourceRep[]> };

const REP_DIR = /^rep-([1-9]\d*)$/;

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readGradingState(gradingPath: string): Promise<SourceRep['grading']> {
  let content: string;
  try {
    content = await readFile(gradingPath, 'utf8');
  } catch {
    return 'missing';
  }
  try {
    parseGrading(content);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

async function scanScenarioReps(scenarioDir: string): Promise<SourceRep[]> {
  const reps: SourceRep[] = [];
  for (const entry of await readdir(scenarioDir, { withFileTypes: true })) {
    const match = REP_DIR.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const repDir = join(scenarioDir, entry.name);
    reps.push({
      rep: Number(match[1]),
      repDir,
      hasTranscript: await isFile(join(repDir, 'output.yaml')),
      grading: await readGradingState(join(repDir, 'grading.yaml')),
    });
  }
  return reps.sort((a, b) => a.rep - b.rep);
}

/**
 * Read a run's artifact dir: every `<scenario>/rep-<N>/` directory and what
 * it holds. A directory counts as a run when some rep dir holds a transcript
 * or a grading; its name does not matter.
 */
export async function scanSourceRun(dir: string): Promise<SourceRun> {
  try {
    if (!(await stat(dir)).isDirectory()) return { kind: 'not-a-directory' };
  } catch (err: unknown) {
    if (isNotFound(err)) return { kind: 'missing' };
    throw err;
  }

  const scenarios = new Map<string, SourceRep[]>();
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  for (const id of entries) {
    const reps = await scanScenarioReps(join(dir, id));
    if (reps.length > 0) scenarios.set(id, reps);
  }

  const holdsRunFiles = [...scenarios.values()].some((reps) =>
    reps.some((r) => r.hasTranscript || r.grading !== 'missing'),
  );
  if (!holdsRunFiles) return { kind: 'not-a-run' };
  return { kind: 'run', realDir: await realpath(dir), scenarios };
}

/**
 * Why a source rep cannot be regraded, naming its dir; undefined when it can.
 * A rep is regraded only when its source run graded it, so a rep the source
 * grader failed on is reported rather than retried.
 */
export function sourceRepProblem(rep: SourceRep, copyError?: string): string | undefined {
  if (!rep.hasTranscript) return `source rep has no transcript (no output.yaml): ${rep.repDir}`;
  if (rep.grading === 'missing') {
    return `source rep was not graded (no grading.yaml): ${rep.repDir}`;
  }
  if (rep.grading === 'invalid') {
    return `source rep grading.yaml is not a valid grading: ${rep.repDir}`;
  }
  if (copyError !== undefined) {
    return `could not copy the source transcript (${copyError}): ${rep.repDir}`;
  }
  return undefined;
}

export function planRegradeScenarios<T extends { id: string }>(
  sourceIds: string[],
  rootScenarios: T[],
): { selected: T[]; sourceOnly: string[]; rootOnly: string[] } {
  const inSource = new Set(sourceIds);
  const inRoot = new Set(rootScenarios.map((s) => s.id));
  return {
    selected: rootScenarios.filter((s) => inSource.has(s.id)),
    sourceOnly: sourceIds.filter((id) => !inRoot.has(id)),
    rootOnly: rootScenarios.filter((s) => !inSource.has(s.id)).map((s) => s.id),
  };
}

/**
 * The transcript's first conversation entry, when it is a user message: the
 * prompt the session was started with. Only the first document is read, and
 * a malformed later entry does not hide a readable first one.
 */
export function readFirstUserPrompt(transcriptYaml: string): string | undefined {
  const [doc] = parseAllDocuments(transcriptYaml);
  if (doc === undefined || !isMap(doc.contents)) return undefined;
  const conversation = doc.contents.get('conversation', true);
  if (!isSeq(conversation)) return undefined;
  const first: unknown = conversation.items[0];
  if (!isMap(first)) return undefined;
  const user = first.get('user');
  return typeof user === 'string' ? user : undefined;
}

// scuttlerun folds long prompt lines and hard-wraps long lines of a
// multi-line prompt when it writes the transcript, so only the words and
// their order can be compared.
const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

export function comparePrompt(
  resolvedPrompt: string | undefined,
  transcriptPrompt: string | undefined,
): 'same' | 'changed' | 'unchecked' {
  if (resolvedPrompt === undefined || transcriptPrompt === undefined) return 'unchecked';
  return normalizeWhitespace(resolvedPrompt) === normalizeWhitespace(transcriptPrompt)
    ? 'same'
    : 'changed';
}

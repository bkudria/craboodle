import { readFile } from 'node:fs/promises';
import { parseGrading, parseCostFromTranscript, type GradingCheck } from './output.js';

export type RepOutcome =
  | {
      type: 'success';
      grading: GradingCheck[];
      costUsd: number | null;
      gradingCostUsd: number | null;
      transcriptPath: string;
    }
  | {
      type: 'error';
      rep: number;
      stage: string;
      message: string;
      costUsd: number | null;
      exitCode?: number;
      transcriptPath?: string;
    };

/**
 * Total known cost of a rep outcome: agent + grading cost on success,
 * the transcript's agent cost on error. Unknown costs count as 0.
 */
export function repOutcomeCost(outcome: RepOutcome): number {
  if (outcome.type === 'success') {
    return (outcome.costUsd ?? 0) + (outcome.gradingCostUsd ?? 0);
  }
  return outcome.costUsd ?? 0;
}

/**
 * Best-effort agent cost from a transcript on disk: null when the path is
 * absent, the file is unreadable, or the transcript carries no cost_usd.
 */
export async function readTranscriptCost(
  transcriptPath: string | undefined,
): Promise<number | null> {
  if (transcriptPath === undefined) return null;
  try {
    return parseCostFromTranscript(await readFile(transcriptPath, 'utf8'));
  } catch {
    return null;
  }
}

export interface LoadStageBInput {
  gradingPath: string;
  outputPath: string;
  rep: number;
}

export async function loadStageBResult(input: LoadStageBInput): Promise<RepOutcome> {
  const { gradingPath, outputPath, rep } = input;

  let gradingResult;
  try {
    const gradingContent = await readFile(gradingPath, 'utf8');
    gradingResult = parseGrading(gradingContent);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      type: 'error',
      rep,
      stage: 'pincenez',
      message: `failed to read or parse grading.yaml: ${detail}`,
      costUsd: await readTranscriptCost(outputPath),
      transcriptPath: outputPath,
    };
  }

  const costUsd = await readTranscriptCost(outputPath);
  return {
    type: 'success',
    grading: gradingResult.checks,
    costUsd,
    gradingCostUsd: gradingResult.costUsd,
    transcriptPath: outputPath,
  };
}

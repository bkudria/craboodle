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
      exitCode?: number;
      transcriptPath?: string;
    };

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
      transcriptPath: outputPath,
    };
  }

  let costUsd: number | null = null;
  try {
    const outputContent = await readFile(outputPath, 'utf8');
    costUsd = parseCostFromTranscript(outputContent);
  } catch {
    // transcript missing or unreadable — best-effort, leave costUsd as null
  }
  return {
    type: 'success',
    grading: gradingResult.checks,
    costUsd,
    gradingCostUsd: gradingResult.costUsd,
    transcriptPath: outputPath,
  };
}

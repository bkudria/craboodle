import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';

const VALID_GRADING = `checks:
  - id: a1
    check: "Output contains a function"
    pass: true
    evidence: "Function found"
pass_rate: 1
cost_usd: 0.0042
`;

const VALID_TRANSCRIPT = `cost_usd: 0.0123
`;

describe('loadStageBResult', () => {
  let tmpDir: string;
  let gradingPath: string;
  let outputPath: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('stage-b-load');
    gradingPath = join(tmpDir, 'grading.yaml');
    outputPath = join(tmpDir, 'output.yaml');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('returns success outcome with parsed grading and costs for valid inputs', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');
    await writeFile(gradingPath, VALID_GRADING, 'utf8');
    await writeFile(outputPath, VALID_TRANSCRIPT, 'utf8');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 1 });

    expect(result.type).toBe('success');
    if (result.type !== 'success') return;
    expect(result.grading).toHaveLength(1);
    expect(result.grading[0]).toEqual({
      id: 'a1',
      check: 'Output contains a function',
      pass: true,
      evidence: 'Function found',
    });
    expect(result.costUsd).toBe(0.0123);
    expect(result.gradingCostUsd).toBe(0.0042);
    expect(result.transcriptPath).toBe(outputPath);
  });

  it('returns pincenez-stage error when grading.yaml is missing', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');
    await writeFile(outputPath, VALID_TRANSCRIPT, 'utf8');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 3 });

    expect(result.type).toBe('error');
    if (result.type !== 'error') return;
    expect(result.stage).toBe('pincenez');
    expect(result.rep).toBe(3);
    expect(result.transcriptPath).toBe(outputPath);
    expect(result.message).toMatch(/grading\.yaml/);
    expect(result.costUsd).toBe(0.0123);
  });

  it('returns pincenez-stage error when grading.yaml is malformed YAML', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');
    await writeFile(gradingPath, '{{ not yaml :::', 'utf8');
    await writeFile(outputPath, VALID_TRANSCRIPT, 'utf8');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 1 });

    expect(result.type).toBe('error');
    if (result.type !== 'error') return;
    expect(result.stage).toBe('pincenez');
    expect(result.transcriptPath).toBe(outputPath);
    expect(result.message).toMatch(/grading\.yaml/);
    expect(result.costUsd).toBe(0.0123);
  });

  it('returns success with costUsd null when output.yaml is missing', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');
    await writeFile(gradingPath, VALID_GRADING, 'utf8');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 1 });

    expect(result.type).toBe('success');
    if (result.type !== 'success') return;
    expect(result.costUsd).toBeNull();
    expect(result.gradingCostUsd).toBe(0.0042);
    expect(result.grading).toHaveLength(1);
    expect(result.transcriptPath).toBe(outputPath);
  });

  it('returns pincenez-stage error when grading.yaml violates schema', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');
    await writeFile(gradingPath, 'pass_rate: 1.0\n', 'utf8');
    await writeFile(outputPath, VALID_TRANSCRIPT, 'utf8');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 2 });

    expect(result.type).toBe('error');
    if (result.type !== 'error') return;
    expect(result.stage).toBe('pincenez');
    expect(result.rep).toBe(2);
    expect(result.message).toMatch(/grading\.yaml/);
    expect(result.costUsd).toBe(0.0123);
  });

  it('returns error with costUsd null when the transcript is also missing', async () => {
    const { loadStageBResult } = await import('../src/stage-b-load.js');

    const result = await loadStageBResult({ gradingPath, outputPath, rep: 1 });

    expect(result.type).toBe('error');
    if (result.type !== 'error') return;
    expect(result.costUsd).toBeNull();
  });
});

describe('readTranscriptCost', () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('read-transcript-cost');
    transcriptPath = join(tmpDir, 'output.yaml');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('returns the cost_usd value from a transcript', async () => {
    const { readTranscriptCost } = await import('../src/stage-b-load.js');
    await writeFile(transcriptPath, VALID_TRANSCRIPT, 'utf8');

    expect(await readTranscriptCost(transcriptPath)).toBe(0.0123);
  });

  it('returns null for an undefined path', async () => {
    const { readTranscriptCost } = await import('../src/stage-b-load.js');

    expect(await readTranscriptCost(undefined)).toBeNull();
  });

  it('returns null for a nonexistent path', async () => {
    const { readTranscriptCost } = await import('../src/stage-b-load.js');

    expect(await readTranscriptCost(transcriptPath)).toBeNull();
  });

  it('returns null when the transcript has no cost_usd key', async () => {
    const { readTranscriptCost } = await import('../src/stage-b-load.js');
    await writeFile(transcriptPath, 'result: ok\n', 'utf8');

    expect(await readTranscriptCost(transcriptPath)).toBeNull();
  });
});

describe('repOutcomeCost', () => {
  it('sums agent and grading cost for a success outcome', async () => {
    const { repOutcomeCost } = await import('../src/stage-b-load.js');

    expect(
      repOutcomeCost({
        type: 'success',
        grading: [],
        costUsd: 0.3,
        gradingCostUsd: 0.2,
        transcriptPath: '/tmp/t.yaml',
      }),
    ).toBe(0.5);
  });

  it('returns 0 for a success outcome with unknown costs', async () => {
    const { repOutcomeCost } = await import('../src/stage-b-load.js');

    expect(
      repOutcomeCost({
        type: 'success',
        grading: [],
        costUsd: null,
        gradingCostUsd: null,
        transcriptPath: '/tmp/t.yaml',
      }),
    ).toBe(0);
  });

  it('returns the agent cost for an error outcome', async () => {
    const { repOutcomeCost } = await import('../src/stage-b-load.js');

    expect(
      repOutcomeCost({
        type: 'error',
        rep: 1,
        stage: 'scuttlerun',
        message: 'crashed',
        costUsd: 0.7,
      }),
    ).toBe(0.7);
  });

  it('returns 0 for an error outcome with unknown cost', async () => {
    const { repOutcomeCost } = await import('../src/stage-b-load.js');

    expect(
      repOutcomeCost({
        type: 'error',
        rep: 1,
        stage: 'scuttlerun',
        message: 'crashed',
        costUsd: null,
      }),
    ).toBe(0);
  });
});

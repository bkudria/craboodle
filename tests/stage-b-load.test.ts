import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

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
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-stageb-'));
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
  });
});

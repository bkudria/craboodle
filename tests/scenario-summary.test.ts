import { describe, it, expect } from 'vitest';
import { summarizeScenario } from '../src/scenario-summary.js';
import type { WorkResult } from '../src/pool.js';
import type { RepOutcome } from '../src/stage-b-load.js';

const graded = (
  rep: number,
  pass: boolean,
  costs: { agent?: number | null; grading?: number | null } = {},
): WorkResult<RepOutcome> => ({
  type: 'success',
  rep,
  data: {
    type: 'success',
    grading: [{ id: 'c1', check: 'the check', pass, evidence: `rep ${rep}` }],
    costUsd: costs.agent ?? null,
    gradingCostUsd: costs.grading ?? null,
    transcriptPath: `/art/alpha/rep-${rep}/output.yaml`,
  },
});

const failed = (
  rep: number,
  extra: Partial<Extract<RepOutcome, { type: 'error' }>> = {},
): WorkResult<RepOutcome> => ({
  type: 'success',
  rep,
  data: { type: 'error', rep, stage: 'scuttlerun', message: 'boom', costUsd: null, ...extra },
});

describe('summarizeScenario', () => {
  it('averages graded reps and omits errors and costs when there are none', () => {
    const { output, anySuccess } = summarizeScenario('alpha', [graded(1, true), graded(2, false)]);

    expect(anySuccess).toBe(true);
    expect(output).toEqual({
      id: 'alpha',
      checks: [
        {
          check: 'the check',
          pass_rate: 0.5,
          failures: [{ rep: 2, evidence: 'rep 2', transcript: '/art/alpha/rep-2/output.yaml' }],
        },
      ],
      pass_rate: 0.5,
      error_rate: 0,
    });
  });

  it('labels a failing check with the rep it failed in when an earlier rep was not graded', () => {
    const { output } = summarizeScenario('alpha', [failed(1), graded(2, false)]);

    expect(output.checks[0].failures).toEqual([
      { rep: 2, evidence: 'rep 2', transcript: '/art/alpha/rep-2/output.yaml' },
    ]);
  });

  it('sums agent and grading cost across reps, rounded to four places', () => {
    const { output } = summarizeScenario('alpha', [
      graded(1, true, { agent: 0.11111, grading: 0.02 }),
      graded(2, true, { agent: 0.1, grading: null }),
      failed(3, { costUsd: 0.3 }),
    ]);

    expect(output.agent_cost_usd).toBe(0.5111);
    expect(output.grading_cost_usd).toBe(0.02);
    expect(output.cost_usd).toBe(0.5311);
  });

  it('reports a failed rep with its exit code, transcript and agent cost', () => {
    const { output } = summarizeScenario('alpha', [
      graded(1, true),
      failed(2, { exitCode: 3, transcriptPath: '/art/alpha/rep-2/output.yaml', costUsd: 0.25 }),
    ]);

    expect(output.errors).toEqual([
      {
        rep: 2,
        stage: 'scuttlerun',
        error: 'boom',
        exit_code: 3,
        transcript: '/art/alpha/rep-2/output.yaml',
        agent_cost_usd: 0.25,
      },
    ]);
    expect(output.error_rate).toBe(0.5);
  });

  it('reports a failed rep without the optional fields it lacks', () => {
    const { output } = summarizeScenario('alpha', [graded(1, true), failed(2)]);

    expect(output.errors).toEqual([{ rep: 2, stage: 'scuttlerun', error: 'boom' }]);
  });

  it('reports a rep the pool skipped under its skip reason, or unknown without one', () => {
    const { output } = summarizeScenario('alpha', [
      graded(1, true),
      { type: 'error', rep: 2, error: 'Aborted (fail-fast)', reason: 'fail_fast' },
      { type: 'error', rep: 3, error: 'thrown' },
    ]);

    expect(output.errors).toEqual([
      { rep: 2, stage: 'fail_fast', error: 'Aborted (fail-fast)' },
      { rep: 3, stage: 'unknown', error: 'thrown' },
    ]);
  });

  it('gives a null pass rate, no checks and the errors when no rep was graded', () => {
    const { output, anySuccess } = summarizeScenario('alpha', [failed(1)]);

    expect(anySuccess).toBe(false);
    expect(output).toEqual({
      id: 'alpha',
      checks: [],
      pass_rate: null,
      error_rate: 1,
      errors: [{ rep: 1, stage: 'scuttlerun', error: 'boom' }],
    });
  });
});

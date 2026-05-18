import { describe, it, expect, vi } from 'vitest';

describe('pool', () => {
  describe('executePool', () => {
    it('runs all work items and collects results by scenario', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: vi.fn().mockResolvedValue({ type: 'success' as const, data: 's1r1' }),
        },
        {
          scenarioId: 's1',
          rep: 2,
          fn: vi.fn().mockResolvedValue({ type: 'success' as const, data: 's1r2' }),
        },
        {
          scenarioId: 's2',
          rep: 1,
          fn: vi.fn().mockResolvedValue({ type: 'success' as const, data: 's2r1' }),
        },
      ];

      const results = await executePool(workItems, 10);

      expect(results.get('s1')).toHaveLength(2);
      expect(results.get('s2')).toHaveLength(1);
      expect(results.get('s1')![0]).toEqual({
        type: 'success',
        rep: 1,
        data: { type: 'success', data: 's1r1' },
      });
    });

    it('respects concurrency limit', async () => {
      const { executePool } = await import('../src/pool.js');

      let concurrent = 0;
      let maxConcurrent = 0;

      const slowFn = () =>
        new Promise<{ type: 'success' }>((resolve) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          setTimeout(() => {
            concurrent--;
            resolve({ type: 'success' });
          }, 50);
        });

      const workItems = Array.from({ length: 6 }, (_, i) => ({
        scenarioId: `s${i}`,
        rep: 1,
        fn: slowFn,
      }));

      await executePool(workItems, 2);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('calls onScenarioComplete when all reps for a scenario finish', async () => {
      const { executePool } = await import('../src/pool.js');

      const completed: string[] = [];

      const workItems = [
        { scenarioId: 's1', rep: 1, fn: vi.fn().mockResolvedValue('s1r1') },
        { scenarioId: 's1', rep: 2, fn: vi.fn().mockResolvedValue('s1r2') },
        { scenarioId: 's2', rep: 1, fn: vi.fn().mockResolvedValue('s2r1') },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId, results) => {
          completed.push(scenarioId);
          if (scenarioId === 's1') {
            expect(results).toHaveLength(2);
          } else {
            expect(results).toHaveLength(1);
          }
        },
      });

      expect(completed).toContain('s1');
      expect(completed).toContain('s2');
    });

    it('calls onScenarioComplete in arrival order', async () => {
      const { executePool } = await import('../src/pool.js');

      const completed: string[] = [];

      const workItems = [
        {
          scenarioId: 'slow',
          rep: 1,
          fn: () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 100)),
        },
        {
          scenarioId: 'fast',
          rep: 1,
          fn: () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10)),
        },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId) => {
          completed.push(scenarioId);
        },
      });

      expect(completed[0]).toBe('fast');
      expect(completed[1]).toBe('slow');
    });

    it('calls onScenarioComplete even when all reps are errors', async () => {
      const { executePool } = await import('../src/pool.js');

      const completed: string[] = [];

      const workItems = [
        { scenarioId: 's1', rep: 1, fn: vi.fn().mockRejectedValue(new Error('boom')) },
        { scenarioId: 's1', rep: 2, fn: vi.fn().mockRejectedValue(new Error('boom')) },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId, results) => {
          completed.push(scenarioId);
          expect(results).toHaveLength(2);
          expect(results.every((r) => r.type === 'error')).toBe(true);
        },
      });

      expect(completed).toEqual(['s1']);
    });

    it('skips remaining items when budget is exceeded', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: async () => ({ cost: 0.6 }),
        },
        {
          scenarioId: 's1',
          rep: 2,
          fn: async () => ({ cost: 0.6 }),
        },
        {
          scenarioId: 's2',
          rep: 1,
          fn: async () => ({ cost: 0.6 }),
        },
      ];

      const results = await executePool(workItems, 1, {
        budgetUsd: 1.0,
        costOf: (data: { cost: number }) => data.cost,
      });

      // First two items cost 1.2 total, exceeding budget of 1.0
      // Third item should be skipped with budget error
      const s2Results = results.get('s2')!;
      expect(s2Results).toHaveLength(1);
      expect(s2Results[0].type).toBe('error');
      if (s2Results[0].type === 'error') {
        expect(s2Results[0].error).toContain('Budget exceeded');
        expect(s2Results[0].reason).toBe('budget');
      }
    });

    it('tracks cost without exceeding budget', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        { scenarioId: 's1', rep: 1, fn: async () => ({ cost: 0.3 }) },
        { scenarioId: 's1', rep: 2, fn: async () => ({ cost: 0.3 }) },
      ];

      const results = await executePool(workItems, 1, {
        budgetUsd: 10.0,
        costOf: (data: { cost: number }) => data.cost,
      });

      const s1Results = results.get('s1')!;
      expect(s1Results).toHaveLength(2);
      expect(s1Results.every((r) => r.type === 'success')).toBe(true);
    });

    it('fires onBudgetExceeded callback once when budget first trips', async () => {
      const { executePool } = await import('../src/pool.js');

      const events: number[] = [];
      const workItems = [
        { scenarioId: 's1', rep: 1, fn: async () => ({ cost: 0.6 }) },
        { scenarioId: 's1', rep: 2, fn: async () => ({ cost: 0.6 }) },
        { scenarioId: 's2', rep: 1, fn: async () => ({ cost: 0.6 }) },
      ];

      await executePool(workItems, 1, {
        budgetUsd: 1.0,
        costOf: (data: { cost: number }) => data.cost,
        onBudgetExceeded: () => {
          events.push(Date.now());
        },
      });

      expect(events).toHaveLength(1);
    });

    it('does not fire onBudgetExceeded when budget is not exceeded', async () => {
      const { executePool } = await import('../src/pool.js');

      const events: number[] = [];
      const workItems = [
        { scenarioId: 's1', rep: 1, fn: async () => ({ cost: 0.3 }) },
        { scenarioId: 's1', rep: 2, fn: async () => ({ cost: 0.3 }) },
      ];

      await executePool(workItems, 1, {
        budgetUsd: 10.0,
        costOf: (data: { cost: number }) => data.cost,
        onBudgetExceeded: () => {
          events.push(Date.now());
        },
      });

      expect(events).toHaveLength(0);
    });

    it('fires onScenarioComplete for budget-exceeded items', async () => {
      const { executePool } = await import('../src/pool.js');

      const completed: string[] = [];
      const workItems = [
        { scenarioId: 's1', rep: 1, fn: async () => ({ cost: 2.0 }) },
        { scenarioId: 's2', rep: 1, fn: async () => ({ cost: 0.1 }) },
      ];

      await executePool(workItems, 1, {
        budgetUsd: 1.0,
        costOf: (data: { cost: number }) => data.cost,
        onScenarioComplete: (scenarioId) => {
          completed.push(scenarioId);
        },
      });

      expect(completed).toContain('s1');
      expect(completed).toContain('s2');
    });

    it('handles non-Error thrown values', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: () => {
            throw 'string error';
          },
        },
      ];

      const results = await executePool(workItems, 10);

      const s1Results = results.get('s1')!;
      expect(s1Results).toHaveLength(1);
      expect(s1Results[0].type).toBe('error');
      if (s1Results[0].type === 'error') {
        expect(s1Results[0].error).toBe('string error');
      }
    });

    it('shortCircuits queued items when shouldAbort predicate returns true', async () => {
      const { executePool } = await import('../src/pool.js');

      let completedCount = 0;
      let abortFlag = false;

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: async () => {
            completedCount++;
            abortFlag = true;
            return 's1r1';
          },
        },
        {
          scenarioId: 's2',
          rep: 1,
          fn: async () => {
            completedCount++;
            return 's2r1';
          },
        },
        {
          scenarioId: 's3',
          rep: 1,
          fn: async () => {
            completedCount++;
            return 's3r1';
          },
        },
      ];

      const results = await executePool(workItems, 1, {
        shouldAbort: () => abortFlag,
      });

      expect(completedCount).toBe(1);
      expect(results.get('s2')![0].type).toBe('error');
      expect(results.get('s3')![0].type).toBe('error');
      const s2Error = results.get('s2')![0];
      if (s2Error.type === 'error') {
        expect(s2Error.reason).toBe('fail_fast');
      }
    });

    it('labels queued items as interrupted (not fail_fast) when isInterrupted is true', async () => {
      const { executePool } = await import('../src/pool.js');

      let completedCount = 0;
      let interruptFlag = false;

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: async () => {
            completedCount++;
            interruptFlag = true;
            return 's1r1';
          },
        },
        {
          scenarioId: 's2',
          rep: 1,
          fn: async () => {
            completedCount++;
            return 's2r1';
          },
        },
      ];

      const results = await executePool(workItems, 1, {
        isInterrupted: () => interruptFlag,
      });

      expect(completedCount).toBe(1);
      const s2Error = results.get('s2')![0];
      expect(s2Error.type).toBe('error');
      if (s2Error.type === 'error') {
        expect(s2Error.reason).toBe('interrupted');
        expect(s2Error.error).toBe('Interrupted (SIGINT)');
      }
    });

    it('isInterrupted takes precedence over shouldAbort for reason labeling', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: async () => 's1r1',
        },
      ];

      const results = await executePool(workItems, 1, {
        shouldAbort: () => true,
        isInterrupted: () => true,
      });

      const s1Error = results.get('s1')![0];
      expect(s1Error.type).toBe('error');
      if (s1Error.type === 'error') {
        expect(s1Error.reason).toBe('interrupted');
      }
    });

    it('fires onScenarioComplete for abort-skipped items', async () => {
      const { executePool } = await import('../src/pool.js');

      const completed: string[] = [];
      let abortFlag = false;

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: async () => {
            abortFlag = true;
            return 's1r1';
          },
        },
        { scenarioId: 's2', rep: 1, fn: async () => 's2r1' },
      ];

      await executePool(workItems, 1, {
        shouldAbort: () => abortFlag,
        onScenarioComplete: (id) => {
          completed.push(id);
        },
      });

      expect(completed).toContain('s1');
      expect(completed).toContain('s2');
    });

    it('handles failed work items without stopping others', async () => {
      const { executePool } = await import('../src/pool.js');

      const workItems = [
        {
          scenarioId: 's1',
          rep: 1,
          fn: vi.fn().mockRejectedValue(new Error('boom')),
        },
        {
          scenarioId: 's1',
          rep: 2,
          fn: vi.fn().mockResolvedValue({ type: 'success' as const, data: 'ok' }),
        },
      ];

      const results = await executePool(workItems, 10);

      expect(results.get('s1')).toHaveLength(2);
      const s1Results = results.get('s1')!;
      expect(s1Results.some((r) => r.type === 'error')).toBe(true);
      expect(s1Results.some((r) => r.type === 'success')).toBe(true);
    });
  });
});

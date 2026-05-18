import pLimit from 'p-limit';

export interface WorkItem<T> {
  scenarioId: string;
  rep: number;
  fn: () => Promise<T>;
}

export type WorkResult<T> =
  | { type: 'success'; rep: number; data: T }
  | { type: 'error'; rep: number; error: string; reason?: 'fail_fast' | 'budget' };

export interface PoolOptions<T> {
  budgetUsd?: number;
  costOf?: (result: T) => number;
  onScenarioComplete?: (scenarioId: string, results: WorkResult<T>[]) => void;
  shouldAbort?: () => boolean;
}

export async function executePool<T>(
  workItems: WorkItem<T>[],
  concurrency: number,
  options?: PoolOptions<T>,
): Promise<Map<string, WorkResult<T>[]>> {
  const limit = pLimit(concurrency);
  const results = new Map<string, WorkResult<T>[]>();

  const remaining = new Map<string, number>();
  for (const item of workItems) {
    if (!results.has(item.scenarioId)) {
      results.set(item.scenarioId, []);
    }
    remaining.set(item.scenarioId, (remaining.get(item.scenarioId) ?? 0) + 1);
  }

  const onItemDone = options?.onScenarioComplete
    ? (scenarioId: string) => {
        const left = remaining.get(scenarioId)! - 1;
        remaining.set(scenarioId, left);
        if (left === 0) {
          options.onScenarioComplete!(scenarioId, results.get(scenarioId)!);
        }
      }
    : undefined;

  let totalCost = 0;
  let budgetExceeded = false;
  const budgetUsd = options?.budgetUsd;
  const costOf = options?.costOf;

  const promises = workItems.map((item) =>
    limit(async () => {
      if (budgetExceeded || options?.shouldAbort?.()) {
        const reason: 'fail_fast' | 'budget' = budgetExceeded ? 'budget' : 'fail_fast';
        const error = budgetExceeded
          ? `Budget exceeded ($${totalCost.toFixed(4)} > $${budgetUsd})`
          : 'Aborted (fail-fast)';
        results.get(item.scenarioId)!.push({
          type: 'error',
          rep: item.rep,
          error,
          reason,
        });
        onItemDone?.(item.scenarioId);
        return;
      }

      try {
        const data = await item.fn();
        results.get(item.scenarioId)!.push({
          type: 'success',
          rep: item.rep,
          data,
        });
        onItemDone?.(item.scenarioId);

        if (budgetUsd !== undefined && costOf) {
          totalCost += costOf(data);
          if (totalCost > budgetUsd) {
            budgetExceeded = true;
            process.stderr.write(
              `[craboodle] Budget exceeded: $${totalCost.toFixed(4)} > $${budgetUsd} — skipping remaining items\n`,
            );
          }
        }
      } catch (err: unknown) {
        results.get(item.scenarioId)!.push({
          type: 'error',
          rep: item.rep,
          error: err instanceof Error ? err.message : String(err),
        });
        onItemDone?.(item.scenarioId);
      }
    }),
  );

  await Promise.allSettled(promises);

  return results;
}

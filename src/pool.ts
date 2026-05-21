import pLimit from 'p-limit';

function requireGet<K, V>(map: Map<K, V>, key: K, label: string): V {
  const v = map.get(key);
  if (v === undefined) {
    throw new Error(`${label}: map missing required key ${String(key)}`);
  }
  return v;
}

export interface WorkItem<T> {
  scenarioId: string;
  rep: number;
  fn: () => Promise<T>;
}

export type WorkResult<T> =
  | { type: 'success'; rep: number; data: T }
  | {
      type: 'error';
      rep: number;
      error: string;
      reason?: 'fail_fast' | 'budget' | 'interrupted';
    };

export interface PoolOptions<T> {
  budgetUsd?: number;
  costOf?: (result: T) => number;
  onScenarioComplete?: (scenarioId: string, results: WorkResult<T>[]) => void;
  onBudgetExceeded?: () => void;
  shouldAbort?: () => boolean;
  isInterrupted?: () => boolean;
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

  const onScenarioComplete = options?.onScenarioComplete;
  const onItemDone = onScenarioComplete
    ? (scenarioId: string) => {
        const left = requireGet(remaining, scenarioId, 'onItemDone') - 1;
        remaining.set(scenarioId, left);
        if (left === 0) {
          onScenarioComplete(scenarioId, requireGet(results, scenarioId, 'onItemDone'));
        }
      }
    : undefined;

  let totalCost = 0;
  let budgetExceeded = false;
  const budgetUsd = options?.budgetUsd;
  const costOf = options?.costOf;

  const promises = workItems.map((item) =>
    limit(async () => {
      const interrupted = options?.isInterrupted?.() ?? false;
      if (budgetExceeded || interrupted || options?.shouldAbort?.()) {
        let reason: 'fail_fast' | 'budget' | 'interrupted';
        let error: string;
        if (interrupted) {
          reason = 'interrupted';
          error = 'Interrupted (SIGINT)';
        } else if (budgetExceeded) {
          reason = 'budget';
          error = `Budget exceeded ($${totalCost.toFixed(4)} > $${budgetUsd})`;
        } else {
          reason = 'fail_fast';
          error = 'Aborted (fail-fast)';
        }
        requireGet(results, item.scenarioId, 'executePool').push({
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
        requireGet(results, item.scenarioId, 'executePool').push({
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
            options?.onBudgetExceeded?.();
          }
        }
      } catch (err: unknown) {
        requireGet(results, item.scenarioId, 'executePool').push({
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

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
  /**
   * `admit` throws when the pool would no longer start new work. An item that
   * waits on its own limits before doing work calls it once that wait is over,
   * so the skip decision is taken when the work really begins.
   */
  fn: (admit: () => void) => Promise<T>;
}

type SkipReason = 'fail_fast' | 'budget' | 'interrupted';

class PoolSkip extends Error {
  constructor(
    readonly reason: SkipReason,
    message: string,
  ) {
    super(message);
  }
}

export type WorkResult<T> =
  | { type: 'success'; rep: number; data: T }
  | {
      type: 'error';
      rep: number;
      error: string;
      reason?: SkipReason;
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

  const skipDecision = (): PoolSkip | undefined => {
    if (options?.isInterrupted?.()) return new PoolSkip('interrupted', 'Interrupted (SIGINT)');
    if (budgetExceeded) {
      return new PoolSkip('budget', `Budget exceeded ($${totalCost.toFixed(4)} > $${budgetUsd})`);
    }
    if (options?.shouldAbort?.()) return new PoolSkip('fail_fast', 'Aborted (fail-fast)');
    return undefined;
  };
  const admit = (): void => {
    const skip = skipDecision();
    if (skip) throw skip;
  };
  const recordSkip = (item: WorkItem<T>, skip: PoolSkip): void => {
    requireGet(results, item.scenarioId, 'executePool').push({
      type: 'error',
      rep: item.rep,
      error: skip.message,
      reason: skip.reason,
    });
    onItemDone?.(item.scenarioId);
  };

  const promises = workItems.map((item) =>
    limit(async () => {
      const skip = skipDecision();
      if (skip) {
        recordSkip(item, skip);
        return;
      }

      try {
        const data = await item.fn(admit);
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
        if (err instanceof PoolSkip) {
          recordSkip(item, err);
          return;
        }
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

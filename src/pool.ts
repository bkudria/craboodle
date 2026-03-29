import pLimit from "p-limit";

export interface WorkItem<T> {
  scenarioId: string;
  rep: number;
  fn: () => Promise<T>;
}

export type WorkResult<T> =
  | { type: "success"; rep: number; data: T }
  | { type: "error"; rep: number; error: string };

export interface PoolOptions<T> {
  budgetUsd?: number;
  costOf?: (result: T) => number;
}

export async function executePool<T>(
  workItems: WorkItem<T>[],
  concurrency: number,
  options?: PoolOptions<T>,
): Promise<Map<string, WorkResult<T>[]>> {
  const limit = pLimit(concurrency);
  const results = new Map<string, WorkResult<T>[]>();

  for (const item of workItems) {
    if (!results.has(item.scenarioId)) {
      results.set(item.scenarioId, []);
    }
  }

  let totalCost = 0;
  let budgetExceeded = false;
  const budgetUsd = options?.budgetUsd;
  const costOf = options?.costOf;

  const promises = workItems.map((item) =>
    limit(async () => {
      if (budgetExceeded) {
        results.get(item.scenarioId)!.push({
          type: "error",
          rep: item.rep,
          error: `Budget exceeded ($${totalCost.toFixed(4)} > $${budgetUsd})`,
        });
        return;
      }

      try {
        const data = await item.fn();
        results.get(item.scenarioId)!.push({
          type: "success",
          rep: item.rep,
          data,
        });

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
          type: "error",
          rep: item.rep,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  await Promise.allSettled(promises);

  return results;
}

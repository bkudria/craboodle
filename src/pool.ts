import pLimit from "p-limit";

export interface WorkItem<T> {
  scenarioId: string;
  rep: number;
  fn: () => Promise<T>;
}

export type WorkResult<T> =
  | { type: "success"; rep: number; data: T }
  | { type: "error"; rep: number; error: string };

export async function executePool<T>(
  workItems: WorkItem<T>[],
  concurrency: number,
): Promise<Map<string, WorkResult<T>[]>> {
  const limit = pLimit(concurrency);
  const results = new Map<string, WorkResult<T>[]>();

  for (const item of workItems) {
    if (!results.has(item.scenarioId)) {
      results.set(item.scenarioId, []);
    }
  }

  const promises = workItems.map((item) =>
    limit(async () => {
      try {
        const data = await item.fn();
        results.get(item.scenarioId)!.push({
          type: "success",
          rep: item.rep,
          data,
        });
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

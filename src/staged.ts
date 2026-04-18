import type { LimitFunction } from "p-limit";

export async function runStaged<A, B>(
  stageALimit: LimitFunction,
  stageBLimit: LimitFunction,
  stageA: () => Promise<A>,
  shouldRunStageB: (aResult: A) => boolean,
  stageB: (aResult: A) => Promise<B>,
): Promise<A | B> {
  const aResult = await stageALimit(stageA);
  if (!shouldRunStageB(aResult)) {
    return aResult;
  }
  return await stageBLimit(() => stageB(aResult));
}

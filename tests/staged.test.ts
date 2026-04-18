import { describe, it, expect, vi } from "vitest";
import pLimit from "p-limit";
import { runStaged } from "../src/staged.js";

describe("runStaged", () => {
  it("runs stageA then stageB and returns stageB's result", async () => {
    const limA = pLimit(10);
    const limB = pLimit(10);
    const stageA = vi.fn().mockResolvedValue({ type: "success", payload: "a" });
    const stageB = vi.fn().mockResolvedValue("b-result");

    const result = await runStaged(limA, limB, stageA, () => true, stageB);

    expect(stageA).toHaveBeenCalledOnce();
    expect(stageB).toHaveBeenCalledOnce();
    expect(stageB).toHaveBeenCalledWith({ type: "success", payload: "a" });
    expect(result).toBe("b-result");
  });

  it("returns stageA's result and skips stageB when shouldRunStageB is false", async () => {
    const limA = pLimit(10);
    const limB = pLimit(10);
    const stageA = vi.fn().mockResolvedValue({ type: "error", reason: "boom" });
    const stageB = vi.fn();

    const result = await runStaged(
      limA,
      limB,
      stageA,
      (a: { type: string }) => a.type !== "error",
      stageB,
    );

    expect(stageA).toHaveBeenCalledOnce();
    expect(stageB).not.toHaveBeenCalled();
    expect(result).toEqual({ type: "error", reason: "boom" });
  });

  it("releases stageA's slot before stageB starts so a different item's stageA can proceed", async () => {
    const limA = pLimit(1);
    const limB = pLimit(1);

    let item1StageBStarted = false;
    let item2StageAStarted = false;

    const item1StageA = () => Promise.resolve("a1");
    const item1StageB = () =>
      new Promise<string>((resolve) => {
        item1StageBStarted = true;
        setTimeout(() => resolve("b1"), 50);
      });

    const item2StageA = () => {
      item2StageAStarted = true;
      return Promise.resolve("a2");
    };
    const item2StageB = () => Promise.resolve("b2");

    const p1 = runStaged(limA, limB, item1StageA, () => true, item1StageB);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const p2 = runStaged(limA, limB, item2StageA, () => true, item2StageB);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(item1StageBStarted).toBe(true);
    expect(item2StageAStarted).toBe(true);

    await Promise.all([p1, p2]);
  });

  it("allows stageB and stageA of different items to be in flight simultaneously", async () => {
    const limA = pLimit(1);
    const limB = pLimit(1);

    let inA = 0;
    let inB = 0;
    let aAndBOverlap = 0;

    const makeStageA = (id: string) => async () => {
      inA++;
      if (inA > 0 && inB > 0) aAndBOverlap++;
      await new Promise((r) => setTimeout(r, 25));
      inA--;
      return id;
    };
    const makeStageB = () => async (id: string) => {
      inB++;
      if (inA > 0 && inB > 0) aAndBOverlap++;
      await new Promise((r) => setTimeout(r, 25));
      inB--;
      return `${id}-b`;
    };

    await Promise.all([
      runStaged(limA, limB, makeStageA("1"), () => true, makeStageB()),
      runStaged(limA, limB, makeStageA("2"), () => true, makeStageB()),
      runStaged(limA, limB, makeStageA("3"), () => true, makeStageB()),
    ]);

    expect(aAndBOverlap).toBeGreaterThan(0);
  });
});

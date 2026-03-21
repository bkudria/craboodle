import { describe, it, expect, vi } from "vitest";

describe("pool", () => {
  describe("executePool", () => {
    it("runs all work items and collects results by scenario", async () => {
      const { executePool } = await import("../src/pool.js");

      const workItems = [
        {
          scenarioId: "s1",
          rep: 1,
          fn: vi.fn().mockResolvedValue({ type: "success" as const, data: "s1r1" }),
        },
        {
          scenarioId: "s1",
          rep: 2,
          fn: vi.fn().mockResolvedValue({ type: "success" as const, data: "s1r2" }),
        },
        {
          scenarioId: "s2",
          rep: 1,
          fn: vi.fn().mockResolvedValue({ type: "success" as const, data: "s2r1" }),
        },
      ];

      const results = await executePool(workItems, 10);

      expect(results.get("s1")).toHaveLength(2);
      expect(results.get("s2")).toHaveLength(1);
      expect(results.get("s1")![0]).toEqual({ type: "success", rep: 1, data: { type: "success", data: "s1r1" } });
    });

    it("respects concurrency limit", async () => {
      const { executePool } = await import("../src/pool.js");

      let concurrent = 0;
      let maxConcurrent = 0;

      const slowFn = () =>
        new Promise<{ type: "success" }>((resolve) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          setTimeout(() => {
            concurrent--;
            resolve({ type: "success" });
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

    it("handles failed work items without stopping others", async () => {
      const { executePool } = await import("../src/pool.js");

      const workItems = [
        {
          scenarioId: "s1",
          rep: 1,
          fn: vi.fn().mockRejectedValue(new Error("boom")),
        },
        {
          scenarioId: "s1",
          rep: 2,
          fn: vi.fn().mockResolvedValue({ type: "success" as const, data: "ok" }),
        },
      ];

      const results = await executePool(workItems, 10);

      expect(results.get("s1")).toHaveLength(2);
      const s1Results = results.get("s1")!;
      expect(s1Results.some((r: any) => r.type === "error")).toBe(true);
      expect(s1Results.some((r: any) => r.type === "success")).toBe(true);
    });
  });
});

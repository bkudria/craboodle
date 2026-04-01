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

    it("calls onScenarioComplete when all reps for a scenario finish", async () => {
      const { executePool } = await import("../src/pool.js");

      const completed: string[] = [];

      const workItems = [
        { scenarioId: "s1", rep: 1, fn: vi.fn().mockResolvedValue("s1r1") },
        { scenarioId: "s1", rep: 2, fn: vi.fn().mockResolvedValue("s1r2") },
        { scenarioId: "s2", rep: 1, fn: vi.fn().mockResolvedValue("s2r1") },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId, results) => {
          completed.push(scenarioId);
          if (scenarioId === "s1") {
            expect(results).toHaveLength(2);
          } else {
            expect(results).toHaveLength(1);
          }
        },
      });

      expect(completed).toContain("s1");
      expect(completed).toContain("s2");
    });

    it("calls onScenarioComplete in arrival order", async () => {
      const { executePool } = await import("../src/pool.js");

      const completed: string[] = [];

      const workItems = [
        {
          scenarioId: "slow",
          rep: 1,
          fn: () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 100)),
        },
        {
          scenarioId: "fast",
          rep: 1,
          fn: () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10)),
        },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId) => {
          completed.push(scenarioId);
        },
      });

      expect(completed[0]).toBe("fast");
      expect(completed[1]).toBe("slow");
    });

    it("calls onScenarioComplete even when all reps are errors", async () => {
      const { executePool } = await import("../src/pool.js");

      const completed: string[] = [];

      const workItems = [
        { scenarioId: "s1", rep: 1, fn: vi.fn().mockRejectedValue(new Error("boom")) },
        { scenarioId: "s1", rep: 2, fn: vi.fn().mockRejectedValue(new Error("boom")) },
      ];

      await executePool(workItems, 10, {
        onScenarioComplete: (scenarioId, results) => {
          completed.push(scenarioId);
          expect(results).toHaveLength(2);
          expect(results.every((r) => r.type === "error")).toBe(true);
        },
      });

      expect(completed).toEqual(["s1"]);
    });

    it("skips remaining items when budget is exceeded", async () => {
      const { executePool } = await import("../src/pool.js");

      let callCount = 0;
      const workItems = [
        { scenarioId: "s1", rep: 1, fn: async () => { callCount++; return { cost: 0.6 }; } },
        { scenarioId: "s1", rep: 2, fn: async () => { callCount++; return { cost: 0.6 }; } },
        { scenarioId: "s2", rep: 1, fn: async () => { callCount++; return { cost: 0.6 }; } },
      ];

      const results = await executePool(workItems, 1, {
        budgetUsd: 1.0,
        costOf: (data: { cost: number }) => data.cost,
      });

      // First two items cost 1.2 total, exceeding budget of 1.0
      // Third item should be skipped with budget error
      const s2Results = results.get("s2")!;
      expect(s2Results).toHaveLength(1);
      expect(s2Results[0].type).toBe("error");
      if (s2Results[0].type === "error") {
        expect(s2Results[0].error).toContain("Budget exceeded");
      }
    });

    it("tracks cost without exceeding budget", async () => {
      const { executePool } = await import("../src/pool.js");

      const workItems = [
        { scenarioId: "s1", rep: 1, fn: async () => ({ cost: 0.3 }) },
        { scenarioId: "s1", rep: 2, fn: async () => ({ cost: 0.3 }) },
      ];

      const results = await executePool(workItems, 1, {
        budgetUsd: 10.0,
        costOf: (data: { cost: number }) => data.cost,
      });

      const s1Results = results.get("s1")!;
      expect(s1Results).toHaveLength(2);
      expect(s1Results.every((r) => r.type === "success")).toBe(true);
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
      expect(s1Results.some((r) => r.type === "error")).toBe(true);
      expect(s1Results.some((r) => r.type === "success")).toBe(true);
    });
  });
});

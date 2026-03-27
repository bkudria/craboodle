import { describe, it, expect, vi, beforeEach } from "vitest";

describe("output", () => {
  let written: string;
  beforeEach(() => {
    written = "";
    vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      });
  });

  describe("parseCostFromTranscript", () => {
    it("extracts cost_usd from scuttlerun transcript YAML", async () => {
      const { parseCostFromTranscript } = await import("../src/output.js");
      const yaml = `session: abc\ncost_usd: 0.0523\nturns: 2`;
      expect(parseCostFromTranscript(yaml)).toBe(0.0523);
    });

    it("returns null when cost_usd is missing", async () => {
      const { parseCostFromTranscript } = await import("../src/output.js");
      const yaml = `session: abc\nturns: 2`;
      expect(parseCostFromTranscript(yaml)).toBeNull();
    });

    it("returns null when cost_usd is not a number", async () => {
      const { parseCostFromTranscript } = await import("../src/output.js");
      const yaml = `cost_usd: "expensive"`;
      expect(parseCostFromTranscript(yaml)).toBeNull();
    });

    it("returns null for invalid YAML", async () => {
      const { parseCostFromTranscript } = await import("../src/output.js");
      expect(parseCostFromTranscript("{{invalid")).toBeNull();
    });
  });

  describe("parseGrading", () => {
    it("extracts assertion results from pincenez YAML output", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `assertions:
  - id: a1
    check: "Output contains a function"
    pass: true
    evidence: "Function found"
  - id: a2
    check: "Handles edge cases"
    pass: false
    evidence: "No empty string handling"
pass_rate: 0.5
`;

      const results = parseGrading(yaml);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: "a1",
        check: "Output contains a function",
        pass: true,
        evidence: "Function found",
      });
      expect(results[1]).toEqual({
        id: "a2",
        check: "Handles edge cases",
        pass: false,
        evidence: "No empty string handling",
      });
    });

    it("handles null pass values", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `assertions:
  - id: a1
    check: "test"
    pass: null
    evidence: "error: could not extract verdict"
pass_rate: 0
`;

      const results = parseGrading(yaml);

      expect(results[0].pass).toBeNull();
    });
  });

  describe("averageResults", () => {
    it("computes pass_rate for a single rep", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [
          { id: "a1", check: "test1", pass: true, evidence: "ok" },
          { id: "a2", check: "test2", pass: false, evidence: "no" },
        ],
      ];

      const result = averageResults(repGradings);

      expect(result.assertions[0].pass_rate).toBe(1.0);
      expect(result.assertions[1].pass_rate).toBe(0.0);
      expect(result.pass_rate).toBe(0.5);
    });

    it("averages across multiple reps", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
        [{ id: "a1", check: "test", pass: false, evidence: "no" }],
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
      ];

      const result = averageResults(repGradings);

      expect(result.assertions[0].pass_rate).toBeCloseTo(0.67, 2);
    });

    it("treats null as failure (0)", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
        [{ id: "a1", check: "test", pass: null, evidence: "error" }],
      ];

      const result = averageResults(repGradings);

      expect(result.assertions[0].pass_rate).toBe(0.5);
    });

    it("computes scenario pass_rate as mean of assertion pass_rates", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [
          { id: "a1", check: "always pass", pass: true, evidence: "ok" },
          { id: "a2", check: "always fail", pass: false, evidence: "no" },
        ],
      ];

      const result = averageResults(repGradings);

      expect(result.pass_rate).toBe(0.5);
    });
  });

  describe("compact/verbose output", () => {
    it("produces compact output for passing assertions", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test passes", pass: true, evidence: "ok" }],
      ];

      const result = averageResults(repGradings);

      expect(result.assertions[0]).toEqual({
        check: "test passes",
        pass_rate: 1.0,
      });
      expect(result.assertions[0]).not.toHaveProperty("failures");
    });

    it("produces verbose output for failing assertions with per-rep evidence", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
        [{ id: "a1", check: "test", pass: false, evidence: "missing X" }],
      ];

      const result = averageResults(repGradings);

      expect(result.assertions[0].pass_rate).toBe(0.5);
      expect(result.assertions[0].failures).toEqual([
        { rep: 2, evidence: "missing X" },
      ]);
    });
  });

  describe("streamHeader", () => {
    it("writes artifact_dir and scenarios key", async () => {
      const { streamHeader } = await import("../src/output.js");

      streamHeader("/tmp/craboodle-run-abc");

      expect(written).toBe("artifact_dir: /tmp/craboodle-run-abc\nscenarios:\n");
    });
  });

  describe("streamScenarioYaml", () => {
    it("writes atomic YAML block for a scenario", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "email-validator",
        assertions: [{ check: "test passes", pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      expect(written).toContain("- id: email-validator");
      expect(written).toContain("pass_rate: 1");
      expect(written).toContain("check: test passes");
    });

    it("includes labels when present", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "test",
        labels: { config: "optimized" },
        assertions: [{ check: "test", pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      expect(written).toContain("config: optimized");
    });

    it("includes errors when present", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "test",
        assertions: [{ check: "test", pass_rate: 1.0 }],
        pass_rate: 1.0,
        errors: [{ rep: 3, stage: "scuttlerun", error: "timeout after 120s" }],
      });

      expect(written).toContain("timeout after 120s");
      expect(written).toContain("stage: scuttlerun");
    });

    it("handles null pass_rate for all-failed scenarios", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "broken",
        assertions: [{ check: "test", pass_rate: 0 }],
        pass_rate: null,
        errors: [
          { rep: 1, stage: "scuttlerun", error: "crash" },
          { rep: 2, stage: "scuttlerun", error: "crash" },
        ],
      });

      expect(written).toContain("pass_rate: null");
    });
  });

  describe("full YAML integration", () => {
    it("produces valid YAML when header + scenarios are combined", async () => {
      const { parse } = await import("yaml");
      const { streamHeader, streamScenarioYaml } = await import(
        "../src/output.js"
      );

      streamHeader("/tmp/craboodle-run-abc");
      streamScenarioYaml({
        id: "scenario-a",
        labels: { config: "optimized" },
        assertions: [
          { check: "passes", pass_rate: 1.0 },
          {
            check: "sometimes fails",
            pass_rate: 0.67,
            failures: [{ rep: 2, evidence: "not found" }],
          },
        ],
        pass_rate: 0.83,
      });
      streamScenarioYaml({
        id: "scenario-b",
        assertions: [{ check: "always passes", pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      const parsed = parse(written);
      expect(parsed.artifact_dir).toBe("/tmp/craboodle-run-abc");
      expect(parsed.scenarios).toHaveLength(2);
      expect(parsed.scenarios[0].id).toBe("scenario-a");
      expect(parsed.scenarios[0].labels.config).toBe("optimized");
      expect(parsed.scenarios[0].pass_rate).toBe(0.83);
      expect(parsed.scenarios[1].id).toBe("scenario-b");
      expect(parsed.scenarios[1].pass_rate).toBe(1.0);
    });
  });
});

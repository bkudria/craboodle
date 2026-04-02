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
    it("extracts check results from pincenez YAML output", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `checks:
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

      const result = parseGrading(yaml);

      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]).toEqual({
        id: "a1",
        check: "Output contains a function",
        pass: true,
        evidence: "Function found",
      });
      expect(result.checks[1]).toEqual({
        id: "a2",
        check: "Handles edge cases",
        pass: false,
        evidence: "No empty string handling",
      });
      expect(result.costUsd).toBeNull();
    });

    it("handles null pass values", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `checks:
  - id: a1
    check: "test"
    pass: null
    evidence: "error: could not extract verdict"
pass_rate: 0
`;

      const result = parseGrading(yaml);

      expect(result.checks[0].pass).toBeNull();
    });

    it("throws on malformed grading YAML (missing checks)", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `pass_rate: 1.0\n`;

      expect(() => parseGrading(yaml)).toThrow();
    });

    it("throws on grading with invalid check structure", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `checks:
  - wrong_field: true
pass_rate: 1
`;

      expect(() => parseGrading(yaml)).toThrow();
    });

    it("extracts cost_usd from pincenez YAML when present", async () => {
      const { parseGrading } = await import("../src/output.js");

      const yaml = `checks:
  - id: a1
    check: "test"
    pass: true
    evidence: "ok"
pass_rate: 1
cost_usd: 0.0042
`;

      const result = parseGrading(yaml);

      expect(result.costUsd).toBe(0.0042);
    });
  });

  describe("averageResults", () => {
    it("returns empty results for empty input", async () => {
      const { averageResults } = await import("../src/output.js");

      const result = averageResults([]);

      expect(result.checks).toEqual([]);
      expect(result.pass_rate).toBe(0);
    });

    it("returns 0 pass_rate when checks array is empty per rep", async () => {
      const { averageResults } = await import("../src/output.js");

      // A rep with zero checks (edge case)
      const result = averageResults([[]]);

      expect(result.checks).toEqual([]);
      expect(result.pass_rate).toBe(0);
    });

    it("computes pass_rate for a single rep", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [
          { id: "a1", check: "test1", pass: true, evidence: "ok" },
          { id: "a2", check: "test2", pass: false, evidence: "no" },
        ],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(1.0);
      expect(result.checks[1].pass_rate).toBe(0.0);
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

      expect(result.checks[0].pass_rate).toBeCloseTo(0.67, 2);
    });

    it("treats null as failure (0)", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
        [{ id: "a1", check: "test", pass: null, evidence: "error" }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(0.5);
    });

    it("computes scenario pass_rate as mean of check pass_rates", async () => {
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
    it("produces compact output for passing checks", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test passes", pass: true, evidence: "ok" }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0]).toEqual({
        check: "test passes",
        pass_rate: 1.0,
      });
      expect(result.checks[0]).not.toHaveProperty("failures");
    });

    it("produces verbose output for failing checks with per-rep evidence", async () => {
      const { averageResults } = await import("../src/output.js");

      const repGradings = [
        [{ id: "a1", check: "test", pass: true, evidence: "ok" }],
        [{ id: "a1", check: "test", pass: false, evidence: "missing X" }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(0.5);
      expect(result.checks[0].failures).toEqual([
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
        checks: [{ check: "test passes", pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      expect(written).toContain("- id: email-validator");
      expect(written).toContain("pass_rate: 1");
      expect(written).toContain("check: test passes");
    });

    it("includes errors when present", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "test",
        checks: [{ check: "test", pass_rate: 1.0 }],
        pass_rate: 1.0,
        errors: [{ rep: 3, stage: "scuttlerun", error: "timeout after 120s" }],
      });

      expect(written).toContain("timeout after 120s");
      expect(written).toContain("stage: scuttlerun");
    });

    it("includes cost fields when present", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "test",
        checks: [{ check: "test", pass_rate: 1.0 }],
        pass_rate: 1.0,
        cost_usd: 0.0294,
        agent_cost_usd: 0.0234,
        grading_cost_usd: 0.006,
      });

      expect(written).toContain("cost_usd: 0.0294");
      expect(written).toContain("agent_cost_usd: 0.0234");
      expect(written).toContain("grading_cost_usd: 0.006");
    });

    it("handles null pass_rate for all-failed scenarios", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "broken",
        checks: [{ check: "test", pass_rate: 0 }],
        pass_rate: null,
        errors: [
          { rep: 1, stage: "scuttlerun", error: "crash" },
          { rep: 2, stage: "scuttlerun", error: "crash" },
        ],
      });

      expect(written).toContain("pass_rate: null");
    });
  });

  describe("parseLintResult", () => {
    it("parses pincenez lint YAML output", async () => {
      const { parseLintResult } = await import("../src/output.js");

      const yaml = `checks:
  - id: check-0
    check: "Output contains a validation function"
    issues: []
  - id: check-1
    check: "Handles edge cases"
    issues:
      - compound
      - vague
checks_total: 2
checks_with_issues: 1
`;

      const result = parseLintResult(yaml);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "check-0",
        check: "Output contains a validation function",
        issues: [],
      });
      expect(result[1]).toEqual({
        id: "check-1",
        check: "Handles edge cases",
        issues: ["compound", "vague"],
      });
    });

    it("handles checks with no issues field", async () => {
      const { parseLintResult } = await import("../src/output.js");

      const yaml = `checks:
  - id: check-0
    check: "test"
checks_total: 1
checks_with_issues: 0
`;

      const result = parseLintResult(yaml);
      expect(result[0].issues).toEqual([]);
    });
  });

  describe("streamTotalCost", () => {
    it("writes total_cost_usd to stdout", async () => {
      const { streamTotalCost } = await import("../src/output.js");

      streamTotalCost(0.0456);

      expect(written).toContain("total_cost_usd: 0.0456");
    });

    it("rounds to 4 decimal places", async () => {
      const { streamTotalCost } = await import("../src/output.js");

      streamTotalCost(0.12345678);

      expect(written).toContain("total_cost_usd: 0.1235");
    });
  });

  describe("streamLintScenarioYaml", () => {
    it("writes YAML block for a lint scenario", async () => {
      const { streamLintScenarioYaml } = await import("../src/output.js");

      streamLintScenarioYaml({
        id: "email-validator",
        checks: [
          { id: "check-0", check: "validates email", issues: [] },
          { id: "check-1", check: "handles edge cases", issues: ["compound"] },
        ],
        checks_total: 2,
        checks_with_issues: 1,
      });

      expect(written).toContain("- id: email-validator");
      expect(written).toContain("checks_total: 2");
      expect(written).toContain("checks_with_issues: 1");
      expect(written).toContain("compound");
    });
  });

  describe("streamLintTotals", () => {
    it("writes aggregate lint totals", async () => {
      const { streamLintTotals } = await import("../src/output.js");

      streamLintTotals({
        scenarios_total: 3,
        scenarios_with_issues: 1,
        checks_total: 10,
        checks_with_issues: 2,
      });

      expect(written).toContain("scenarios_total: 3");
      expect(written).toContain("scenarios_with_issues: 1");
      expect(written).toContain("checks_total: 10");
      expect(written).toContain("checks_with_issues: 2");
    });
  });

  describe("writeYamlArrayItem", () => {
    it("serializes an object as a YAML list item with proper indentation", async () => {
      const { writeYamlArrayItem } = await import("../src/output.js");

      const result = writeYamlArrayItem({ id: "test", count: 3 });

      expect(result).toBe("  - id: test\n    count: 3");
    });

    it("uses block literal style for multiline strings", async () => {
      const { writeYamlArrayItem } = await import("../src/output.js");

      const result = writeYamlArrayItem({ id: "test", message: "line one\nline two\n" });

      expect(result).toContain("message: |\n");
      expect(result).toContain("      line one\n");
      expect(result).toContain("      line two");
    });

    it("handles nested objects", async () => {
      const { writeYamlArrayItem } = await import("../src/output.js");

      const result = writeYamlArrayItem({ id: "test", metadata: { env: "prod" } });

      expect(result).toContain("  - id: test");
      expect(result).toContain("    metadata:");
      expect(result).toContain("      env: prod");
    });
  });

  describe("streamScenarioYaml multiline", () => {
    it("uses block literal style for multiline error strings", async () => {
      const { streamScenarioYaml } = await import("../src/output.js");

      streamScenarioYaml({
        id: "test",
        checks: [{ check: "test", pass_rate: 0 }],
        pass_rate: null,
        errors: [{ rep: 1, stage: "scuttlerun", error: "line one\nline two\n" }],
      });

      expect(written).toContain("error: |\n");
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
        checks: [
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
        checks: [{ check: "always passes", pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      const parsed = parse(written);
      expect(parsed.artifact_dir).toBe("/tmp/craboodle-run-abc");
      expect(parsed.scenarios).toHaveLength(2);
      expect(parsed.scenarios[0].id).toBe("scenario-a");
      expect(parsed.scenarios[0].pass_rate).toBe(0.83);
      expect(parsed.scenarios[1].id).toBe("scenario-b");
      expect(parsed.scenarios[1].pass_rate).toBe(1.0);
    });
  });
});

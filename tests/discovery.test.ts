import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { filterScenarios, type ScenarioRef } from "../src/discovery.js";

describe("discovery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("discovers scenario directories containing scenario.yaml", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "scenario-a"));
    await writeFile(join(tmpDir, "scenario-a", "scenario.yaml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "scenario-b"));
    await writeFile(join(tmpDir, "scenario-b", "scenario.yaml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].id).toBe("scenario-a");
    expect(scenarios[1].id).toBe("scenario-b");
    expect(scenarios[0].configPath).toBe(
      join(tmpDir, "scenario-a", "scenario.yaml"),
    );
  });

  it("sorts scenarios alphabetically by ID", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "zebra"));
    await writeFile(join(tmpDir, "zebra", "scenario.yaml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "alpha"));
    await writeFile(join(tmpDir, "alpha", "scenario.yaml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "middle"));
    await writeFile(join(tmpDir, "middle", "scenario.yaml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios.map((s) => s.id)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("returns empty array for empty evals dir", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toEqual([]);
  });

  it("ignores directories without scenario.yaml", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "has-scenario"));
    await writeFile(
      join(tmpDir, "has-scenario", "scenario.yaml"),
      "prompt: hi\n",
    );
    await mkdir(join(tmpDir, "no-scenario"));
    await writeFile(join(tmpDir, "no-scenario", "other.yaml"), "foo: bar\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe("has-scenario");
  });

  it("ignores files at evals dir root", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await writeFile(join(tmpDir, "base.yaml"), "model: sonnet\n");
    await mkdir(join(tmpDir, "scenario-a"));
    await writeFile(join(tmpDir, "scenario-a", "scenario.yaml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(1);
  });
});

describe("filterScenarios", () => {
  const scenarios: ScenarioRef[] = [
    { id: "email-validator", dir: "/tmp/email-validator", configPath: "/tmp/email-validator/scenario.yaml" },
    { id: "email-parser", dir: "/tmp/email-parser", configPath: "/tmp/email-parser/scenario.yaml" },
    { id: "url-parser", dir: "/tmp/url-parser", configPath: "/tmp/url-parser/scenario.yaml" },
  ];

  it("filters by exact match", () => {
    const result = filterScenarios(scenarios, "email-validator");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("email-validator");
  });

  it("filters by glob wildcard", () => {
    const result = filterScenarios(scenarios, "email-*");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["email-validator", "email-parser"]);
  });

  it("filters by comma-separated list", () => {
    const result = filterScenarios(scenarios, "email-validator,url-parser");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["email-validator", "url-parser"]);
  });

  it("supports comma-separated globs", () => {
    const result = filterScenarios(scenarios, "email-*,url-*");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterScenarios(scenarios, "nonexistent");
    expect(result).toEqual([]);
  });

  it("handles whitespace around commas", () => {
    const result = filterScenarios(scenarios, "email-validator , url-parser");
    expect(result).toHaveLength(2);
  });
});

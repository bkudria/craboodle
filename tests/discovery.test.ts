import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

describe("discovery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("discovers scenario directories containing scenario.yml", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "scenario-a"));
    await writeFile(join(tmpDir, "scenario-a", "scenario.yml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "scenario-b"));
    await writeFile(join(tmpDir, "scenario-b", "scenario.yml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].id).toBe("scenario-a");
    expect(scenarios[1].id).toBe("scenario-b");
    expect(scenarios[0].configPath).toBe(
      join(tmpDir, "scenario-a", "scenario.yml"),
    );
  });

  it("sorts scenarios alphabetically by ID", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "zebra"));
    await writeFile(join(tmpDir, "zebra", "scenario.yml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "alpha"));
    await writeFile(join(tmpDir, "alpha", "scenario.yml"), "prompt: hi\n");
    await mkdir(join(tmpDir, "middle"));
    await writeFile(join(tmpDir, "middle", "scenario.yml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios.map((s) => s.id)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("returns empty array for empty evals dir", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toEqual([]);
  });

  it("ignores directories without scenario.yml", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await mkdir(join(tmpDir, "has-scenario"));
    await writeFile(
      join(tmpDir, "has-scenario", "scenario.yml"),
      "prompt: hi\n",
    );
    await mkdir(join(tmpDir, "no-scenario"));
    await writeFile(join(tmpDir, "no-scenario", "other.yml"), "foo: bar\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe("has-scenario");
  });

  it("ignores files at evals dir root", async () => {
    const { discoverScenarios } = await import("../src/discovery.js");

    await writeFile(join(tmpDir, "base.yml"), "model: sonnet\n");
    await mkdir(join(tmpDir, "scenario-a"));
    await writeFile(join(tmpDir, "scenario-a", "scenario.yml"), "prompt: hi\n");

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(1);
  });
});

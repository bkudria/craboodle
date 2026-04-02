import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("loadScenarioConfig", () => {
    it("parses a valid scenario.yaml with prompt and checks", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write a haiku about the ocean",
          checks: [
            { check: "Output contains a haiku" },
            { check: "Haiku follows 5-7-5 pattern", note: "Count syllables" },
          ],
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.prompt).toBe("Write a haiku about the ocean");
      expect(config.checks).toHaveLength(2);
      expect(config.checks[0].check).toBe("Output contains a haiku");
      expect(config.checks[1].note).toBe("Count syllables");
    });

    it("throws on missing prompt", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          checks: [{ check: "something" }],
        }),
      );

      await expect(loadScenarioConfig(scenarioPath)).rejects.toThrow();
    });

    it("throws on empty checks array", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [],
        }),
      );

      await expect(loadScenarioConfig(scenarioPath)).rejects.toThrow();
    });

    it("throws on unknown top-level keys (strict mode)", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
          unknown_key: "should fail",
        }),
      );

      await expect(loadScenarioConfig(scenarioPath)).rejects.toThrow();
    });

    it("passes through scuttlerun block without validation", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
          scuttlerun: {
            model: "claude-sonnet-4-6",
            user: { persona: "A beginner" },
            arbitrary_key: { nested: true },
          },
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.scuttlerun).toEqual({
        model: "claude-sonnet-4-6",
        user: { persona: "A beginner" },
        arbitrary_key: { nested: true },
      });
    });

    it("parses optional labels", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
          labels: { config: "optimized", model: "sonnet" },
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.labels).toEqual({ config: "optimized", model: "sonnet" });
    });

    it("parses optional repeats override", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
          repeats: 5,
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.repeats).toBe(5);
    });

    it("leaves repeats undefined when not specified", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.repeats).toBeUndefined();
    });

    it("parses optional context", async () => {
      const { loadScenarioConfig } = await import("../src/config.js");
      const scenarioPath = join(tmpDir, "scenario.yaml");
      await writeFile(
        scenarioPath,
        stringify({
          prompt: "Write something",
          checks: [{ check: "something" }],
          context: "The agent was asked to write an email validator.",
        }),
      );

      const config = await loadScenarioConfig(scenarioPath);

      expect(config.context).toBe(
        "The agent was asked to write an email validator.",
      );
    });
  });

  describe("loadBaseConfig", () => {
    it("returns scuttlerun config without craboodle keys", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({
          version: "1",
          model: "claude-sonnet-4-6",
          tools: ["Read", "Write", "Bash"],
        }),
      );

      const config = await loadBaseConfig(basePath);

      expect(config.version).toBe("1");
      expect(config.minPassRate).toBeUndefined();
      expect(config.scuttlerunConfig).toEqual({
        model: "claude-sonnet-4-6",
        tools: ["Read", "Write", "Bash"],
      });
    });

    it("extracts min_pass_rate from base config", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({
          version: "1",
          min_pass_rate: 0.8,
          model: "claude-sonnet-4-6",
        }),
      );

      const config = await loadBaseConfig(basePath);

      expect(config.minPassRate).toBe(0.8);
      expect(config.scuttlerunConfig).toEqual({
        model: "claude-sonnet-4-6",
      });
    });

    it("returns null scuttlerunConfig when only craboodle keys present", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", min_pass_rate: 0.5 }),
      );

      const config = await loadBaseConfig(basePath);

      expect(config.minPassRate).toBe(0.5);
      expect(config.scuttlerunConfig).toBeNull();
    });

    it("throws on invalid min_pass_rate (not a number)", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", min_pass_rate: "high" }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        "min_pass_rate must be a number between 0 and 1",
      );
    });

    it("throws on min_pass_rate out of range", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", min_pass_rate: 1.5 }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        "min_pass_rate must be a number between 0 and 1",
      );
    });

    it("re-throws non-ENOENT errors", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      // Reading a directory as a file gives EISDIR
      await expect(loadBaseConfig(tmpDir)).rejects.toThrow();
    });

    it("returns null scuttlerunConfig if file does not exist", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const config = await loadBaseConfig(join(tmpDir, "nonexistent.yaml"));

      expect(config.version).toBeUndefined();
      expect(config.minPassRate).toBeUndefined();
      expect(config.scuttlerunConfig).toBeNull();
    });

    it("throws when version is missing from base.yaml", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ min_pass_rate: 0.8 }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        'missing required "version" field',
      );
    });

    it("throws on unsupported version", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "99" }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        "Unsupported eval format version: 99",
      );
    });

    it("accepts version 1 as a number (coerced to string)", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: 1 }),
      );

      const config = await loadBaseConfig(basePath);
      expect(config.version).toBe("1");
    });

    it("extracts max_budget_usd from base config", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", max_budget_usd: 5.0 }),
      );

      const config = await loadBaseConfig(basePath);

      expect(config.maxBudgetUsd).toBe(5.0);
    });

    it("throws on invalid max_budget_usd (not a number)", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", max_budget_usd: "expensive" }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        "max_budget_usd must be a positive number",
      );
    });

    it("throws on non-positive max_budget_usd", async () => {
      const { loadBaseConfig } = await import("../src/config.js");
      const basePath = join(tmpDir, "base.yaml");
      await writeFile(
        basePath,
        stringify({ version: "1", max_budget_usd: 0 }),
      );

      await expect(loadBaseConfig(basePath)).rejects.toThrow(
        "max_budget_usd must be a positive number",
      );
    });
  });
});

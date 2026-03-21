import { describe, it, expect } from "vitest";
import type { ScenarioConfig } from "../src/config.js";

describe("builder", () => {
  describe("buildScuttlerunOverride", () => {
    it("produces object with unwrapped scuttlerun block + prompt", async () => {
      const { buildScuttlerunOverride } = await import("../src/builder.js");

      const scenario: ScenarioConfig = {
        prompt: "Write a haiku",
        assertions: [{ check: "Contains haiku" }],
        scuttlerun: {
          model: "claude-sonnet-4-6",
          user: { persona: "A beginner" },
        },
      };

      const override = buildScuttlerunOverride(scenario);

      expect(override).toEqual({
        prompt: "Write a haiku",
        model: "claude-sonnet-4-6",
        user: { persona: "A beginner" },
      });
    });

    it("produces object with just prompt when no scuttlerun block", async () => {
      const { buildScuttlerunOverride } = await import("../src/builder.js");

      const scenario: ScenarioConfig = {
        prompt: "Write a haiku",
        assertions: [{ check: "Contains haiku" }],
      };

      const override = buildScuttlerunOverride(scenario);

      expect(override).toEqual({ prompt: "Write a haiku" });
    });
  });

  describe("buildRubric", () => {
    it("produces rubric with assertions and explicit context", async () => {
      const { buildRubric } = await import("../src/builder.js");

      const scenario: ScenarioConfig = {
        prompt: "Write a haiku",
        assertions: [
          { check: "Contains haiku" },
          { check: "Follows 5-7-5", note: "Count syllables" },
        ],
        context: "The agent was asked to write a haiku.",
      };

      const rubric = buildRubric(scenario);

      expect(rubric.assertions).toEqual([
        { check: "Contains haiku" },
        { check: "Follows 5-7-5", note: "Count syllables" },
      ]);
      expect(rubric.context).toBe("The agent was asked to write a haiku.");
    });

    it("uses prompt as context when no explicit context", async () => {
      const { buildRubric } = await import("../src/builder.js");

      const scenario: ScenarioConfig = {
        prompt: "Write a haiku about the ocean",
        assertions: [{ check: "Contains haiku" }],
      };

      const rubric = buildRubric(scenario);

      expect(rubric.context).toBe("Write a haiku about the ocean");
    });

    it("uses explicit context over prompt when both present", async () => {
      const { buildRubric } = await import("../src/builder.js");

      const scenario: ScenarioConfig = {
        prompt: "Write a haiku about the ocean",
        assertions: [{ check: "Contains haiku" }],
        context: "Custom context for grading",
      };

      const rubric = buildRubric(scenario);

      expect(rubric.context).toBe("Custom context for grading");
    });
  });
});

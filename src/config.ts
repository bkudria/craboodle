import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod/v4";

const AssertionSchema = z.object({
  check: z.string(),
  note: z.string().optional(),
});

const ScenarioConfigSchema = z
  .object({
    prompt: z.string().min(1),
    assertions: z.array(AssertionSchema).min(1),
    labels: z.record(z.string(), z.string()).optional(),
    context: z.string().optional(),
    scuttlerun: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Assertion = z.infer<typeof AssertionSchema>;
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

export async function loadScenarioConfig(
  path: string,
): Promise<ScenarioConfig> {
  const content = await readFile(path, "utf8");
  const raw = parse(content);
  return ScenarioConfigSchema.parse(raw);
}

export interface BaseConfig {
  minPassRate?: number;
  scuttlerunConfig: Record<string, unknown> | null;
}

export async function loadBaseConfig(
  path: string,
): Promise<BaseConfig> {
  let raw: Record<string, unknown>;
  try {
    const content = await readFile(path, "utf8");
    raw = parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { scuttlerunConfig: null };
    }
    throw err;
  }

  // Extract craboodle-specific keys, pass the rest to scuttlerun
  const { min_pass_rate, ...scuttlerunConfig } = raw;

  let minPassRate: number | undefined;
  if (min_pass_rate !== undefined) {
    if (typeof min_pass_rate !== "number" || min_pass_rate < 0 || min_pass_rate > 1) {
      throw new Error("min_pass_rate must be a number between 0 and 1");
    }
    minPassRate = min_pass_rate;
  }

  return {
    minPassRate,
    scuttlerunConfig: Object.keys(scuttlerunConfig).length > 0 ? scuttlerunConfig : null,
  };
}

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

export async function loadBaseConfig(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, "utf8");
    return parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

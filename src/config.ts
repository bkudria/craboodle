import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod/v4";

const CheckSchema = z.object({
  check: z.string(),
  note: z.string().optional(),
});

const ScenarioConfigSchema = z
  .object({
    prompt: z.string().min(1),
    checks: z.array(CheckSchema).min(1),
    labels: z.record(z.string(), z.string()).optional(),
    context: z.string().optional(),
    repeats: z.number().int().min(1).optional(),
    scuttlerun: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Check = z.infer<typeof CheckSchema>;
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

export async function loadScenarioConfig(
  path: string,
): Promise<ScenarioConfig> {
  const content = await readFile(path, "utf8");
  const raw = parse(content);
  return ScenarioConfigSchema.parse(raw);
}

export interface BaseConfig {
  version?: string;
  minPassRate?: number;
  maxBudgetUsd?: number;
  scuttlerunConfig: Record<string, unknown> | null;
}

const SUPPORTED_VERSIONS = ["1"];

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
  const { version, min_pass_rate, max_budget_usd, ...scuttlerunConfig } = raw;

  // Validate version (required when base.yaml exists)
  if (version === undefined) {
    throw new Error('base.yaml missing required "version" field (supported: ' + SUPPORTED_VERSIONS.join(", ") + ")");
  }
  const versionStr = String(version);
  if (!SUPPORTED_VERSIONS.includes(versionStr)) {
    throw new Error(`Unsupported eval format version: ${versionStr} (supported: ${SUPPORTED_VERSIONS.join(", ")})`);
  }

  let minPassRate: number | undefined;
  if (min_pass_rate !== undefined) {
    if (typeof min_pass_rate !== "number" || min_pass_rate < 0 || min_pass_rate > 1) {
      throw new Error("min_pass_rate must be a number between 0 and 1");
    }
    minPassRate = min_pass_rate;
  }

  let maxBudgetUsd: number | undefined;
  if (max_budget_usd !== undefined) {
    if (typeof max_budget_usd !== "number" || max_budget_usd <= 0) {
      throw new Error("max_budget_usd must be a positive number");
    }
    maxBudgetUsd = max_budget_usd;
  }

  return {
    version: versionStr,
    minPassRate,
    maxBudgetUsd,
    scuttlerunConfig: Object.keys(scuttlerunConfig).length > 0 ? scuttlerunConfig : null,
  };
}

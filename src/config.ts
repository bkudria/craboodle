import { readFile, access } from "node:fs/promises";
import { parse } from "yaml";

export interface CraboodleConfig {
  version?: string;
  minPassRate?: number;
  maxBudgetUsd?: number;
  repeats?: number;
}

const SUPPORTED_VERSIONS = ["1"];
const KNOWN_KEYS = ["version", "min_pass_rate", "max_budget_usd", "repeats"];

export async function loadCraboodleConfig(
  path: string,
): Promise<CraboodleConfig> {
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
      return {};
    }
    throw err;
  }

  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_KEYS.includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(
      `craboodle.yaml has unknown key(s): ${unknownKeys.join(", ")} (supported: ${KNOWN_KEYS.join(", ")})`,
    );
  }

  // Validate version (required when file exists)
  if (raw.version === undefined) {
    throw new Error('craboodle.yaml missing required "version" field (supported: ' + SUPPORTED_VERSIONS.join(", ") + ")");
  }
  const versionStr = String(raw.version);
  if (!SUPPORTED_VERSIONS.includes(versionStr)) {
    throw new Error(`Unsupported eval format version: ${versionStr} (supported: ${SUPPORTED_VERSIONS.join(", ")})`);
  }

  let minPassRate: number | undefined;
  if (raw.min_pass_rate !== undefined) {
    if (typeof raw.min_pass_rate !== "number" || raw.min_pass_rate < 0 || raw.min_pass_rate > 1) {
      throw new Error("min_pass_rate must be a number between 0 and 1");
    }
    minPassRate = raw.min_pass_rate;
  }

  let maxBudgetUsd: number | undefined;
  if (raw.max_budget_usd !== undefined) {
    if (typeof raw.max_budget_usd !== "number" || raw.max_budget_usd <= 0) {
      throw new Error("max_budget_usd must be a positive number");
    }
    maxBudgetUsd = raw.max_budget_usd;
  }

  let repeats: number | undefined;
  if (raw.repeats !== undefined) {
    if (typeof raw.repeats !== "number" || !Number.isInteger(raw.repeats) || raw.repeats < 1) {
      throw new Error("repeats must be a positive integer");
    }
    repeats = raw.repeats;
  }

  return {
    version: versionStr,
    minPassRate,
    maxBudgetUsd,
    repeats,
  };
}

/**
 * Check if a base config file exists and return its path, or null if not found.
 */
export async function checkBaseConfig(path: string): Promise<string | null> {
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

export function resolveRepeats(
  cli: number | undefined,
  yaml: number | undefined,
): number {
  return cli ?? yaml ?? 3;
}

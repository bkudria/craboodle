import { glob } from "glob";
import { basename, dirname, join } from "node:path";

export interface ScenarioRef {
  id: string;
  dir: string;
  configPath: string;
}

export async function discoverScenarios(
  evalsDir: string,
): Promise<ScenarioRef[]> {
  const matches = await glob("*/scenario.{yaml,yml}", { cwd: evalsDir });

  const scenarios: ScenarioRef[] = matches.map((match) => {
    const configPath = join(evalsDir, match);
    const dir = dirname(configPath);
    const id = basename(dir);
    return { id, dir, configPath };
  });

  scenarios.sort((a, b) => a.id.localeCompare(b.id));

  return scenarios;
}

function matchPattern(id: string, pattern: string): boolean {
  if (!pattern.includes("*")) return id === pattern;
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  return regex.test(id);
}

export function filterScenarios(
  scenarios: ScenarioRef[],
  pattern: string,
): ScenarioRef[] {
  const patterns = pattern.split(",").map((p) => p.trim());
  return scenarios.filter((s) =>
    patterns.some((p) => matchPattern(s.id, p)),
  );
}

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
  const matches = await glob("*/scenario.yml", { cwd: evalsDir });

  const scenarios: ScenarioRef[] = matches.map((match) => {
    const configPath = join(evalsDir, match);
    const dir = dirname(configPath);
    const id = basename(dir);
    return { id, dir, configPath };
  });

  scenarios.sort((a, b) => a.id.localeCompare(b.id));

  return scenarios;
}

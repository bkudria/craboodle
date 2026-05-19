import { glob } from 'glob';
import { basename, dirname, join } from 'node:path';

export interface ScenarioRef {
  id: string;
  dir: string;
  configPath: string;
}

export async function discoverScenarios(
  root: string,
  scenariosPath: string = 'evals',
): Promise<ScenarioRef[]> {
  const matches = await glob(`${scenariosPath}/*/scenario.{yaml,yml}`, { cwd: root });

  const scenarios: ScenarioRef[] = matches.map((match) => {
    const configPath = join(root, match);
    const dir = dirname(configPath);
    const id = basename(dir);
    return { id, dir, configPath };
  });

  scenarios.sort((a, b) => a.id.localeCompare(b.id));

  return scenarios;
}

function matchPattern(id: string, pattern: string): boolean {
  if (!pattern.includes('*')) return id === pattern;
  // Escape regex metacharacters except `*`, then translate `*` to `.*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp('^' + escaped + '$');
  return regex.test(id);
}

export function filterScenarios(scenarios: ScenarioRef[], pattern: string): ScenarioRef[] {
  const patterns = pattern.split(',').map((p) => p.trim());
  return scenarios.filter((s) => patterns.some((p) => matchPattern(s.id, p)));
}

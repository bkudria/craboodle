import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  enumeratePluginComponents,
  loadPluginManifest,
  type PluginComponents,
  type PluginManifest,
} from './plugin.js';

export type EvalsRootMode = 'skill' | 'plugin' | 'generic';

export interface PluginInfo {
  manifest: PluginManifest;
  components: PluginComponents;
}

export interface EvalsConfig {
  version: string;
  minPassRate?: number;
  maxBudgetUsd?: number;
  maxErrorRate?: number;
  repeats?: number;
  artifactRetentionDays?: number;
  timeout?: number;
  scenariosPath: string;
  scenariosBase: Record<string, unknown>;
  mode: EvalsRootMode;
  plugin?: PluginInfo;
}

const SUPPORTED_VERSIONS = ['1'];
const KNOWN_TOP_LEVEL_KEYS = [
  'version',
  'min_pass_rate',
  'max_budget_usd',
  'max_error_rate',
  'repeats',
  'artifact_retention_days',
  'timeout',
  'scenarios',
];
const KNOWN_SCENARIOS_KEYS = ['path', 'base'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateVersion(raw: unknown): string {
  if (raw === undefined) {
    throw new Error(
      `evals.yaml missing required "version" field (supported: ${SUPPORTED_VERSIONS.join(', ')})`,
    );
  }
  const v = String(raw);
  if (!SUPPORTED_VERSIONS.includes(v)) {
    throw new Error(
      `Unsupported eval format version: ${v} (supported: ${SUPPORTED_VERSIONS.join(', ')})`,
    );
  }
  return v;
}

function validateMinPassRate(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || raw < 0 || raw > 1) {
    throw new Error('min_pass_rate must be a number between 0 and 1');
  }
  return raw;
}

function validateMaxBudgetUsd(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || raw <= 0) {
    throw new Error('max_budget_usd must be a positive number');
  }
  return raw;
}

function validateMaxErrorRate(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || raw < 0 || raw > 1) {
    throw new Error('max_error_rate must be a number between 0 and 1');
  }
  return raw;
}

function validateRepeats(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new Error('repeats must be a positive integer');
  }
  return raw;
}

function validateTimeout(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new Error('timeout must be a positive integer');
  }
  return raw;
}

function validateArtifactRetentionDays(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new Error('artifact_retention_days must be a non-negative integer (0 disables cleanup)');
  }
  return raw;
}

function detectMode(root: string): Promise<EvalsRootMode> {
  // Plugin marker wins (more specific). Probe in order: plugin → skill → generic.
  return (async () => {
    if (await fileExists(join(root, '.claude-plugin', 'plugin.json'))) return 'plugin';
    if (await fileExists(join(root, 'SKILL.md'))) return 'skill';
    return 'generic';
  })();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadEvalsConfig(root: string): Promise<EvalsConfig> {
  const configPath = join(root, 'evals.yaml');
  let raw: Record<string, unknown>;
  try {
    const content = await readFile(configPath, 'utf8');
    const parsed = parse(content);
    if (parsed !== null && parsed !== undefined && !isPlainObject(parsed)) {
      throw new Error(`evals.yaml must be a YAML mapping at the top level`);
    }
    raw = (parsed as Record<string, unknown> | null) ?? {};
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      const wrapped = new Error(`evals.yaml not found at ${configPath}`, {
        cause: err,
      }) as Error & { code?: string };
      wrapped.code = 'EVALS_CONFIG_NOT_FOUND';
      throw wrapped;
    }
    throw err;
  }

  const unknownTop = Object.keys(raw).filter((k) => !KNOWN_TOP_LEVEL_KEYS.includes(k));
  if (unknownTop.length > 0) {
    throw new Error(
      `evals.yaml has unknown key(s): ${unknownTop.join(', ')} (supported: ${KNOWN_TOP_LEVEL_KEYS.join(', ')})`,
    );
  }

  const version = validateVersion(raw.version);
  const minPassRate = validateMinPassRate(raw.min_pass_rate);
  const maxBudgetUsd = validateMaxBudgetUsd(raw.max_budget_usd);
  const maxErrorRate = validateMaxErrorRate(raw.max_error_rate);
  if (maxErrorRate !== undefined && minPassRate === undefined) {
    process.stderr.write(
      '[craboodle] WARNING: max_error_rate is set but min_pass_rate is not. The error-rate ' +
        'gate only applies when min_pass_rate gates the run, so max_error_rate has no effect.\n',
    );
  }
  const repeats = validateRepeats(raw.repeats);
  const artifactRetentionDays = validateArtifactRetentionDays(raw.artifact_retention_days);
  const timeout = validateTimeout(raw.timeout);

  if (raw.scenarios === undefined) {
    throw new Error('evals.yaml missing required "scenarios" block');
  }
  if (!isPlainObject(raw.scenarios)) {
    throw new Error('evals.yaml "scenarios" must be a mapping');
  }
  const scenarios = raw.scenarios;

  const unknownScenarios = Object.keys(scenarios).filter((k) => !KNOWN_SCENARIOS_KEYS.includes(k));
  if (unknownScenarios.length > 0) {
    throw new Error(
      `evals.yaml "scenarios" has unknown key(s): ${unknownScenarios.join(', ')} (supported: ${KNOWN_SCENARIOS_KEYS.join(', ')})`,
    );
  }

  if (scenarios.base === undefined) {
    throw new Error('evals.yaml missing required "scenarios.base" block');
  }
  if (!isPlainObject(scenarios.base)) {
    throw new Error('evals.yaml "scenarios.base" must be a mapping');
  }
  const scenariosBase = scenarios.base;

  let scenariosPath = 'evals';
  if (scenarios.path !== undefined) {
    if (typeof scenarios.path !== 'string' || scenarios.path.length === 0) {
      throw new Error('evals.yaml "scenarios.path" must be a non-empty string');
    }
    if (
      scenarios.path.includes('/') ||
      scenarios.path.includes('\\') ||
      scenarios.path === '.' ||
      scenarios.path === '..'
    ) {
      throw new Error(
        `evals.yaml "scenarios.path" must be a single directory name (no path separators, no '.' or '..'), got: ${scenarios.path}`,
      );
    }
    scenariosPath = scenarios.path;
  }

  const mode = await detectMode(root);

  let plugin: PluginInfo | undefined;
  if (mode === 'plugin') {
    const [manifest, components] = await Promise.all([
      loadPluginManifest(root),
      enumeratePluginComponents(root),
    ]);
    plugin = { manifest, components };
  }

  return {
    version,
    minPassRate,
    maxBudgetUsd,
    maxErrorRate,
    repeats,
    artifactRetentionDays,
    timeout,
    scenariosPath,
    scenariosBase,
    mode,
    plugin,
  };
}

export const DEFAULT_REPEATS = 3;

export function resolveRepeats(cli: number | undefined, yaml: number | undefined): number {
  return cli ?? yaml ?? DEFAULT_REPEATS;
}

export function resolveRepeatsFromRawFlag(
  rawFlag: string | undefined,
  yaml: number | undefined,
): number {
  if (rawFlag === undefined) return resolveRepeats(undefined, yaml);
  const parsed = parseInt(rawFlag, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== rawFlag) {
    throw new Error(`--repeats must be a positive integer, got: ${rawFlag}`);
  }
  return resolveRepeats(parsed, yaml);
}

export function resolveTimeout(
  cli: number | undefined,
  yaml: number | undefined,
): number | undefined {
  return cli ?? yaml;
}

export function parseTimeoutFlag(rawFlag: string | undefined): number | undefined {
  if (rawFlag === undefined) return undefined;
  const parsed = parseInt(rawFlag, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== rawFlag) {
    throw new Error(`--timeout must be a positive integer, got: ${rawFlag}`);
  }
  return parsed;
}

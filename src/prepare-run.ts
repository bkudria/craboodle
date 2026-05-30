import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { stringify } from 'yaml';
import { loadEvalsConfig, resolveTimeout, type PluginInfo } from './config.js';
import { discoverScenarios, type ScenarioRef } from './discovery.js';
import { stageEvalsRoot } from './staged-view.js';

export interface PrepareRunOptions {
  /** Per-invocation timeout override (seconds). Wins over evals.yaml's top-level timeout. */
  cliTimeout?: number;
}

export interface PreparedRun {
  scenarios: ScenarioRef[];
  /** Path of the materialised base config file passed to scuttlerun. */
  basePath: string;
  /** Staged dir whose basename matches the original root. */
  stagedRoot: string;
  /** mkdtemp parent of the staged dir — pass to cleanupStagedView. */
  parent: string;
  pipeline: {
    version: string;
    minPassRate?: number;
    maxBudgetUsd?: number;
    maxErrorRate?: number;
    repeats?: number;
    artifactRetentionDays?: number;
    timeout?: number;
  };
  /** Parsed manifest + enumerated components; present iff plugin mode. */
  plugin?: PluginInfo;
}

/**
 * Stage a filtered view of `root`, materialise the scuttlerun base config inside
 * the staged dir with skill paths rewritten to point at the staged tree, and
 * discover scenarios from the original root.
 *
 * Caller is responsible for invoking scuttlerun with the returned `basePath`.
 * The staged dir is kept on disk so the user can inspect it; cleanup is by
 * `cleanupStagedView(parent)` or by the eventual `cleanOldArtifacts` sweep.
 */
export async function prepareRun(root: string, options?: PrepareRunOptions): Promise<PreparedRun> {
  const resolvedRoot = resolve(root);
  const config = await loadEvalsConfig(resolvedRoot);

  const { stagedRoot, parent } = await stageEvalsRoot(resolvedRoot, config.scenariosPath);

  // Orchestrator-level timeout (CLI > evals.yaml top-level) overrides any
  // scenarios.base.timeout. When neither is set, scenarios.base.timeout (or
  // scuttlerun's own default) applies.
  const resolvedTimeout = resolveTimeout(options?.cliTimeout, config.timeout);
  const rewrittenBase = rewriteSkillPaths(config.scenariosBase, resolvedRoot, stagedRoot);
  const finalBase =
    resolvedTimeout !== undefined ? { ...rewrittenBase, timeout: resolvedTimeout } : rewrittenBase;
  const basePath = join(stagedRoot, '.craboodle-base.yaml');
  await writeFile(basePath, stringify(finalBase));

  const scenarios = await discoverScenarios(resolvedRoot, config.scenariosPath);

  return {
    scenarios,
    basePath,
    stagedRoot,
    parent,
    pipeline: {
      version: config.version,
      minPassRate: config.minPassRate,
      maxBudgetUsd: config.maxBudgetUsd,
      maxErrorRate: config.maxErrorRate,
      repeats: config.repeats,
      artifactRetentionDays: config.artifactRetentionDays,
      ...(resolvedTimeout !== undefined ? { timeout: resolvedTimeout } : {}),
    },
    ...(config.plugin ? { plugin: config.plugin } : {}),
  };
}

/**
 * Walk `base` looking for `project.skills`. Rewrite each entry so paths that
 * point into the original root become paths into the staged dir; other paths
 * (~, absolute-out-of-root) pass through unchanged.
 */
function rewriteSkillPaths(
  base: Record<string, unknown>,
  originalRoot: string,
  stagedRoot: string,
): Record<string, unknown> {
  // Shallow clone — only the `project.skills` array is rewritten; everything
  // else is shared. Callers should not mutate the result.
  if (!isPlainObject(base.project)) return base;
  const skills = (base.project as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) return base;

  const rewritten = skills.map((entry) =>
    typeof entry === 'string' ? rewriteSkillEntry(entry, originalRoot, stagedRoot) : entry,
  );

  return {
    ...base,
    project: { ...(base.project as Record<string, unknown>), skills: rewritten },
  };
}

function rewriteSkillEntry(entry: string, originalRoot: string, stagedRoot: string): string {
  if (entry.startsWith('~')) return entry;
  if (!isAbsolute(entry)) {
    // Relative paths resolve against the original root, then become absolute
    // inside the staged tree.
    const relative = entry === '.' ? '' : entry;
    return relative === '' ? stagedRoot : join(stagedRoot, relative);
  }
  const normalised = resolve(entry);
  if (normalised === originalRoot) return stagedRoot;
  if (normalised.startsWith(originalRoot + sep)) {
    return stagedRoot + normalised.substring(originalRoot.length);
  }
  return entry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

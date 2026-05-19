import { mkdtemp, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export interface StagedView {
  /** Path to the directory whose basename matches the source root's basename.
   * Hand this to scuttlerun as the configDir-bearing path. */
  stagedRoot: string;
  /** Parent mkdtemp dir; pass to {@link cleanupStagedView} to GC. */
  parent: string;
}

/**
 * Build a filtered view of `root` inside a fresh tempdir, excluding
 * `scenariosPath` from the top level. Every other direct child of `root`
 * (dotfiles included, per design) is reachable as a symlink from the staged
 * dir, whose basename matches `basename(resolve(root))` so scuttlerun's
 * skill-dir-naming convention is preserved.
 */
export async function stageEvalsRoot(root: string, scenariosPath: string): Promise<StagedView> {
  const absoluteRoot = resolve(root);
  const parent = await mkdtemp(join(tmpdir(), 'craboodle-staged-'));
  const stagedRoot = join(parent, basename(absoluteRoot));
  await mkdir(stagedRoot);

  const entries = await readdir(absoluteRoot);
  for (const name of entries) {
    if (name === scenariosPath) continue;
    await symlink(join(absoluteRoot, name), join(stagedRoot, name));
  }

  return { stagedRoot, parent };
}

/** Best-effort removal of the staged tempdir tree. Safe to call when absent. */
export async function cleanupStagedView(parent: string): Promise<void> {
  await rm(parent, { recursive: true, force: true });
}

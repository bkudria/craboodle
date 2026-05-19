import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

describe('staged-view', () => {
  let sourceRoot: string;
  let stagedParents: string[];

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'craboodle-staged-view-test-source-'));
    stagedParents = [];
  });

  afterEach(async () => {
    for (const p of stagedParents) {
      await rm(p, { recursive: true, force: true });
    }
    await rm(sourceRoot, { recursive: true, force: true });
  });

  async function track<T extends { parent: string }>(p: Promise<T>): Promise<T> {
    const result = await p;
    stagedParents.push(result.parent);
    return result;
  }

  describe('stageEvalsRoot', () => {
    it('returns a staged dir under craboodle-staged-* with basename preserved', async () => {
      // Build a source root with a stable, non-temp-y basename
      const sourceParent = await mkdtemp(join(tmpdir(), 'craboodle-staged-view-test-parent-'));
      try {
        const namedRoot = join(sourceParent, 'my-cool-skill');
        await mkdir(namedRoot);
        await writeFile(join(namedRoot, 'SKILL.md'), '---\nname: x\n---\n# X\n');

        const { stageEvalsRoot } = await import('../src/staged-view.js');
        const { stagedRoot, parent } = await track(stageEvalsRoot(namedRoot, 'evals'));

        // Parent is under tmpdir with the craboodle-staged- prefix
        expect(dirname(parent)).toBe(tmpdir());
        expect(basename(parent)).toMatch(/^craboodle-staged-/);

        // Staged root sits inside parent with the SAME basename as the original
        expect(dirname(stagedRoot)).toBe(parent);
        expect(basename(stagedRoot)).toBe('my-cool-skill');
      } finally {
        await rm(sourceParent, { recursive: true, force: true });
      }
    });

    it('symlinks every direct child of root except scenariosPath', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# skill\n');
      await mkdir(join(sourceRoot, 'src'));
      await writeFile(join(sourceRoot, 'src', 'index.ts'), 'export {};\n');
      await mkdir(join(sourceRoot, 'evals'));
      await mkdir(join(sourceRoot, 'evals', 'topic-a'));
      await writeFile(join(sourceRoot, 'evals', 'topic-a', 'scenario.yaml'), 'name: a\n');

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const entries = await readdir(stagedRoot);
      expect(entries.sort()).toEqual(['SKILL.md', 'src'].sort());

      const skillStat = await lstat(join(stagedRoot, 'SKILL.md'));
      expect(skillStat.isSymbolicLink()).toBe(true);
      const srcStat = await lstat(join(stagedRoot, 'src'));
      expect(srcStat.isSymbolicLink()).toBe(true);
    });

    it('includes dotfile children (plan: include all dotfiles)', async () => {
      await writeFile(join(sourceRoot, '.env'), 'KEY=value\n');
      await mkdir(join(sourceRoot, '.claude'));
      await writeFile(join(sourceRoot, '.claude', 'settings.json'), '{}');
      await mkdir(join(sourceRoot, '.claude-plugin'));
      await writeFile(join(sourceRoot, '.claude-plugin', 'plugin.json'), '{"name":"x"}');
      await mkdir(join(sourceRoot, 'evals'));

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const entries = await readdir(stagedRoot);
      expect(entries.sort()).toEqual(['.claude', '.claude-plugin', '.env'].sort());
    });

    it('omits the scenariosPath directory from the staged view', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      await mkdir(join(sourceRoot, 'evals'));
      await writeFile(join(sourceRoot, 'evals', 'leak.txt'), 'should-not-leak');

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      await expect(access(join(stagedRoot, 'evals'))).rejects.toThrow();
    });

    it('omits a custom scenariosPath (not just "evals")', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      await mkdir(join(sourceRoot, 'my-scenarios'));
      await mkdir(join(sourceRoot, 'evals'));
      await writeFile(join(sourceRoot, 'evals', 'kept.txt'), 'kept\n');

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'my-scenarios'));

      const entries = await readdir(stagedRoot);
      expect(entries.sort()).toEqual(['SKILL.md', 'evals'].sort()); // evals/ kept since path is my-scenarios
      await expect(access(join(stagedRoot, 'my-scenarios'))).rejects.toThrow();
    });

    it('makes nested files readable through the symlinks', async () => {
      await mkdir(join(sourceRoot, 'src'));
      await mkdir(join(sourceRoot, 'src', 'nested'));
      await writeFile(join(sourceRoot, 'src', 'nested', 'deep.txt'), 'hello-from-source');
      await mkdir(join(sourceRoot, 'evals'));

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const content = await readFile(join(stagedRoot, 'src', 'nested', 'deep.txt'), 'utf8');
      expect(content).toBe('hello-from-source');
    });

    it('uses the absolute path of the source for the symlink target', async () => {
      // If the symlink target is relative, the staged view breaks once we cd into
      // it or scuttlerun resolves it. The implementation must use an absolute target.
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      await mkdir(join(sourceRoot, 'evals'));

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      // readlink returns the literal target string
      const { readlink } = await import('node:fs/promises');
      const target = await readlink(join(stagedRoot, 'SKILL.md'));
      expect(target.startsWith('/')).toBe(true);
      expect(target).toBe(join(sourceRoot, 'SKILL.md'));
    });

    it('handles a root with no children gracefully', async () => {
      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const entries = await readdir(stagedRoot);
      expect(entries).toEqual([]);
    });

    it('handles a root whose only child is scenariosPath', async () => {
      await mkdir(join(sourceRoot, 'evals'));
      await writeFile(join(sourceRoot, 'evals', 'x.yaml'), 'name: x\n');

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const entries = await readdir(stagedRoot);
      expect(entries).toEqual([]);
    });

    it('does not error when scenariosPath does not exist in the source', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      // intentionally no evals/ directory

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const { stagedRoot } = await track(stageEvalsRoot(sourceRoot, 'evals'));

      const entries = await readdir(stagedRoot);
      expect(entries).toEqual(['SKILL.md']);
    });

    it('yields a distinct parent on each invocation (no collisions)', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      await mkdir(join(sourceRoot, 'evals'));

      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const a = await track(stageEvalsRoot(sourceRoot, 'evals'));
      const b = await track(stageEvalsRoot(sourceRoot, 'evals'));

      expect(a.parent).not.toBe(b.parent);
      expect(a.stagedRoot).not.toBe(b.stagedRoot);
      // But both should resolve their inner basename to the source basename
      expect(basename(a.stagedRoot)).toBe(basename(sourceRoot));
      expect(basename(b.stagedRoot)).toBe(basename(sourceRoot));
    });

    it('throws ENOENT-style error when the source root does not exist', async () => {
      const { stageEvalsRoot } = await import('../src/staged-view.js');
      const missing = join(sourceRoot, 'does-not-exist');
      await expect(stageEvalsRoot(missing, 'evals')).rejects.toThrow();
    });
  });

  describe('cleanupStagedView', () => {
    it('removes the staged parent directory', async () => {
      await writeFile(join(sourceRoot, 'SKILL.md'), '# x\n');
      await mkdir(join(sourceRoot, 'evals'));

      const { stageEvalsRoot, cleanupStagedView } = await import('../src/staged-view.js');
      const { parent } = await stageEvalsRoot(sourceRoot, 'evals');

      await access(parent); // exists before cleanup
      await cleanupStagedView(parent);
      await expect(access(parent)).rejects.toThrow();
    });

    it('does not throw when the staged dir is already gone', async () => {
      const { cleanupStagedView } = await import('../src/staged-view.js');
      const fake = join(tmpdir(), 'craboodle-staged-does-not-exist-xyz');
      await expect(cleanupStagedView(fake)).resolves.toBeUndefined();
    });
  });
});

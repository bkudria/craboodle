import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, stat, symlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';

describe('cleanOldArtifacts', () => {
  // cleanOldArtifacts sweeps $TMPDIR, so each test gets a private one: no
  // other process's dirs are swept, and the counts are exact.
  const originalTmpdir = process.env.TMPDIR;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-cleanup-test-'));
    process.env.TMPDIR = tmpDir;
  });

  afterEach(async () => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    await rm(tmpDir, { recursive: true });
  });

  async function createOldDir(name: string, daysOld: number): Promise<string> {
    const dirPath = join(tmpDir, name);
    await mkdir(dirPath, { recursive: true });
    const pastTime = new Date(Date.now() - daysOld * 86_400_000);
    await utimes(dirPath, pastTime, pastTime);
    return dirPath;
  }

  async function createFreshDir(name: string): Promise<string> {
    const dirPath = join(tmpDir, name);
    await mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  it('removes craboodle-run dirs older than threshold', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const oldDir = await createOldDir('craboodle-run-test-old-' + Date.now(), 10);

    try {
      const cleaned = await cleanOldArtifacts(7);
      expect(cleaned).toBe(1);
      await expect(stat(oldDir)).rejects.toThrow();
    } finally {
      await rm(oldDir, { recursive: true }).catch(() => {});
    }
  });

  it('preserves craboodle-run dirs newer than threshold', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const freshDir = await createFreshDir('craboodle-run-test-fresh-' + Date.now());

    try {
      await cleanOldArtifacts(7);
      const info = await stat(freshDir);
      expect(info.isDirectory()).toBe(true);
    } finally {
      await rm(freshDir, { recursive: true }).catch(() => {});
    }
  });

  it('does not touch non-craboodle dirs', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const otherDir = await createOldDir('other-tool-test-' + Date.now(), 10);

    try {
      await cleanOldArtifacts(7);
      const info = await stat(otherDir);
      expect(info.isDirectory()).toBe(true);
    } finally {
      await rm(otherDir, { recursive: true }).catch(() => {});
    }
  });

  it('returns 0 when nothing to clean', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    // Just run with no old dirs — should return 0 or a small number
    const cleaned = await cleanOldArtifacts(9999);
    expect(cleaned).toBe(0);
  });

  it('skips cleanup entirely when maxAgeDays is 0 (disabled)', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const oldDir = await createOldDir('craboodle-run-test-disabled-' + Date.now(), 100);

    try {
      const cleaned = await cleanOldArtifacts(0);
      expect(cleaned).toBe(0);
      const info = await stat(oldDir);
      expect(info.isDirectory()).toBe(true);
    } finally {
      await rm(oldDir, { recursive: true }).catch(() => {});
    }
  });

  it('removes craboodle-staged dirs older than threshold', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const oldDir = await createOldDir('craboodle-staged-test-old-' + Date.now(), 10);

    try {
      const cleaned = await cleanOldArtifacts(7);
      expect(cleaned).toBe(1);
      await expect(stat(oldDir)).rejects.toThrow();
    } finally {
      await rm(oldDir, { recursive: true }).catch(() => {});
    }
  });

  it('preserves craboodle-staged dirs newer than threshold', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const freshDir = await createFreshDir('craboodle-staged-test-fresh-' + Date.now());

    try {
      await cleanOldArtifacts(7);
      const info = await stat(freshDir);
      expect(info.isDirectory()).toBe(true);
    } finally {
      await rm(freshDir, { recursive: true }).catch(() => {});
    }
  });

  it('logs to stderr when verbose and dirs were cleaned', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const oldDir = await createOldDir('craboodle-run-test-verbose-' + Date.now(), 10);

    let stderrOutput = '';
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
      });

    try {
      const cleaned = await cleanOldArtifacts(7, { verbose: true });
      expect(cleaned).toBe(1);
      expect(stderrOutput).toContain('Cleaned');
    } finally {
      spy.mockRestore();
      await rm(oldDir, { recursive: true }).catch(() => {});
    }
  });
});

describe('cleanOldArtifacts error handling', () => {
  it('handles stat errors on individual directories', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const orig = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...orig,
        readdir: vi
          .fn()
          .mockResolvedValue([{ isDirectory: () => true, name: 'craboodle-run-mock-stat-error' }]),
        stat: vi.fn().mockRejectedValue(new Error('EPERM')),
      };
    });

    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const cleaned = await cleanOldArtifacts(7);
    expect(cleaned).toBe(0);

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('handles readdir errors gracefully', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const orig = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...orig,
        readdir: vi.fn().mockRejectedValue(new Error('EACCES')),
      };
    });

    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const cleaned = await cleanOldArtifacts(7);
    expect(cleaned).toBe(0);

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});

describe('cleanOldArtifacts keep', () => {
  // TMPDIR is a symlink to a real dir, so each kept path can be named either
  // through the link (as the sweep lists it) or by its real path.
  const originalTmpdir = process.env.TMPDIR;
  let realDir: string;
  let linkDir: string;

  beforeEach(async () => {
    realDir = await mkdtemp(join(tmpdir(), 'craboodle-cleanup-keep-test-'));
    linkDir = `${realDir}-link`;
    await symlink(realDir, linkDir);
    process.env.TMPDIR = linkDir;
  });

  afterEach(async () => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    await rm(linkDir);
    await rm(realDir, { recursive: true });
  });

  async function createOldRunDir(name: string): Promise<string> {
    const dirPath = join(linkDir, name);
    await mkdir(dirPath);
    const past = new Date(Date.now() - 30 * 86_400_000);
    await utimes(dirPath, past, past);
    return dirPath;
  }

  it.each([
    ['its real path', () => join(realDir, 'craboodle-run-kept')],
    ['the path the sweep lists', () => join(linkDir, 'craboodle-run-kept')],
  ])('keeps an old dir named by %s and still removes the others', async (_form, keptPath) => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const kept = await createOldRunDir('craboodle-run-kept');
    const other = await createOldRunDir('craboodle-run-other');

    const cleaned = await cleanOldArtifacts(7, { keep: [keptPath()] });

    expect(cleaned).toBe(1);
    expect((await stat(kept)).isDirectory()).toBe(true);
    await expect(stat(other)).rejects.toThrow();
  });

  it('ignores a keep path that does not exist', async () => {
    const { cleanOldArtifacts } = await import('../src/cleanup.js');
    const other = await createOldRunDir('craboodle-run-other');

    const cleaned = await cleanOldArtifacts(7, { keep: [join(realDir, 'missing')] });

    expect(cleaned).toBe(1);
    await expect(stat(other)).rejects.toThrow();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

describe('cleanOldArtifacts', () => {
  let tmpDir: string;
  // We test in the real tmpdir since that's where cleanOldArtifacts looks

  beforeEach(async () => {
    tmpDir = tmpdir();
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
      expect(cleaned).toBeGreaterThanOrEqual(1);
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
      expect(cleaned).toBeGreaterThanOrEqual(1);
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
      expect(cleaned).toBeGreaterThanOrEqual(1);
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

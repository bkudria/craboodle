import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'yaml';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

async function runWithRestrictedPath(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

async function runAndGetExit(args: string[]): Promise<number> {
  try {
    await execFileAsync('craboodle', args);
    return 0;
  } catch (err) {
    const e = err as { code?: number };
    if (typeof e.code !== 'number') throw err;
    return e.code;
  }
}

async function runAndCapture(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync('craboodle', args);
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : -1, stderr: e.stderr ?? '' };
  }
}

async function runAndCaptureAll(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('craboodle', args);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

describe('cli exit codes (unified taxonomy)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-exit-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe('code 4 — infrastructure/dependency error', () => {
    it('run: exits 4 when no scenarios in evals dir', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      const { code, stderr } = await runAndCapture(['run', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('No scenarios found');
      expect(stderr).toContain('craboodle init');
      expect(stderr).toContain('craboodle --help');
    });

    it('run: exits 4 when --scenario filter matches nothing', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['run', '--scenario', 'nomatch', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('craboodle list');
    });

    it('list: exits 4 when no scenarios in evals dir', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      const { code, stderr } = await runAndCapture(['list', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('craboodle init');
    });

    it('list: exits 4 when --scenario filter matches nothing', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['list', '--scenario', 'nomatch', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('craboodle list');
    });

    it('lint: exits 4 when no scenarios in evals dir', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      const { code, stderr } = await runAndCapture(['lint', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('craboodle init');
    });

    it('lint: exits 4 when --scenario filter matches nothing', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['lint', '--scenario', 'nomatch', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('craboodle list');
    });

    it('run: exits 4 when all reps fail due to scuttlerun config errors', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await writeFile(
        join(tmpDir, 'base.yaml'),
        stringify({ project: { skills: ['/nonexistent/skill-path-for-test'] } }),
      );
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const code = await runAndGetExit(['run', '--repeats', '1', tmpDir]);
      expect(code).toBe(4);
    });

    it('lint: exits 4 when all pincenez lint invocations fail', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      // Invalid checks.yaml structure — pincenez lint rejects it at load time (exit 1)
      await writeFile(join(tmpDir, 'alpha', 'checks.yaml'), 'not_a_checks_file: true\n');
      const code = await runAndGetExit(['lint', tmpDir]);
      expect(code).toBe(4);
    });

    it('run: exits 4 with a friendly message when scuttlerun is not on PATH', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runWithRestrictedPath(['run', '--repeats', '1', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('scuttlerun');
      expect(stderr).toContain('not found');
    });

    it('list: exits 4 with a friendly message when scuttlerun is not on PATH', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runWithRestrictedPath(['list', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('scuttlerun');
      expect(stderr).toContain('not found');
    });

    it('lint: exits 4 with a friendly message when pincenez is not on PATH', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runWithRestrictedPath(['lint', tmpDir]);
      expect(code).toBe(4);
      expect(stderr).toContain('pincenez');
      expect(stderr).toContain('not found');
    });
  });

  describe('lint scenarios_total reflects successful invocations only', () => {
    it('lint: scenarios_total is 0 when all pincenez invocations fail', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      // Two scenarios, both with invalid checks.yaml — pincenez lint rejects each
      for (const id of ['alpha', 'beta']) {
        await mkdir(join(tmpDir, id));
        await writeFile(join(tmpDir, id, 'scenario.yaml'), stringify({ prompt: 'a\n' }));
        await writeFile(join(tmpDir, id, 'checks.yaml'), 'not_a_checks_file: true\n');
      }
      const { stdout } = await runAndCaptureAll(['lint', tmpDir]);
      // Per spec craboodle.allium:255, scenarios_total = lint_results.count
      // (successful invocations), not selected_scenarios.count.
      expect(stdout).toContain('scenarios_total: 0');
      expect(stdout).not.toContain('scenarios_total: 2');
    });
  });

  describe('--concurrency validation', () => {
    it('run: rejects --concurrency 0 with exit 1 and a clean message', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['run', '--concurrency', '0', tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('--concurrency');
      expect(stderr).toContain('positive integer');
    });

    it('run: rejects --concurrency -5 with exit 1', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['run', '--concurrency', '-5', tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('--concurrency');
    });

    it('run: rejects --concurrency abc with exit 1', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['run', '--concurrency', 'abc', tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('--concurrency');
    });

    it('lint: rejects --concurrency 0 with exit 1', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['lint', '--concurrency', '0', tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('--concurrency');
    });
  });

  describe('code 2 — config-load error', () => {
    it('list: exits 2 when craboodle.yaml has unknown keys', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), 'version: "1"\nbogus_key: 1\n');
      await mkdir(join(tmpDir, 'alpha'));
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
      await writeFile(
        join(tmpDir, 'alpha', 'checks.yaml'),
        stringify({
          context: 'alpha context',
          checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
        }),
      );
      const { code, stderr } = await runAndCapture(['list', tmpDir]);
      expect(code).toBe(2);
      expect(stderr).toContain('unknown key');
    });
  });

  describe('lint missing-prompt warning', () => {
    it('lint: warns to stderr when scenario.yaml has no prompt field', async () => {
      await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
      await mkdir(join(tmpDir, 'alpha'));
      // scenario.yaml present but no `prompt` field — degrades pincenez tautology detection
      await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({}));
      // Invalid checks.yaml so pincenez bails fast without calling a model;
      // we only care that the warning fires before pincenez is invoked.
      await writeFile(join(tmpDir, 'alpha', 'checks.yaml'), 'not_a_checks_file: true\n');
      const { stderr } = await runAndCapture(['lint', tmpDir]);
      expect(stderr).toContain('alpha');
      expect(stderr).toContain('no prompt');
    });
  });
});

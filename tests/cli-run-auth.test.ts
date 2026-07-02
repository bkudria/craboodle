import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'yaml';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const GRADING_YAML =
  'checks:\n  - id: check-a\n    check: "alpha check"\n    pass: true\n    evidence: "ok"\npass_rate: 1.0\n';

const LINT_YAML = 'checks:\n  - id: check-a\n    check: "alpha check"\n    issues: []\n';

async function runAndCapture(
  args: string[],
  extraEnv: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : -1, stderr: e.stderr ?? '' };
  }
}

function invocations(argsFileContent: string): string[][] {
  return argsFileContent
    .split('===\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => block.split('\n'));
}

function authValueOf(args: string[]): string | undefined {
  const i = args.indexOf('--auth');
  return i >= 0 ? args[i + 1] : undefined;
}

describe('cli auth plumbing', () => {
  let tmpDir: string;
  let scuttlerunArgsFile: string;
  let pincenezArgsFile: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-run-auth');
    scuttlerunArgsFile = join(tmpDir, 'scuttlerun-args.txt');
    pincenezArgsFile = join(tmpDir, 'pincenez-args.txt');

    await mkdir(join(tmpDir, 'evals', 'alpha'), { recursive: true });
    await writeFile(join(tmpDir, 'evals', 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
    await writeFile(
      join(tmpDir, 'evals', 'alpha', 'checks.yaml'),
      stringify({ checks: [{ 'check-a': { check: 'alpha check' } }] }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function writeEvals(top: Record<string, unknown> = {}) {
    await writeFile(
      join(tmpDir, 'evals.yaml'),
      stringify({ version: '1', scenarios: { base: {} }, ...top }),
    );
  }

  it('forwards --auth from the run flag to both scuttlerun and pincenez', async () => {
    await writeEvals();
    const { code } = await runAndCapture(
      ['run', '--repeats', '1', '--auth', 'subscription', tmpDir],
      {
        CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgsFile,
        CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
        CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
      },
    );
    expect(code).toBe(0);

    const scuttlerunRuns = invocations(await readFile(scuttlerunArgsFile, 'utf8')).filter(
      (args) => !args.includes('--dry-run'),
    );
    expect(scuttlerunRuns.length).toBeGreaterThan(0);
    for (const args of scuttlerunRuns) {
      expect(authValueOf(args)).toBe('subscription');
    }

    for (const args of invocations(await readFile(pincenezArgsFile, 'utf8'))) {
      expect(authValueOf(args)).toBe('subscription');
    }
  });

  it('forwards auth from evals.yaml when no flag is given', async () => {
    await writeEvals({ auth: 'api-key' });
    const { code } = await runAndCapture(['run', '--repeats', '1', tmpDir], {
      CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgsFile,
      CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
      CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
    });
    expect(code).toBe(0);

    const scuttlerunRuns = invocations(await readFile(scuttlerunArgsFile, 'utf8')).filter(
      (args) => !args.includes('--dry-run'),
    );
    for (const args of scuttlerunRuns) {
      expect(authValueOf(args)).toBe('api-key');
    }
    for (const args of invocations(await readFile(pincenezArgsFile, 'utf8'))) {
      expect(authValueOf(args)).toBe('api-key');
    }
  });

  it('lets the --auth flag override evals.yaml', async () => {
    await writeEvals({ auth: 'api-key' });
    const { code } = await runAndCapture(
      ['run', '--repeats', '1', '--auth', 'subscription', tmpDir],
      {
        CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgsFile,
        CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
      },
    );
    expect(code).toBe(0);

    const scuttlerunRuns = invocations(await readFile(scuttlerunArgsFile, 'utf8')).filter(
      (args) => !args.includes('--dry-run'),
    );
    for (const args of scuttlerunRuns) {
      expect(authValueOf(args)).toBe('subscription');
    }
  });

  it('omits --auth entirely when neither flag nor evals.yaml sets it', async () => {
    await writeEvals();
    const { code } = await runAndCapture(['run', '--repeats', '1', tmpDir], {
      CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgsFile,
      CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
      CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
    });
    expect(code).toBe(0);

    expect(await readFile(scuttlerunArgsFile, 'utf8')).not.toContain('--auth');
    expect(await readFile(pincenezArgsFile, 'utf8')).not.toContain('--auth');
  });

  it('rejects an invalid --auth value with exit 1 and a clean message', async () => {
    await writeEvals();
    const { code, stderr } = await runAndCapture(
      ['run', '--repeats', '1', '--auth', 'bogus', tmpDir],
      {},
    );
    expect(code).toBe(1);
    expect(stderr).toContain('auto, subscription, or api-key');
  });

  it('rejects an invalid evals.yaml auth value with exit 2', async () => {
    await writeEvals({ auth: 'bogus' });
    const { code, stderr } = await runAndCapture(['run', '--repeats', '1', tmpDir], {});
    expect(code).toBe(2);
    expect(stderr).toContain('auth must be one of: auto, subscription, api-key');
  });

  it('forwards --auth to pincenez lint', async () => {
    await writeEvals();
    const { code } = await runAndCapture(['lint', '--auth', 'subscription', tmpDir], {
      CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
      CRABOODLE_STUB_PINCENEZ_STDOUT: LINT_YAML,
    });
    expect(code).toBe(0);

    const lintRuns = invocations(await readFile(pincenezArgsFile, 'utf8'));
    expect(lintRuns.length).toBeGreaterThan(0);
    for (const args of lintRuns) {
      expect(args[0]).toBe('lint');
      expect(authValueOf(args)).toBe('subscription');
    }
  });
});

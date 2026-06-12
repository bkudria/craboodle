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

describe('run grading grounding', () => {
  let tmpDir: string;
  let scuttlerunArgsFile: string;
  let pincenezArgsFile: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('run-grounding');
    scuttlerunArgsFile = join(tmpDir, 'scuttlerun-args.txt');
    pincenezArgsFile = join(tmpDir, 'pincenez-args.txt');

    await writeFile(
      join(tmpDir, 'evals.yaml'),
      stringify({ version: '1', scenarios: { base: {} } }),
    );
    await mkdir(join(tmpDir, 'evals', 'alpha'), { recursive: true });
    await writeFile(
      join(tmpDir, 'evals', 'alpha', 'scenario.yaml'),
      stringify({ prompt: 'Write a haiku about crabs' }),
    );
    await writeFile(
      join(tmpDir, 'evals', 'alpha', 'checks.yaml'),
      stringify({
        context: 'authored context',
        checks: [{ 'check-a': { check: 'alpha check' } }],
      }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('passes the resolved scenario prompt as --context to every grading invocation, resolving once per scenario', async () => {
    const { code } = await runAndCapture(['run', '--repeats', '2', '--concurrency', '1', tmpDir], {
      CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgsFile,
      CRABOODLE_STUB_SCUTTLERUN_DRYRUN_STDOUT: 'prompt: Write a haiku about crabs\n',
      CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
      CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
    });
    expect(code).toBe(0);

    const scuttlerunArgs = await readFile(scuttlerunArgsFile, 'utf8');
    const dryRunCount = scuttlerunArgs.split('\n').filter((line) => line === '--dry-run').length;
    expect(dryRunCount).toBe(1);

    const pincenezInvocations = (await readFile(pincenezArgsFile, 'utf8'))
      .split('===\n')
      .filter((block) => block.trim().length > 0)
      .map((block) => block.split('\n'));
    expect(pincenezInvocations).toHaveLength(2);
    for (const args of pincenezInvocations) {
      const contextIndex = args.indexOf('--context');
      expect(contextIndex).toBeGreaterThanOrEqual(0);
      expect(args[contextIndex + 1]).toBe('Write a haiku about crabs');
    }
  });

  it('warns and grades without --context when prompt resolution fails', async () => {
    const { code, stderr } = await runAndCapture(['run', '--repeats', '1', tmpDir], {
      CRABOODLE_STUB_SCUTTLERUN_DRYRUN_EXIT: '1',
      CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgsFile,
      CRABOODLE_STUB_PINCENEZ_STDOUT: GRADING_YAML,
    });
    expect(code).toBe(0);
    expect(stderr).toContain('could not resolve scenario config');
    expect(stderr).toContain('grading grounding degraded');

    const pincenezArgs = await readFile(pincenezArgsFile, 'utf8');
    expect(pincenezArgs).not.toContain('--context');
  });
});

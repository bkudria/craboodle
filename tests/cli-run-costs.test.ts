import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

type ExtraEnv = Record<string, string>;

async function runAndCaptureAll(
  args: string[],
  extraEnv?: ExtraEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
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

describe('cli run cost accounting', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-run-costs');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function writeEvals(content: unknown = { version: '1', scenarios: { base: {} } }) {
    await writeFile(join(tmpDir, 'evals.yaml'), stringify(content));
  }

  async function writeAlpha() {
    await mkdir(join(tmpDir, 'evals', 'alpha'), { recursive: true });
    await writeFile(join(tmpDir, 'evals', 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
    await writeFile(
      join(tmpDir, 'evals', 'alpha', 'checks.yaml'),
      stringify({
        context: 'alpha context',
        checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
      }),
    );
  }

  it('counts a failed rep’s agent cost in scenario costs, its errors entry, and the run total', async () => {
    await writeEvals();
    await writeAlpha();

    const { stdout } = await runAndCaptureAll(['run', '--repeats', '1', tmpDir], {
      CRABOODLE_STUB_SCUTTLERUN_STDOUT: 'cost_usd: 0.5\n',
      CRABOODLE_STUB_PINCENEZ_EXIT: '1',
    });

    const doc = parse(stdout);
    expect(doc.result).toBe('no_successful_reps');
    const alpha = doc.scenarios[0].alpha;
    expect(alpha.agent_cost_usd).toBe(0.5);
    expect(alpha.cost_usd).toBe(0.5);
    expect(alpha.errors[0].agent_cost_usd).toBe(0.5);
    expect(doc.total_cost_usd).toBe(0.5);
  });
});

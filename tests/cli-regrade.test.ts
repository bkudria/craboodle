import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { makeTmpDir } from './_fixtures.js';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const PROMPT = 'Write a haiku about crabs';

function grading(opts: { pass?: boolean; costUsd?: number } = {}): string {
  const { pass = true, costUsd } = opts;
  return (
    'checks:\n  - id: check-a\n    check: "alpha check"\n' +
    `    pass: ${pass}\n    evidence: "seen"\npass_rate: ${pass ? 1 : 0}\n` +
    (costUsd !== undefined ? `cost_usd: ${costUsd}\n` : '')
  );
}

const TRANSCRIPT_HEADER =
  '---\nsession: abc\nproject: /tmp/p\ntranscript: /tmp/x.jsonl\n\nconversation:\n';

// Shaped as scuttlerun writes a transcript: header document, conversation,
// footer.
function transcript(prompt: string, costUsd?: number): string {
  return (
    TRANSCRIPT_HEADER +
    `  - user: ${JSON.stringify(prompt)}\n\n  - assistant: Done.\n\n\n` +
    'turns: 1\ntool_calls: 0\nduration_s: 1\n' +
    (costUsd !== undefined ? `cost_usd: ${costUsd}\n` : '')
  );
}

interface SourceRepSpec {
  rep: number;
  prompt?: string;
  transcript?: string | false;
  grading?: string | false;
}

async function writeSourceRun(dir: string, scenarios: Record<string, SourceRepSpec[]>) {
  for (const [id, reps] of Object.entries(scenarios)) {
    for (const spec of reps) {
      const repDir = join(dir, id, `rep-${spec.rep}`);
      await mkdir(repDir, { recursive: true });
      if (spec.transcript !== false) {
        await writeFile(
          join(repDir, 'output.yaml'),
          spec.transcript ?? transcript(spec.prompt ?? PROMPT),
        );
      }
      if (spec.grading !== false) {
        await writeFile(join(repDir, 'grading.yaml'), spec.grading ?? grading());
      }
    }
  }
}

async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = entry.isFile()
      ? createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      : 'dir';
  }
  return out;
}

// The stubs append each invocation's args without locking, so a test that
// reads them back runs its gradings one at a time.
function invocations(argsLog: string): string[][] {
  return argsLog
    .split('===\n')
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.split('\n').filter((line) => line.length > 0));
}

describe('cli regrade', () => {
  let workDir: string;
  let root: string;
  let source: string;
  let isolatedTmp: string;
  let scuttlerunArgs: string;
  let pincenezArgs: string;

  beforeEach(async () => {
    workDir = await makeTmpDir('cli-regrade');
    root = join(workDir, 'root');
    source = join(workDir, 'source');
    isolatedTmp = join(workDir, 'tmp');
    scuttlerunArgs = join(workDir, 'scuttlerun-args.txt');
    pincenezArgs = join(workDir, 'pincenez-args.txt');
    await mkdir(isolatedTmp);
    await writeRoot();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true });
  });

  async function writeRoot(opts: { evals?: Record<string, unknown>; ids?: string[] } = {}) {
    const { evals = {}, ids = ['alpha'] } = opts;
    await rm(root, { recursive: true, force: true });
    await mkdir(root);
    await writeFile(
      join(root, 'evals.yaml'),
      stringify({ version: '1', scenarios: { base: {} }, ...evals }),
    );
    for (const id of ids) {
      await mkdir(join(root, 'evals', id), { recursive: true });
      await writeFile(join(root, 'evals', id, 'scenario.yaml'), stringify({ prompt: PROMPT }));
      await writeFile(
        join(root, 'evals', id, 'checks.yaml'),
        stringify({ checks: [{ 'check-a': { check: 'alpha check' } }] }),
      );
    }
  }

  async function regrade(
    args: string[],
    env: Record<string, string> = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [CLI_PATH, 'regrade', ...args],
        {
          env: {
            ...process.env,
            TMPDIR: isolatedTmp,
            CRABOODLE_STUB_SCUTTLERUN_ARGS_FILE: scuttlerunArgs,
            CRABOODLE_STUB_SCUTTLERUN_DRYRUN_STDOUT: `prompt: ${PROMPT}\n`,
            CRABOODLE_STUB_PINCENEZ_ARGS_FILE: pincenezArgs,
            CRABOODLE_STUB_PINCENEZ_STDOUT: grading(),
            ...env,
          },
        },
      );
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

  async function pincenezCalls(): Promise<string[][]> {
    try {
      return invocations(await readFile(pincenezArgs, 'utf8'));
    } catch {
      return [];
    }
  }

  it('re-grades kept transcripts into a new run dir without running an agent session', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1 }] });
    const before = await snapshotTree(source);

    const { code, stdout } = await regrade([root, source]);

    expect(code).toBe(0);
    const doc = parse(stdout);
    expect(doc.source_artifact_dir).toBe(source);
    const artifactDir: string = doc.artifact_dir;
    expect(artifactDir).not.toBe(source);
    expect(dirname(artifactDir)).toBe(isolatedTmp);
    expect(stdout.endsWith('result: pass\nexit_code: 0\n')).toBe(true);
    expect(doc.scenarios[0].alpha.pass_rate).toBe(1);

    const scuttlerunLog = (await readFile(scuttlerunArgs, 'utf8')).split('\n');
    const dryRuns = scuttlerunLog.filter((line) => line === '--dry-run').length;
    expect(dryRuns).toBeGreaterThanOrEqual(1);
    expect(dryRuns).toBe(scuttlerunLog.filter((line) => line === '===').length);

    const [call] = await pincenezCalls();
    expect(call.at(-1)).toBe(join(artifactDir, 'alpha', 'rep-1', 'output.yaml'));
    expect(call.at(-2)).toBe(join(root, 'evals', 'alpha', 'checks.yaml'));

    expect(await readFile(join(artifactDir, 'alpha', 'rep-1', 'output.yaml'), 'utf8')).toBe(
      await readFile(join(source, 'alpha', 'rep-1', 'output.yaml'), 'utf8'),
    );
    expect((await stat(join(artifactDir, 'alpha', 'rep-1', 'grading.yaml'))).isFile()).toBe(true);
    expect(await snapshotTree(source)).toEqual(before);
  });
  it('reports and budgets grading spend only, never the source transcript cost', async () => {
    await writeRoot({ evals: { max_budget_usd: 0.1 } });
    await writeSourceRun(source, { alpha: [{ rep: 1, transcript: transcript(PROMPT, 0.5) }] });

    const { code, stdout } = await regrade([root, source], {
      CRABOODLE_STUB_PINCENEZ_STDOUT: grading({ costUsd: 0.01 }),
    });

    expect(code).toBe(0);
    const doc = parse(stdout);
    const alpha = doc.scenarios[0].alpha;
    expect(alpha.cost_usd).toBe(0.01);
    expect(alpha.grading_cost_usd).toBe(0.01);
    expect(alpha).not.toHaveProperty('agent_cost_usd');
    expect(doc.total_cost_usd).toBe(0.01);
    expect(doc.result).toBe('pass');
  });

  it('attributes no agent cost to a rep whose regrading failed', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1, transcript: transcript(PROMPT, 0.5) }] });

    const { code, stdout } = await regrade([root, source], { CRABOODLE_STUB_PINCENEZ_EXIT: '1' });

    expect(code).toBe(4);
    expect(stdout).not.toContain('cost_usd');
    const doc = parse(stdout);
    expect(doc.result).toBe('no_successful_reps');
    expect(doc.scenarios[0].alpha.errors).toEqual([
      expect.objectContaining({
        rep: 1,
        stage: 'pincenez',
        transcript: 'alpha/rep-1/output.yaml',
      }),
    ]);
  });
  it('regrades only graded source reps, keeping every rep and its number', async () => {
    await writeRoot({ evals: { min_pass_rate: 0.5 } });
    await writeSourceRun(source, {
      alpha: [
        { rep: 2 },
        { rep: 5 },
        { rep: 7, grading: false },
        { rep: 8, grading: 'pass_rate: 1\n' },
        { rep: 9, transcript: false, grading: false },
      ],
    });

    const first = await regrade(['--concurrency', '1', root, source]);

    expect(first.code).toBe(4);
    const doc = parse(first.stdout);
    expect(doc.result).toBe('reliability_failure');
    const alpha = doc.scenarios[0].alpha;
    expect(alpha.error_rate).toBe(0.6);
    expect(alpha.errors).toEqual([
      {
        rep: 7,
        stage: 'source',
        error: `source rep was not graded (no grading.yaml): ${join(source, 'alpha', 'rep-7')}`,
        transcript: 'alpha/rep-7/output.yaml',
      },
      {
        rep: 8,
        stage: 'source',
        error: `source rep grading.yaml is not a valid grading: ${join(source, 'alpha', 'rep-8')}`,
        transcript: 'alpha/rep-8/output.yaml',
      },
      {
        rep: 9,
        stage: 'source',
        error: `source rep has no transcript (no output.yaml): ${join(source, 'alpha', 'rep-9')}`,
      },
    ]);
    for (const rep of [7, 8, 9]) {
      expect(first.stderr).toContain(`alpha rep ${rep}: source rep`);
    }
    const calls = await pincenezCalls();
    expect(calls.map((c) => c.at(-1)).sort()).toEqual([
      join(doc.artifact_dir, 'alpha', 'rep-2', 'output.yaml'),
      join(doc.artifact_dir, 'alpha', 'rep-5', 'output.yaml'),
    ]);
    expect((await readdir(join(doc.artifact_dir, 'alpha'))).sort()).toEqual([
      'rep-2',
      'rep-5',
      'rep-7',
      'rep-8',
      'rep-9',
    ]);

    const second = await regrade([root, doc.artifact_dir]);

    const again = parse(second.stdout).scenarios[0].alpha;
    expect(again.errors.map((e: { rep: number; stage: string }) => [e.rep, e.stage])).toEqual([
      [7, 'source'],
      [8, 'source'],
      [9, 'source'],
    ]);
    expect(again.error_rate).toBe(0.6);
  });
  it('reports a transcript it cannot copy as a source error for that rep', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1 }, { rep: 2 }] });
    const unreadable = join(source, 'alpha', 'rep-2', 'output.yaml');
    await chmod(unreadable, 0o000);

    try {
      const { stdout } = await regrade([root, source]);

      const alpha = parse(stdout).scenarios[0].alpha;
      expect(alpha.pass_rate).toBe(1);
      expect(alpha.errors).toEqual([
        {
          rep: 2,
          stage: 'source',
          error: expect.stringMatching(
            new RegExp(
              `^could not copy the source transcript \\(.+\\): ${join(source, 'alpha', 'rep-2')}$`,
            ),
          ),
        },
      ]);
    } finally {
      await chmod(unreadable, 0o644);
    }
  });

  it('exits no_successful_reps, with a stderr line per rep, when no source rep was graded', async () => {
    await writeSourceRun(source, {
      alpha: [
        { rep: 1, grading: false },
        { rep: 2, grading: false },
      ],
    });

    const { code, stdout, stderr } = await regrade([root, source]);

    expect(code).toBe(4);
    expect(parse(stdout).result).toBe('no_successful_reps');
    expect(stderr).toContain('alpha rep 1: source rep was not graded');
    expect(stderr).toContain('alpha rep 2: source rep was not graded');
    expect(await pincenezCalls()).toEqual([]);
  });

  it('grades every scenario below min_pass_rate instead of failing fast', async () => {
    await writeRoot({ evals: { min_pass_rate: 1 }, ids: ['alpha', 'beta'] });
    await writeSourceRun(source, { alpha: [{ rep: 1 }], beta: [{ rep: 1 }] });

    const { code, stdout, stderr } = await regrade(['--concurrency', '1', '-v', root, source], {
      CRABOODLE_STUB_PINCENEZ_STDOUT: grading({ pass: false }),
    });

    expect(code).toBe(3);
    expect(stderr).toContain('Threshold check failed');
    expect(stderr).not.toContain('fail-fast');
    expect(stdout).not.toContain('fail_fast');
    const doc = parse(stdout);
    expect(doc.result).toBe('threshold_failure');
    expect(
      doc.scenarios.map(
        (s: Record<string, { pass_rate: number }>) => Object.values(s)[0].pass_rate,
      ),
    ).toEqual([0, 0]);
    expect(await pincenezCalls()).toHaveLength(2);
  });
  it('skips queued reps once grading spend exceeds the budget', async () => {
    await writeRoot({ evals: { max_budget_usd: 0.1 } });
    await writeSourceRun(source, { alpha: [{ rep: 1 }, { rep: 2 }] });

    const { code, stdout } = await regrade(['--concurrency', '1', root, source], {
      CRABOODLE_STUB_PINCENEZ_STDOUT: grading({ costUsd: 0.2 }),
    });

    expect(code).toBe(5);
    const doc = parse(stdout);
    expect(doc.result).toBe('budget_exceeded');
    expect(doc.scenarios[0].alpha.errors).toEqual([
      expect.objectContaining({ rep: 2, stage: 'budget' }),
    ]);
    expect(await pincenezCalls()).toHaveLength(1);
  });
  it('grounds grading as run does: resolved prompt, grader model and auth', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1 }] });

    await regrade(['--grader-model', 'judge-x', '--auth', 'api-key', root, source]);

    const [call] = await pincenezCalls();
    expect(call.slice(0, 6)).toEqual([
      '--model',
      'judge-x',
      '--auth',
      'api-key',
      '--context',
      PROMPT,
    ]);
  });

  it("falls back to evals.yaml's auth when no --auth is given", async () => {
    await writeRoot({ evals: { auth: 'subscription' } });
    await writeSourceRun(source, { alpha: [{ rep: 1 }] });

    await regrade([root, source]);

    const [call] = await pincenezCalls();
    expect(call.slice(0, 2)).toEqual(['--auth', 'subscription']);
  });
  it('flags a scenario whose prompt changed since the source run, and grades it anyway', async () => {
    const prompt =
      'Fix the failing test.\nThe test lives in tests/foo.test.ts and it fails because the parser drops a trailing newline when the input ends early.\nRun it after.';
    const hardWrapped =
      TRANSCRIPT_HEADER +
      '  - user: |-\n' +
      '      Fix the failing test.\n' +
      '      The test lives in tests/foo.test.ts and it fails because the parser\n' +
      '      drops a trailing newline when the input ends early.\n' +
      '      Run it after.\n\n  - assistant: Done.\n';
    await writeRoot({ ids: ['alpha', 'beta'] });
    await writeSourceRun(source, {
      alpha: [
        { rep: 1, prompt: 'Write a limerick' },
        { rep: 2, prompt: 'Write a limerick' },
      ],
      beta: [{ rep: 1, transcript: hardWrapped }],
    });

    const { code, stdout, stderr } = await regrade(['--concurrency', '1', root, source], {
      CRABOODLE_STUB_SCUTTLERUN_DRYRUN_STDOUT: stringify({ prompt }),
    });

    expect(code).toBe(0);
    expect(stderr.match(/prompt changed/g)).toHaveLength(1);
    expect(stderr).toContain('[craboodle] alpha: prompt changed since the source run');
    const blocks = Object.assign({}, ...parse(stdout).scenarios);
    expect(blocks.alpha.prompt_changed).toBe(true);
    expect(blocks.beta).not.toHaveProperty('prompt_changed');
    expect(await pincenezCalls()).toHaveLength(3);
  });

  it('warns once per scenario when the prompt cannot be compared', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1 }, { rep: 2 }] });

    const { code, stdout, stderr } = await regrade(['--concurrency', '1', root, source], {
      CRABOODLE_STUB_SCUTTLERUN_DRYRUN_EXIT: '1',
    });

    expect(code).toBe(0);
    expect(stderr.match(/could not check whether the prompt changed/g)).toHaveLength(1);
    expect(parse(stdout).scenarios[0].alpha).not.toHaveProperty('prompt_changed');
    expect(await pincenezCalls()).toHaveLength(2);
  });
  it('never sweeps its own source, however old, while sweeping other old runs', async () => {
    const oldSource = join(isolatedTmp, 'craboodle-run-src');
    const other = join(isolatedTmp, 'craboodle-run-other');
    await writeSourceRun(oldSource, { alpha: [{ rep: 1 }] });
    await mkdir(other);
    const past = new Date(Date.now() - 30 * 86_400_000);
    for (const dir of [oldSource, other]) await utimes(dir, past, past);

    const { code } = await regrade([root, oldSource]);

    expect(code).toBe(0);
    expect((await stat(join(oldSource, 'alpha', 'rep-1', 'output.yaml'))).isFile()).toBe(true);
    await expect(stat(other)).rejects.toThrow();
  });
  it.each([
    ['is missing', async () => {}, 'Artifact dir not found'],
    ['is a file', () => writeFile(source, ''), 'Artifact dir is not a directory'],
    [
      'has no <id>/rep-<N>/ dirs',
      () => mkdir(join(source, 'alpha', 'notes'), { recursive: true }),
      'Artifact dir is not a craboodle run directory',
    ],
    [
      'has rep dirs with no transcript or grading',
      () => mkdir(join(source, 'alpha', 'rep-1'), { recursive: true }),
      'Artifact dir holds no transcripts to regrade',
    ],
  ])('exits 4 before doing anything when the artifact dir %s', async (_case, arrange, message) => {
    await arrange();

    const { code, stdout, stderr } = await regrade([root, source]);

    expect(code).toBe(4);
    expect(stderr).toContain(`[craboodle] ${message}: ${source}`);
    expect(stderr).toContain('  Try: ');
    expect(stdout).toBe('');
    expect(await readdir(isolatedTmp)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    'exits 4 before doing anything when the artifact dir cannot be read',
    async () => {
      await mkdir(source);
      await chmod(source, 0o000);

      try {
        const { code, stdout, stderr } = await regrade([root, source]);

        expect(code).toBe(4);
        expect(stderr).toContain(`[craboodle] Artifact dir could not be read (EACCES): ${source}`);
        expect(stdout).toBe('');
        expect(await readdir(isolatedTmp)).toEqual([]);
      } finally {
        await chmod(source, 0o755);
      }
    },
  );

  it('exits 4 when scuttlerun or pincenez is not on PATH', async () => {
    await writeSourceRun(source, { alpha: [{ rep: 1 }] });

    const { code, stderr } = await regrade([root, source], { PATH: '/usr/bin:/bin' });

    expect(code).toBe(4);
    expect(stderr).toContain('not found on PATH');
  });
  it('skips, with a warning, a scenario only one side has', async () => {
    await writeRoot({ ids: ['alpha', 'beta'] });
    await writeSourceRun(source, { alpha: [{ rep: 1 }], gamma: [{ rep: 1 }] });

    const { code, stdout, stderr } = await regrade([root, source]);

    expect(code).toBe(0);
    expect(stderr).toContain('[craboodle] gamma: not in the eval root; skipped');
    expect(stderr).toContain('[craboodle] beta: not in the source run; skipped');
    expect(parse(stdout).scenarios.map((s: object) => Object.keys(s)[0])).toEqual(['alpha']);
  });

  it('exits 4 before streaming when the source and root share no scenario', async () => {
    await writeRoot({ ids: ['beta'] });
    await writeSourceRun(source, { gamma: [{ rep: 1 }] });

    const { code, stdout, stderr } = await regrade([root, source]);

    expect(code).toBe(4);
    expect(stderr).toContain('No scenarios in common');
    expect(stdout).toBe('');
  });

  it('filters the root as run does and warns only about scenarios the filter keeps', async () => {
    await writeRoot({ ids: ['alpha', 'beta'] });
    await writeSourceRun(source, { alpha: [{ rep: 1 }], beta: [{ rep: 1 }], gamma: [{ rep: 1 }] });

    const kept = await regrade(['--scenarios', 'beta', root, source]);

    expect(kept.code).toBe(0);
    expect(kept.stderr).not.toContain('skipped');
    expect(parse(kept.stdout).scenarios.map((s: object) => Object.keys(s)[0])).toEqual(['beta']);
    expect(await pincenezCalls()).toHaveLength(1);

    const none = await regrade(['--scenarios', 'nomatch', root, source]);

    expect(none.code).toBe(4);
    expect(none.stderr).toContain('No scenarios match filter: nomatch');
    expect(none.stdout).toBe('');
  });
  it('validates its flags and is documented in the help', async () => {
    const bad = await regrade(['--concurrency', '0', root, source]);
    expect(bad.code).toBe(1);

    const own = await regrade(['--help']);
    expect(own.stdout).toContain('regrade [options] <root> <artifact_dir>');
    expect(own.stdout).not.toContain('--repeats');

    const { stdout: main } = await execFileAsync(process.execPath, [CLI_PATH, '--help']);
    expect(main).toContain('craboodle regrade ./my-skill');
    expect(main).toMatch(/source_artifact_dir/);
    expect(main).toMatch(/prompt_changed/);
  });
});

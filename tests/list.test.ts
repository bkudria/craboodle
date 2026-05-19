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

describe('list', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-list-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('reports correct check count from checks: array', async () => {
    // Setup: craboodle.yaml + scenario with 3 checks
    await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
    await writeFile(join(tmpDir, 'base.yaml'), '# defaults\n');
    await mkdir(join(tmpDir, 'my-scenario'));
    await writeFile(join(tmpDir, 'my-scenario', 'scenario.yaml'), stringify({ prompt: 'test\n' }));
    await writeFile(
      join(tmpDir, 'my-scenario', 'checks.yaml'),
      stringify({
        context: 'The agent was asked to test something',
        checks: [
          { 'check-a': { check: 'First check', note: 'note' } },
          { 'check-b': { check: 'Second check', note: 'note' } },
          { 'check-c': { check: 'Third check', note: 'note' } },
        ],
      }),
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'list', tmpDir]);

    // Should report 3 checks, not 2 (number of top-level keys: context + checks)
    expect(stdout).toContain('checks: 3');
    expect(stdout).toContain('3 checks');
  });

  it('filters scenarios with --scenario flag', async () => {
    await writeFile(join(tmpDir, 'craboodle.yaml'), stringify({ version: '1' }));
    await mkdir(join(tmpDir, 'alpha'));
    await writeFile(join(tmpDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'a\n' }));
    await writeFile(
      join(tmpDir, 'alpha', 'checks.yaml'),
      stringify({
        context: 'The agent was asked to do alpha',
        checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
      }),
    );
    await mkdir(join(tmpDir, 'beta'));
    await writeFile(join(tmpDir, 'beta', 'scenario.yaml'), stringify({ prompt: 'b\n' }));
    await writeFile(
      join(tmpDir, 'beta', 'checks.yaml'),
      stringify({
        context: 'The agent was asked to do beta',
        checks: [{ 'check-b': { check: 'beta check', note: 'note' } }],
      }),
    );

    const { stdout } = await execFileAsync(process.execPath, [
      CLI_PATH,
      'list',
      '--scenario',
      'alpha',
      tmpDir,
    ]);

    expect(stdout).toContain('id: alpha');
    expect(stdout).not.toContain('id: beta');
  });
});

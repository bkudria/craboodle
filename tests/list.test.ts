import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'yaml';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

describe('list', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('list');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function writeEvals(content: unknown = { version: '1', scenarios: { base: {} } }) {
    await writeFile(join(tmpDir, 'evals.yaml'), stringify(content));
  }

  async function writeScenario(id: string, checks: unknown): Promise<void> {
    await mkdir(join(tmpDir, 'evals', id), { recursive: true });
    await writeFile(join(tmpDir, 'evals', id, 'scenario.yaml'), stringify({ prompt: `${id}\n` }));
    await writeFile(join(tmpDir, 'evals', id, 'checks.yaml'), stringify(checks));
  }

  it('reports correct check count from checks: array', async () => {
    await writeEvals();
    await writeScenario('my-scenario', {
      context: 'The agent was asked to test something',
      checks: [
        { 'check-a': { check: 'First check', note: 'note' } },
        { 'check-b': { check: 'Second check', note: 'note' } },
        { 'check-c': { check: 'Third check', note: 'note' } },
      ],
    });

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'list', tmpDir]);

    // Should report 3 checks, not 2 (number of top-level keys: context + checks)
    expect(stdout).toContain('checks: 3');
    expect(stdout).toContain('3 checks');
  });

  it('filters scenarios with --scenario flag', async () => {
    await writeEvals();
    await writeScenario('alpha', {
      context: 'The agent was asked to do alpha',
      checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
    });
    await writeScenario('beta', {
      context: 'The agent was asked to do beta',
      checks: [{ 'check-b': { check: 'beta check', note: 'note' } }],
    });

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

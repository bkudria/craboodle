import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { ChildProcess } from 'node:child_process';
import { makeTmpDir } from './_fixtures.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

function mockLintResponse(stdout: string): void {
  mockSpawn.mockImplementation((() => {
    const stdoutStream = new Readable({ read() {} });
    const stderrStream = new Readable({ read() {} });
    const child = new EventEmitter() as ChildProcess;
    (child as unknown as { stdout: Readable }).stdout = stdoutStream;
    (child as unknown as { stderr: Readable }).stderr = stderrStream;
    (child as unknown as { pid: number }).pid = 12345;
    (child as unknown as { kill: () => boolean }).kill = vi.fn(() => true);

    queueMicrotask(() => {
      stdoutStream.push(stdout);
      stdoutStream.push(null);
      stderrStream.push(null);
      let pending = 2;
      const done = (): void => {
        pending--;
        if (pending === 0) child.emit('close', 0, null);
      };
      stdoutStream.on('end', done);
      stderrStream.on('end', done);
      stdoutStream.resume();
      stderrStream.resume();
    });

    return child;
  }) as unknown as typeof spawn);
}

describe('lintCommand', () => {
  let tmpDir: string;
  let stdout: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('lint');
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__');
    }) as never);
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeEvals(content: unknown = { version: '1', scenarios: { base: {} } }) {
    await writeFile(join(tmpDir, 'evals.yaml'), stringify(content));
  }

  async function writeScenario(id: string): Promise<void> {
    await mkdir(join(tmpDir, 'evals', id), { recursive: true });
    await writeFile(join(tmpDir, 'evals', id, 'scenario.yaml'), stringify({ prompt: `${id}\n` }));
    await writeFile(
      join(tmpDir, 'evals', id, 'checks.yaml'),
      stringify({
        context: 'ctx',
        checks: [{ 'check-a': { check: 'something', note: 'n' } }],
      }),
    );
  }

  async function makePlugin(skills: string[], pluginName: string = 'my-plugin'): Promise<void> {
    await mkdir(join(tmpDir, '.claude-plugin'));
    await writeFile(
      join(tmpDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: pluginName, version: '0.1.0' }),
    );
    for (const id of skills) {
      await mkdir(join(tmpDir, 'skills', id), { recursive: true });
      await writeFile(join(tmpDir, 'skills', id, 'SKILL.md'), `---\nname: ${id}\n---\n`);
    }
  }

  async function makeSkill(): Promise<void> {
    await writeFile(join(tmpDir, 'SKILL.md'), '---\nname: solo\n---\n');
  }

  function cleanLintYaml(): string {
    return 'checks:\n  - id: a1\n    check: "something"\n    issues: []\n';
  }

  async function runLint(scenarios?: string): Promise<void> {
    const { lintCommand } = await import('../src/commands/lint.js');
    try {
      await lintCommand(tmpDir, { concurrency: 1, scenarios });
    } catch (err) {
      if ((err as Error).message !== '__exit__') throw err;
    }
  }

  it('emits a plugin_coverage block after totals when in plugin mode', async () => {
    await writeEvals();
    await writeScenario('skill-foo-basic');
    await writeScenario('skill-foo-advanced');
    await writeScenario('orphan-scenario');
    await makePlugin(['foo', 'bar']);

    mockLintResponse(cleanLintYaml());

    await runLint();

    expect(stdout).toContain('plugin_coverage:');
    expect(stdout).toMatch(/skills:\n {4}bar: 0\n {4}foo: 2/);
    // Coverage block must appear after the totals
    const idxTotals = stdout.indexOf('checks_with_issues:');
    const idxCoverage = stdout.indexOf('plugin_coverage:');
    expect(idxTotals).toBeGreaterThan(-1);
    expect(idxCoverage).toBeGreaterThan(idxTotals);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('omits the plugin_coverage block in skill mode', async () => {
    await writeEvals();
    await writeScenario('any-scenario');
    await makeSkill();

    mockLintResponse(cleanLintYaml());

    await runLint();

    expect(stdout).not.toContain('plugin_coverage:');
  });

  it('omits the plugin_coverage block in generic mode', async () => {
    await writeEvals();
    await writeScenario('any-scenario');
    // No SKILL.md, no .claude-plugin/plugin.json -> generic mode

    mockLintResponse(cleanLintYaml());

    await runLint();

    expect(stdout).not.toContain('plugin_coverage:');
  });

  it('coverage counts reflect a --scenarios filter', async () => {
    await writeEvals();
    await writeScenario('skill-foo-basic');
    await writeScenario('skill-foo-advanced');
    await writeScenario('skill-bar-basic');
    await makePlugin(['foo', 'bar']);

    mockLintResponse(cleanLintYaml());

    await runLint('skill-foo-*');

    expect(stdout).toContain('plugin_coverage:');
    expect(stdout).toMatch(/skills:\n {4}bar: 0\n {4}foo: 2/);
  });
});

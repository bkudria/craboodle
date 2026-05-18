import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { stringify } from 'yaml';

function waitForExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollFileNonEmpty(path: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const contents = await readFile(path, 'utf8');
      if (contents.trim().length > 0) return Date.now() - start;
    } catch {
      /* file may not exist yet */
    }
    await delay(25);
  }
  throw new Error(`pidFile remained empty for ${timeoutMs}ms: ${path}`);
}

function pidStillAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function makeStubBin(stubDir: string, name: string, pidFile: string): Promise<void> {
  const script = `#!/bin/sh
echo $$ >> "${pidFile}"
exec sleep 30
`;
  const path = join(stubDir, name);
  await writeFile(path, script);
  await chmod(path, 0o755);
}

describe('cli signal handling (integration)', () => {
  let workDir: string;
  let evalsDir: string;
  let stubDir: string;
  let pidFile: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'craboodle-signal-test-'));
    evalsDir = join(workDir, 'evals');
    stubDir = join(workDir, 'stubs');
    pidFile = join(workDir, 'pids.txt');
    await mkdir(evalsDir);
    await mkdir(stubDir);
    await writeFile(pidFile, '');

    // Minimal evals dir with one scenario
    await writeFile(join(evalsDir, 'craboodle.yaml'), stringify({ version: '1' }));
    await mkdir(join(evalsDir, 'alpha'));
    await writeFile(join(evalsDir, 'alpha', 'scenario.yaml'), stringify({ prompt: 'hello\n' }));
    await writeFile(
      join(evalsDir, 'alpha', 'checks.yaml'),
      stringify({
        context: 'alpha context',
        checks: [{ 'check-a': { check: 'alpha check', note: 'note' } }],
      }),
    );

    await makeStubBin(stubDir, 'scuttlerun', pidFile);
    await makeStubBin(stubDir, 'pincenez', pidFile);
  });

  afterEach(async () => {
    // Best-effort: SIGKILL any stragglers from the pidfile
    try {
      const pids = (await readFile(pidFile, 'utf8'))
        .split('\n')
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0);
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* no pids file */
    }
    await rm(workDir, { recursive: true });
  });

  it('run: SIGINT exits 130, prints cleanup message, leaves no zombie subprocesses', async () => {
    const child = spawn('craboodle', ['run', '--repeats', '1', evalsDir], {
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for scuttlerun stub to record its PID before SIGINT
    await pollFileNonEmpty(pidFile, 8000);
    child.kill('SIGINT');

    const result = await waitForExit(child);

    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Cleaning up subprocesses');
    expect(result.stderr).toContain('Ctrl-C again');

    // Give SIGTERM a moment to propagate
    await delay(200);

    const pids = (await readFile(pidFile, 'utf8'))
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    expect(pids.length).toBeGreaterThan(0);
    const alive = pids.filter(pidStillAlive);
    expect(alive).toEqual([]);
  }, 15000);

  it('lint: SIGINT exits 130 and leaves no zombie subprocesses', async () => {
    const child = spawn('craboodle', ['lint', evalsDir], {
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await pollFileNonEmpty(pidFile, 8000);
    child.kill('SIGINT');

    const result = await waitForExit(child);

    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Cleaning up subprocesses');

    await delay(200);

    const pids = (await readFile(pidFile, 'utf8'))
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    expect(pids.length).toBeGreaterThan(0);
    const alive = pids.filter(pidStillAlive);
    expect(alive).toEqual([]);
  }, 15000);
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

async function runAndCapture(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args]);
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : -1, stderr: e.stderr ?? '' };
  }
}

describe('init', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-init-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('creates craboodle.yaml and base.yaml with no example scenario', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const craboodleContent = await readFile(join(initDir, 'craboodle.yaml'), 'utf8');
    const craboodleData = parse(craboodleContent);
    expect(craboodleData).toHaveProperty('version');

    const entries = await readdir(initDir);
    expect([...entries].sort()).toEqual(['base.yaml', 'craboodle.yaml']);
  });

  it('base.yaml header documents the tools-array replace semantic', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const baseContent = await readFile(join(initDir, 'base.yaml'), 'utf8');
    expect(baseContent).toMatch(/REPLACE/);
  });

  it('base.yaml documents additional_tools: as the additive pattern', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const baseContent = await readFile(join(initDir, 'base.yaml'), 'utf8');
    expect(baseContent).toMatch(/^\s*#\s*additional_tools:/m);
  });

  it('base.yaml parses as empty (all fields commented)', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const baseContent = await readFile(join(initDir, 'base.yaml'), 'utf8');
    const parsed = parse(baseContent);
    expect(parsed ?? null).toBeNull();
  });

  it('omits min_pass_rate from the default template', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const craboodleContent = await readFile(join(initDir, 'craboodle.yaml'), 'utf8');
    const craboodleData = parse(craboodleContent);
    expect(craboodleData).not.toHaveProperty('min_pass_rate');
  });

  it('mentions min_pass_rate as a commented guidance line', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const craboodleContent = await readFile(join(initDir, 'craboodle.yaml'), 'utf8');
    expect(craboodleContent).toMatch(/^\s*#.*min_pass_rate/m);
  });

  it('surfaces the repeats default value (3) in the scaffold', async () => {
    const initDir = join(tmpDir, 'evals');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const craboodleContent = await readFile(join(initDir, 'craboodle.yaml'), 'utf8');
    expect(craboodleContent).toMatch(/^\s*#\s*repeats:.*\b3\b/m);
  });

  it('run --help documents CLI > config precedence for --repeats', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'run', '--help']);
    expect(stdout).toContain('--repeats');
    expect(stdout).toMatch(/overrides\s+craboodle\.yaml|takes precedence/i);
  });

  describe('conflict guidance', () => {
    it('emits recovery hint when craboodle.yaml already exists', async () => {
      const initDir = join(tmpDir, 'evals');
      await mkdir(initDir);
      await writeFile(join(initDir, 'craboodle.yaml'), stringify({ version: '1' }));
      const { code, stderr } = await runAndCapture(['init', initDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('already contains craboodle.yaml');
      expect(stderr).toContain('pick a different directory');
    });

    it('emits recovery hint when directory has existing scenarios', async () => {
      const initDir = join(tmpDir, 'evals');
      await mkdir(join(initDir, 'alpha'), { recursive: true });
      await writeFile(join(initDir, 'alpha', 'scenario.yaml'), 'prompt: x\n');
      const { code, stderr } = await runAndCapture(['init', initDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('already contains scenario files');
      expect(stderr).toContain('pick a different directory');
    });
  });
});

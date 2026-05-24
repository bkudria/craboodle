import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
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
    tmpDir = await makeTmpDir('init');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('creates only evals.yaml at the root (no base.yaml, no craboodle.yaml)', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const entries = await readdir(initDir);
    expect(entries).toContain('evals.yaml');
    expect(entries).not.toContain('craboodle.yaml');
    expect(entries).not.toContain('base.yaml');
  });

  it('evals.yaml has version "1" and a scenarios.base block', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    const parsed = parse(content);
    expect(parsed).toHaveProperty('version', '1');
    expect(parsed).toHaveProperty('scenarios.base');
  });

  it('mentions min_pass_rate as a commented guidance line', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/^\s*#.*min_pass_rate/m);
  });

  it('surfaces the repeats default value (3) in the scaffold', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/^\s*#\s*repeats:.*\b3\b/m);
  });

  it('omits min_pass_rate from the parsed YAML', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    const parsed = parse(content);
    expect(parsed).not.toHaveProperty('min_pass_rate');
  });

  it('documents additional_tools: as the additive pattern in evals.yaml', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/^\s*#.*additional_tools:/m);
  });

  it('skill mode: when SKILL.md exists, comments suggest project.skills: [.]', async () => {
    const initDir = join(tmpDir, 'my-skill');
    await mkdir(initDir, { recursive: true });
    await writeFile(join(initDir, 'SKILL.md'), '---\nname: my-skill\n---\n# My Skill\n');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    // commented project.skills hint with [.] for self-reference
    expect(content).toMatch(/#\s*skills:[\s\S]*?#\s*-\s*\./);
  });

  it('plugin mode: when .claude-plugin/plugin.json exists, comments suggest skills: skills/<id>', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'first-skill'), { recursive: true });
    await writeFile(
      join(initDir, 'skills', 'first-skill', 'SKILL.md'),
      '---\nname: first-skill\n---\n',
    );

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/skills\/first-skill/);
  });

  it('plugin mode: stdout reports the parsed plugin name and version', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin', version: '0.3.1' }),
    );
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    expect(stdout).toMatch(/Detected plugin:\s*my-plugin\s*\(0\.3\.1\)/);
  });

  it('plugin mode: stdout reports just the name when version is absent', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'unversioned-plugin' }),
    );
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    expect(stdout).toMatch(/Detected plugin:\s*unversioned-plugin\s*$/m);
  });

  it('plugin mode: stdout omits the detected-plugin line when plugin.json is malformed', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(join(initDir, '.claude-plugin', 'plugin.json'), '{ not json');
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    expect(stdout).not.toMatch(/Detected plugin/);
  });

  it('plugin mode: scaffolds one placeholder scenario per declared skill (regression: no skill is dropped past index 0)', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'zebra'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'zebra', 'SKILL.md'), '---\nname: zebra\n---');
    await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    for (const id of ['alpha', 'zebra']) {
      const scenarioRaw = await readFile(
        join(initDir, 'evals', `${id}-placeholder`, 'scenario.yaml'),
        'utf8',
      );
      const scenario = parse(scenarioRaw);
      expect(scenario).toBeTypeOf('object');
      expect(typeof scenario.prompt).toBe('string');
      expect((scenario.prompt as string).length).toBeGreaterThan(0);

      const checksRaw = await readFile(
        join(initDir, 'evals', `${id}-placeholder`, 'checks.yaml'),
        'utf8',
      );
      const checks = parse(checksRaw);
      expect(checks).toBeTypeOf('object');
      expect(checks).toHaveProperty('checks');
    }
  });

  it('plugin mode: scaffolds an agent-placeholder for each agents/<id>.md', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'agents'), { recursive: true });
    await writeFile(
      join(initDir, 'agents', 'note-summarizer.md'),
      '---\nname: note-summarizer\n---\n',
    );

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const scenarioRaw = await readFile(
      join(initDir, 'evals', 'note-summarizer-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'note-summarizer-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/tool:\s*Agent/);
    expect(checksRaw).toMatch(/subagent_type:\s*note-summarizer/);
  });

  it('plugin mode: scaffolds a command-placeholder for each commands/<id>.md', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'commands'), { recursive: true });
    await writeFile(join(initDir, 'commands', 'triage.md'), '# triage command\n');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const scenarioRaw = await readFile(
      join(initDir, 'evals', 'triage-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'triage-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/\/triage\b/);
  });

  it('plugin mode without discoverable skills: emits a placeholder hint', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(join(initDir, '.claude-plugin', 'plugin.json'), '{}');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    // Some kind of commented placeholder for skills
    expect(content).toMatch(/#\s*skills:/);
  });

  it('generic mode (no marker): emits a commented placeholder for skills', async () => {
    const initDir = join(tmpDir, 'just-a-dir');
    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/#\s*skills:/);
  });

  it('next-steps hint uses the new single-root arg shape', async () => {
    const initDir = join(tmpDir, 'my-skill');
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    // hint mentions `craboodle run <dir>` (not run <dir>/evals)
    expect(stdout).toContain(`craboodle run ${initDir}`);
    expect(stdout).not.toMatch(/run\s+\S+\/evals\b/);
  });

  it('run --help documents CLI > config precedence for --repeats', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'run', '--help']);
    expect(stdout).toContain('--repeats');
    expect(stdout).toMatch(/overrides\s+evals\.yaml|takes precedence/i);
  });

  describe('conflict guidance', () => {
    it('emits recovery hint when evals.yaml already exists', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await mkdir(initDir);
      await writeFile(
        join(initDir, 'evals.yaml'),
        stringify({ version: '1', scenarios: { base: {} } }),
      );
      const { code, stderr } = await runAndCapture(['init', initDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('already contains evals.yaml');
      expect(stderr).toContain('pick a different directory');
    });

    it('emits recovery hint when directory has existing scenarios under evals/', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await mkdir(join(initDir, 'evals', 'alpha'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'alpha', 'scenario.yaml'), 'prompt: x\n');
      const { code, stderr } = await runAndCapture(['init', initDir]);
      expect(code).toBe(1);
      expect(stderr).toContain('already contains scenario files');
      expect(stderr).toContain('pick a different directory');
    });
  });
});

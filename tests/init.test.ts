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

// Simulates the operator following bootstrap-evals.md Step 6.1: strip the
// leading `# ` from every line in the `project:` region (preserving indent),
// leaving documentation comments elsewhere intact.
function uncommentProjectBlock(content: string): string {
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => /^\s*#\s*project:\s*$/.test(l));
  const endIdx = lines.findIndex((l) => /^\s*#\s*user:\s*$/.test(l));
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('Could not locate project block in scaffolded evals.yaml');
  }
  return [
    ...lines.slice(0, startIdx),
    ...lines.slice(startIdx, endIdx).map((l) => l.replace(/^(\s*)#\s?/, '$1')),
    ...lines.slice(endIdx),
  ].join('\n');
}

async function runAndCapture(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args]);
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

  it('plugin mode: when .claude-plugin/plugin.json exists, comments suggest plugins: [.]', async () => {
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
    expect(content).toMatch(/#\s*plugins:[\s\S]*?#\s*-\s*\./);
    expect(content).not.toMatch(/skills\/first-skill/);
    expect(content).not.toMatch(/#\s*skills:/);
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
        join(initDir, 'evals', `skill-${id}-placeholder`, 'scenario.yaml'),
        'utf8',
      );
      const scenario = parse(scenarioRaw);
      expect(scenario).toBeTypeOf('object');
      expect(typeof scenario.prompt).toBe('string');
      expect((scenario.prompt as string).length).toBeGreaterThan(0);

      const checksRaw = await readFile(
        join(initDir, 'evals', `skill-${id}-placeholder`, 'checks.yaml'),
        'utf8',
      );
      const checks = parse(checksRaw);
      expect(checks).toBeTypeOf('object');
      expect(checks).toHaveProperty('checks');
      expect(checksRaw).toMatch(new RegExp(`input\\.skill:\\s*<plugin>:${id}`));
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
      join(initDir, 'evals', 'agent-note-summarizer-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'agent-note-summarizer-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/tool:\s*Agent/);
    expect(checksRaw).toMatch(/input\.subagent_type:\s*<plugin>:note-summarizer/);
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
      join(initDir, 'evals', 'command-triage-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'command-triage-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/\/triage\b/);
  });

  it('plugin mode: scaffolds a hooks-placeholder when hooks/hooks.json exists', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'hooks'), { recursive: true });
    await writeFile(join(initDir, 'hooks', 'hooks.json'), '{}');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const scenarioRaw = await readFile(
      join(initDir, 'evals', 'hooks-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'hooks-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/side effect|blocked|mutated/i);
  });

  it('plugin mode: scaffolds an mcp-servers-placeholder when .mcp.json exists', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await writeFile(join(initDir, '.mcp.json'), '{}');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const scenarioRaw = await readFile(
      join(initDir, 'evals', 'mcp-servers-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'mcp-servers-placeholder', 'checks.yaml'),
      'utf8',
    );
    expect(checksRaw).toMatch(/tool:\s*mcp__/);
  });

  it('plugin mode: stdout enumerates every created scaffold file under evals/', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
    await mkdir(join(initDir, 'agents'), { recursive: true });
    await writeFile(
      join(initDir, 'agents', 'note-summarizer.md'),
      '---\nname: note-summarizer\n---\n',
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    expect(stdout).toContain('evals.yaml');
    expect(stdout).toContain('evals/skill-alpha-placeholder/scenario.yaml');
    expect(stdout).toContain('evals/skill-alpha-placeholder/checks.yaml');
    expect(stdout).toContain('evals/agent-note-summarizer-placeholder/scenario.yaml');
    expect(stdout).toContain('evals/agent-note-summarizer-placeholder/checks.yaml');
  });

  it('plugin mode with multiple components: scaffolds a composition-placeholder scenario', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
    await mkdir(join(initDir, 'agents'), { recursive: true });
    await writeFile(
      join(initDir, 'agents', 'note-summarizer.md'),
      '---\nname: note-summarizer\n---\n',
    );

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const scenarioRaw = await readFile(
      join(initDir, 'evals', 'composition-placeholder', 'scenario.yaml'),
      'utf8',
    );
    const scenario = parse(scenarioRaw);
    expect(scenario).toBeTypeOf('object');
    expect(typeof scenario.prompt).toBe('string');
    expect((scenario.prompt as string).length).toBeGreaterThan(0);

    const checksRaw = await readFile(
      join(initDir, 'evals', 'composition-placeholder', 'checks.yaml'),
      'utf8',
    );
    const checks = parse(checksRaw);
    expect(checks).toBeTypeOf('object');
    expect(checks).toHaveProperty('checks');
    expect(checksRaw).toMatch(/cross-component/);
  });

  it('plugin mode with multiple components: stdout enumerates and points at the composition scenario', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
    await mkdir(join(initDir, 'agents'), { recursive: true });
    await writeFile(
      join(initDir, 'agents', 'note-summarizer.md'),
      '---\nname: note-summarizer\n---\n',
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    expect(stdout).toContain('evals/composition-placeholder/scenario.yaml');
    expect(stdout).toContain('evals/composition-placeholder/checks.yaml');
    expect(stdout).toMatch(/composition scenario/);
  });

  it('plugin mode with a single component: emits no composition-placeholder', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(initDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' }),
    );
    await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
    await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const entries = await readdir(join(initDir, 'evals'));
    expect(entries).toContain('skill-alpha-placeholder');
    expect(entries).not.toContain('composition-placeholder');
  });

  it('plugin mode without discoverable skills: still emits plugins: [.]', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(join(initDir, '.claude-plugin', 'plugin.json'), '{}');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
    const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
    expect(content).toMatch(/#\s*plugins:[\s\S]*?#\s*-\s*\./);
    expect(content).not.toMatch(/#\s*skills:/);
  });

  it('plugin mode without discoverable components: creates no evals/ directory', async () => {
    const initDir = join(tmpDir, 'my-plugin');
    await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
    await writeFile(join(initDir, '.claude-plugin', 'plugin.json'), '{}');

    await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);

    const entries = await readdir(initDir);
    expect(entries).not.toContain('evals');
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

  describe('scaffold quality (anti-pattern / staleness / docs)', () => {
    async function scaffoldTwoComponentPlugin(): Promise<string> {
      const initDir = join(tmpDir, 'my-plugin');
      await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(initDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-plugin' }),
      );
      await mkdir(join(initDir, 'skills', 'alpha'), { recursive: true });
      await writeFile(join(initDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
      await mkdir(join(initDir, 'agents'), { recursive: true });
      await writeFile(
        join(initDir, 'agents', 'note-summarizer.md'),
        '---\nname: note-summarizer\n---\n',
      );
      await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
      return initDir;
    }

    it('composition example check is a single, correctly-shaped cross-component interaction (not compound)', async () => {
      const initDir = await scaffoldTwoComponentPlugin();
      const checksRaw = await readFile(
        join(initDir, 'evals', 'composition-placeholder', 'checks.yaml'),
        'utf8',
      );
      // correct transcript field shape, matching the per-component placeholders
      expect(checksRaw).toMatch(/input\.skill:\s*<plugin>:/);
      expect(checksRaw).toMatch(/input\.subagent_type:\s*<plugin>:/);
      // a single ordering relation tying the two components together (not "A AND B")
      expect(checksRaw).toMatch(/appears after|after a `tool:/);
    });

    it('additional_tools example names a current tool, not the superseded TodoWrite', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
      const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      expect(content).toMatch(/#\s*-\s*WebSearch/);
      expect(content).not.toMatch(/TodoWrite/);
    });

    it('composition scenario comment routes single-component scenarios to the per-skill suite', async () => {
      const initDir = await scaffoldTwoComponentPlugin();
      const scenarioRaw = await readFile(
        join(initDir, 'evals', 'composition-placeholder', 'scenario.yaml'),
        'utf8',
      );
      expect(scenarioRaw).toMatch(/per-skill suite/i);
    });

    it('main --help documents init plugin-mode placeholder scaffolding', async () => {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--help']);
      expect(stdout).toMatch(/plugin mode/i);
      expect(stdout).toMatch(/placeholder/i);
      expect(stdout).toMatch(/composition/i);
    });

    it('init --help describes plugin-mode placeholder scaffolding', async () => {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', '--help']);
      expect(stdout).toMatch(/per-component placeholder/i);
    });

    it('init --help describes incremental behavior', async () => {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, 'init', '--help']);
      expect(stdout).toMatch(/incremental|skip|already exist/i);
    });

    it('main --help describes init as incremental and does not attribute exit 1 to init', async () => {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--help']);
      expect(stdout).toMatch(
        /skips (components|scenarios|artifacts)|already covered|safe to re-run/i,
      );
      expect(stdout).not.toMatch(/init won't overwrite/);
    });
  });

  describe('scaffold YAML indentation', () => {
    it('skill mode: uncommented project.skills nests correctly under scenarios.base.project', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await mkdir(initDir, { recursive: true });
      await writeFile(join(initDir, 'SKILL.md'), '---\nname: my-skill\n---\n# My Skill\n');

      await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
      const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      const parsed = parse(uncommentProjectBlock(content)) as {
        scenarios?: { base?: { project?: { skills?: unknown } } };
      };
      expect(parsed?.scenarios?.base?.project?.skills).toEqual(['.']);
    });

    it('plugin mode: uncommented project.plugins nests correctly under scenarios.base.project', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(initDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-plugin' }),
      );

      await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
      const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      const parsed = parse(uncommentProjectBlock(content)) as {
        scenarios?: { base?: { project?: { plugins?: unknown } } };
      };
      expect(parsed?.scenarios?.base?.project?.plugins).toEqual(['.']);
    });

    it('generic mode: uncommented project.skills nests correctly under scenarios.base.project', async () => {
      const initDir = join(tmpDir, 'just-a-dir');

      await execFileAsync(process.execPath, [CLI_PATH, 'init', initDir]);
      const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      const parsed = parse(uncommentProjectBlock(content)) as {
        scenarios?: { base?: { project?: { skills?: unknown } } };
      };
      expect(parsed?.scenarios?.base?.project?.skills).toEqual(['/absolute/path/to/skill']);
    });
  });

  describe('incremental behavior', () => {
    async function makePlugin(initDir: string, skillIds: string[]): Promise<void> {
      await mkdir(join(initDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(initDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-plugin' }),
      );
      for (const id of skillIds) {
        await mkdir(join(initDir, 'skills', id), { recursive: true });
        await writeFile(join(initDir, 'skills', id, 'SKILL.md'), `---\nname: ${id}\n---`);
      }
    }

    it('skips a skill placeholder when a coverage-pattern scenario exists for it', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);
      await mkdir(join(initDir, 'evals', 'skill-alpha-tests'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'skill-alpha-tests', 'scenario.yaml'), 'prompt: x\n');

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).not.toContain('skill-alpha-placeholder');
      expect(entries).toContain('skill-beta-placeholder');
      expect(stdout).toContain('evals/skill-beta-placeholder/scenario.yaml');
      expect(stdout).toMatch(/skill alpha.*evals\/skill-alpha-tests/);
      expect(
        await readFile(join(initDir, 'evals', 'skill-alpha-tests', 'scenario.yaml'), 'utf8'),
      ).toBe('prompt: x\n');
    });

    it('skips the hooks placeholder when a hooks-* scenario exists', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, []);
      await mkdir(join(initDir, 'hooks'), { recursive: true });
      await writeFile(join(initDir, 'hooks', 'hooks.json'), '{}');
      await writeFile(join(initDir, '.mcp.json'), '{}');
      await mkdir(join(initDir, 'evals', 'hooks-deny-write'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'hooks-deny-write', 'scenario.yaml'), 'prompt: x\n');

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).not.toContain('hooks-placeholder');
      expect(entries).toContain('mcp-servers-placeholder');
      expect(stdout).toMatch(/hooks.*evals\/hooks-deny-write/);
    });

    it('skips the composition placeholder when a composition-* scenario exists', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);
      await mkdir(join(initDir, 'evals', 'composition-smoke'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'composition-smoke', 'scenario.yaml'), 'prompt: x\n');

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).not.toContain('composition-placeholder');
      expect(entries).toContain('skill-alpha-placeholder');
      expect(entries).toContain('skill-beta-placeholder');
      expect(stdout).not.toMatch(/composition scenario/);
      expect(stdout).toMatch(/composition.*evals\/composition-smoke/);
    });

    it('skips a skill placeholder when the skill has a nested evals suite', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);
      await mkdir(join(initDir, 'skills', 'alpha', 'evals', 'smoke'), { recursive: true });
      await writeFile(
        join(initDir, 'skills', 'alpha', 'evals', 'smoke', 'scenario.yaml'),
        'prompt: x\n',
      );

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).not.toContain('skill-alpha-placeholder');
      expect(entries).toContain('skill-beta-placeholder');
      expect(stdout).toMatch(/skill alpha.*skills\/alpha\/evals/);
    });

    it('skips a placeholder whose exact target directory already exists, even when empty', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha']);
      await mkdir(join(initDir, 'evals', 'skill-alpha-placeholder'), { recursive: true });

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals', 'skill-alpha-placeholder'));
      expect(entries).toEqual([]);
      expect(stdout).toMatch(/skill alpha/);
    });

    it('skips the composition placeholder when its target directory already exists', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);
      await mkdir(join(initDir, 'evals', 'composition-placeholder'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'composition-placeholder', 'checks.yaml'), '# mine\n');

      const { code } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals', 'composition-placeholder'));
      expect(entries).toEqual(['checks.yaml']);
      expect(
        await readFile(join(initDir, 'evals', 'composition-placeholder', 'checks.yaml'), 'utf8'),
      ).toBe('# mine\n');
    });

    it('honours scenarios.path from an existing evals.yaml for detection and scaffolding', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);
      await writeFile(
        join(initDir, 'evals.yaml'),
        stringify({ version: '1', scenarios: { path: 'cases', base: {} } }),
      );
      await mkdir(join(initDir, 'cases', 'skill-alpha-x'), { recursive: true });
      await writeFile(join(initDir, 'cases', 'skill-alpha-x', 'scenario.yaml'), 'prompt: x\n');

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'cases'));
      expect(entries).not.toContain('skill-alpha-placeholder');
      expect(entries).toContain('skill-beta-placeholder');
      expect(stdout).toContain('cases/skill-beta-placeholder/scenario.yaml');
      expect(stdout).toMatch(/skill alpha.*cases\/skill-alpha-x/);
      const rootEntries = await readdir(initDir);
      expect(rootEntries).not.toContain('evals');
    });

    it('falls back to the default scenarios dir when evals.yaml is malformed', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha']);
      const malformed = '{ not yaml: [\n';
      await writeFile(join(initDir, 'evals.yaml'), malformed);

      const { code } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      expect(await readFile(join(initDir, 'evals.yaml'), 'utf8')).toBe(malformed);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).toContain('skill-alpha-placeholder');
    });

    it('is a full no-op on a second run: exit 0, no Created header, no Next steps', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha', 'beta']);

      const first = await runAndCapture(['init', initDir]);
      expect(first.code).toBe(0);
      const evalsYamlAfterFirst = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      const scenarioAfterFirst = await readFile(
        join(initDir, 'evals', 'skill-alpha-placeholder', 'scenario.yaml'),
        'utf8',
      );

      const second = await runAndCapture(['init', initDir]);

      expect(second.code).toBe(0);
      expect(second.stdout).toMatch(/nothing to scaffold/i);
      expect(second.stdout).not.toContain('Created');
      expect(second.stdout).not.toContain('Next steps');
      expect(await readFile(join(initDir, 'evals.yaml'), 'utf8')).toBe(evalsYamlAfterFirst);
      expect(
        await readFile(join(initDir, 'evals', 'skill-alpha-placeholder', 'scenario.yaml'), 'utf8'),
      ).toBe(scenarioAfterFirst);
    });

    it('does not let a coverage match cross a dash boundary', async () => {
      const initDir = join(tmpDir, 'my-plugin');
      await makePlugin(initDir, ['alpha']);
      await mkdir(join(initDir, 'evals', 'skill-alphabet'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'skill-alphabet', 'scenario.yaml'), 'prompt: x\n');

      const { code } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      const entries = await readdir(join(initDir, 'evals'));
      expect(entries).toContain('skill-alpha-placeholder');
    });

    it('leaves an existing evals.yaml untouched and reports it as skipped', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await mkdir(initDir);
      const original = stringify({ version: '1', scenarios: { base: {} } });
      await writeFile(join(initDir, 'evals.yaml'), original);

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      expect(await readFile(join(initDir, 'evals.yaml'), 'utf8')).toBe(original);
      expect(stdout).toMatch(/skipped|already present|nothing to scaffold/i);
      expect(stdout).toContain('evals.yaml');
    });

    it('scaffolds evals.yaml alongside existing scenarios without touching them', async () => {
      const initDir = join(tmpDir, 'my-skill');
      await mkdir(join(initDir, 'evals', 'alpha'), { recursive: true });
      await writeFile(join(initDir, 'evals', 'alpha', 'scenario.yaml'), 'prompt: x\n');

      const { code, stdout } = await runAndCapture(['init', initDir]);

      expect(code).toBe(0);
      expect(stdout).toContain('evals.yaml');
      const content = await readFile(join(initDir, 'evals.yaml'), 'utf8');
      expect(parse(content)).toHaveProperty('version', '1');
      expect(await readFile(join(initDir, 'evals', 'alpha', 'scenario.yaml'), 'utf8')).toBe(
        'prompt: x\n',
      );
    });
  });
});

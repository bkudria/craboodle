import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { makeTmpDir } from './_fixtures.js';

describe('prepareRun', () => {
  let sourceParent: string;
  let trackedParents: string[];

  beforeEach(async () => {
    sourceParent = await makeTmpDir('prepare-run');
    trackedParents = [];
  });

  afterEach(async () => {
    for (const p of trackedParents) {
      await rm(p, { recursive: true, force: true });
    }
    await rm(sourceParent, { recursive: true, force: true });
  });

  async function makeRoot(
    name: string,
    contents: { evalsYaml: unknown; scenarios: Record<string, unknown> },
  ): Promise<string> {
    const root = join(sourceParent, name);
    await mkdir(root);
    await writeFile(join(root, 'evals.yaml'), stringify(contents.evalsYaml));
    await mkdir(join(root, 'evals'));
    for (const [id, scenarioYaml] of Object.entries(contents.scenarios)) {
      await mkdir(join(root, 'evals', id));
      await writeFile(join(root, 'evals', id, 'scenario.yaml'), stringify(scenarioYaml));
    }
    return root;
  }

  async function call(root: string): Promise<{
    scenarios: Array<{ id: string; configPath: string; dir: string }>;
    basePath: string;
    stagedRoot: string;
    parent: string;
    pipeline: {
      version: string;
      minPassRate?: number;
      maxBudgetUsd?: number;
      repeats?: number;
      artifactRetentionDays?: number;
    };
  }> {
    const { prepareRun } = await import('../src/prepare-run.js');
    const result = await prepareRun(root);
    trackedParents.push(result.parent);
    return result;
  }

  it('returns the discovered scenarios from the original root', async () => {
    const root = await makeRoot('my-skill', {
      evalsYaml: { version: '1', scenarios: { base: {} } },
      scenarios: {
        'scenario-a': { prompt: 'hi' },
        'scenario-b': { prompt: 'hi' },
      },
    });

    const { scenarios } = await call(root);

    expect(scenarios.map((s) => s.id).sort()).toEqual(['scenario-a', 'scenario-b']);
    // configPath should point at the ORIGINAL files, not the staged view
    expect(scenarios[0].configPath).toBe(join(root, 'evals', 'scenario-a', 'scenario.yaml'));
  });

  it('returns a stagedRoot under a craboodle-staged-* parent with basename preserved', async () => {
    const root = await makeRoot('cool-plugin', {
      evalsYaml: { version: '1', scenarios: { base: {} } },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { stagedRoot, parent } = await call(root);

    expect(basename(stagedRoot)).toBe('cool-plugin');
    expect(dirname(stagedRoot)).toBe(parent);
    expect(basename(parent)).toMatch(/^craboodle-staged-/);
  });

  it('writes basePath at <stagedRoot>/.craboodle-base.yaml', async () => {
    const root = await makeRoot('thing', {
      evalsYaml: { version: '1', scenarios: { base: { model: 'claude-haiku-4-5' } } },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { basePath, stagedRoot } = await call(root);

    expect(basePath).toBe(join(stagedRoot, '.craboodle-base.yaml'));
    const written = parse(await readFile(basePath, 'utf8'));
    expect(written).toMatchObject({ model: 'claude-haiku-4-5' });
  });

  it('passes scenariosBase through unchanged when it has no project.skills', async () => {
    const root = await makeRoot('thing', {
      evalsYaml: {
        version: '1',
        scenarios: {
          base: { user: { max_turns: 5 }, tools: ['Read', 'Write'] },
        },
      },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { basePath } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as Record<string, unknown>;
    expect(written).toEqual({ user: { max_turns: 5 }, tools: ['Read', 'Write'] });
  });

  it("rewrites a skill of '.' to the staged root", async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: {
        version: '1',
        scenarios: { base: { project: { skills: ['.'] } } },
      },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { basePath, stagedRoot } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as {
      project: { skills: string[] };
    };
    expect(written.project.skills).toEqual([stagedRoot]);
  });

  it('rewrites a relative skill path to an absolute path inside the staged root', async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: {
        version: '1',
        scenarios: { base: { project: { skills: ['./sub-skill', 'sub-skill-2'] } } },
      },
      scenarios: { only: { prompt: 'hi' } },
    });
    await mkdir(join(root, 'sub-skill'));
    await mkdir(join(root, 'sub-skill-2'));

    const { basePath, stagedRoot } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as {
      project: { skills: string[] };
    };
    expect(written.project.skills).toEqual([
      join(stagedRoot, 'sub-skill'),
      join(stagedRoot, 'sub-skill-2'),
    ]);
  });

  it('rewrites an absolute path inside the original root to its staged equivalent', async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: { version: '1', scenarios: { base: {} } },
      scenarios: { only: { prompt: 'hi' } },
    });
    await mkdir(join(root, 'sub'));
    // Re-write the evals.yaml to include the absolute-inside-root skill path
    await writeFile(
      join(root, 'evals.yaml'),
      stringify({
        version: '1',
        scenarios: {
          base: {
            project: { skills: [join(root, 'sub'), root] },
          },
        },
      }),
    );

    const { basePath, stagedRoot } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as {
      project: { skills: string[] };
    };
    expect(written.project.skills).toEqual([join(stagedRoot, 'sub'), stagedRoot]);
  });

  it('passes absolute-out-of-root and ~ paths through unchanged', async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: { version: '1', scenarios: { base: {} } },
      scenarios: { only: { prompt: 'hi' } },
    });
    const outside = await makeTmpDir('prepare-run', 'outside');
    try {
      await writeFile(
        join(root, 'evals.yaml'),
        stringify({
          version: '1',
          scenarios: {
            base: { project: { skills: [outside, '~/some/path'] } },
          },
        }),
      );

      const { basePath } = await call(root);
      const written = parse(await readFile(basePath, 'utf8')) as {
        project: { skills: string[] };
      };
      expect(written.project.skills).toEqual([outside, '~/some/path']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not error if project is present but skills is absent', async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: {
        version: '1',
        scenarios: { base: { project: { claude_md: '# hi' } } },
      },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { basePath } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as Record<string, unknown>;
    expect(written.project).toEqual({ claude_md: '# hi' });
  });

  it('exposes top-level pipeline fields including version', async () => {
    const root = await makeRoot('rooty', {
      evalsYaml: {
        version: '1',
        min_pass_rate: 0.5,
        max_budget_usd: 2.0,
        repeats: 7,
        artifact_retention_days: 14,
        scenarios: { base: {} },
      },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { pipeline } = await call(root);
    expect(pipeline).toMatchObject({
      version: '1',
      minPassRate: 0.5,
      maxBudgetUsd: 2.0,
      repeats: 7,
      artifactRetentionDays: 14,
    });
  });

  it('uses the configured scenariosPath when discovering and excluding', async () => {
    const sourceRoot = join(sourceParent, 'rooty');
    await mkdir(sourceRoot);
    await writeFile(
      join(sourceRoot, 'evals.yaml'),
      stringify({
        version: '1',
        scenarios: { path: 'my-evals', base: {} },
      }),
    );
    await mkdir(join(sourceRoot, 'my-evals'));
    await mkdir(join(sourceRoot, 'my-evals', 'only'));
    await writeFile(
      join(sourceRoot, 'my-evals', 'only', 'scenario.yaml'),
      stringify({ prompt: 'hi' }),
    );

    const { scenarios, stagedRoot } = await call(sourceRoot);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('only');
    // The staged view should NOT contain 'my-evals/'
    const { access } = await import('node:fs/promises');
    await expect(access(join(stagedRoot, 'my-evals'))).rejects.toThrow();
  });

  it('does not error when ~ expansion is needed but the path is left literal', async () => {
    // Sanity: the helper should not crash trying to expand ~; that's scuttlerun's job.
    const root = await makeRoot('rooty', {
      evalsYaml: {
        version: '1',
        scenarios: { base: { project: { skills: ['~/never-touched'] } } },
      },
      scenarios: { only: { prompt: 'hi' } },
    });

    const { basePath } = await call(root);
    const written = parse(await readFile(basePath, 'utf8')) as {
      project: { skills: string[] };
    };
    expect(written.project.skills).toEqual(['~/never-touched']);
    // Just confirm the helper didn't accidentally expand it
    expect(written.project.skills[0]).not.toContain(homedir());
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { coversComponentKey, filterScenarios, type ScenarioRef } from '../src/discovery.js';
import { makeTmpDir } from './_fixtures.js';

describe('discovery', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('discovery');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('discovers scenario directories under <root>/<scenariosPath>', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'scenario-a'));
    await writeFile(join(tmpDir, 'evals', 'scenario-a', 'scenario.yaml'), 'prompt: hi\n');
    await mkdir(join(tmpDir, 'evals', 'scenario-b'));
    await writeFile(join(tmpDir, 'evals', 'scenario-b', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].id).toBe('scenario-a');
    expect(scenarios[1].id).toBe('scenario-b');
    expect(scenarios[0].configPath).toBe(join(tmpDir, 'evals', 'scenario-a', 'scenario.yaml'));
  });

  it("defaults scenariosPath to 'evals' when omitted", async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'only'));
    await writeFile(join(tmpDir, 'evals', 'only', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('only');
  });

  it('honours a custom scenariosPath', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'my-evals'));
    await mkdir(join(tmpDir, 'my-evals', 'custom'));
    await writeFile(join(tmpDir, 'my-evals', 'custom', 'scenario.yaml'), 'prompt: hi\n');
    // Also write a stale 'evals/' tree that the default would have picked up
    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'stale'));
    await writeFile(join(tmpDir, 'evals', 'stale', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'my-evals');

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('custom');
  });

  it('sorts scenarios alphabetically by ID', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'zebra'));
    await writeFile(join(tmpDir, 'evals', 'zebra', 'scenario.yaml'), 'prompt: hi\n');
    await mkdir(join(tmpDir, 'evals', 'alpha'));
    await writeFile(join(tmpDir, 'evals', 'alpha', 'scenario.yaml'), 'prompt: hi\n');
    await mkdir(join(tmpDir, 'evals', 'middle'));
    await writeFile(join(tmpDir, 'evals', 'middle', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios.map((s) => s.id)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('returns empty array when scenariosPath has no scenarios', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');
    await mkdir(join(tmpDir, 'evals'));

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toEqual([]);
  });

  it('returns empty array when scenariosPath does not exist', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toEqual([]);
  });

  it('ignores directories without scenario.yaml', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'has-scenario'));
    await writeFile(join(tmpDir, 'evals', 'has-scenario', 'scenario.yaml'), 'prompt: hi\n');
    await mkdir(join(tmpDir, 'evals', 'no-scenario'));
    await writeFile(join(tmpDir, 'evals', 'no-scenario', 'other.yaml'), 'foo: bar\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('has-scenario');
  });

  it('discovers scenario directories with .yml extension', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'yaml-ext'));
    await writeFile(join(tmpDir, 'evals', 'yaml-ext', 'scenario.yaml'), 'prompt: hi\n');
    await mkdir(join(tmpDir, 'evals', 'yml-ext'));
    await writeFile(join(tmpDir, 'evals', 'yml-ext', 'scenario.yml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toHaveLength(2);
    expect(scenarios.map((s) => s.id)).toEqual(['yaml-ext', 'yml-ext']);
  });

  it('ignores files at scenariosPath root', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    await mkdir(join(tmpDir, 'evals'));
    await writeFile(join(tmpDir, 'evals', 'README.md'), 'unrelated\n');
    await mkdir(join(tmpDir, 'evals', 'scenario-a'));
    await writeFile(join(tmpDir, 'evals', 'scenario-a', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toHaveLength(1);
  });

  it('ignores entries in the root that are not under scenariosPath', async () => {
    const { discoverScenarios } = await import('../src/discovery.js');

    // Top-level look-alike that must NOT be picked up
    await mkdir(join(tmpDir, 'pretend-scenario'));
    await writeFile(join(tmpDir, 'pretend-scenario', 'scenario.yaml'), 'prompt: hi\n');
    // Real scenario under evals/
    await mkdir(join(tmpDir, 'evals'));
    await mkdir(join(tmpDir, 'evals', 'real'));
    await writeFile(join(tmpDir, 'evals', 'real', 'scenario.yaml'), 'prompt: hi\n');

    const scenarios = await discoverScenarios(tmpDir, 'evals');

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('real');
  });
});

describe('coversComponentKey', () => {
  it('matches the key exactly', () => {
    expect(coversComponentKey('skill-alpha', 'skill-alpha')).toBe(true);
  });

  it('matches a dash-suffixed prefix', () => {
    expect(coversComponentKey('skill-alpha-tests', 'skill-alpha')).toBe(true);
    expect(coversComponentKey('skill-alpha-placeholder', 'skill-alpha')).toBe(true);
  });

  it('does not match across a dash boundary', () => {
    expect(coversComponentKey('skill-alphabet', 'skill-alpha')).toBe(false);
  });

  it('matches singleton keys exactly and by dash prefix', () => {
    expect(coversComponentKey('hooks', 'hooks')).toBe(true);
    expect(coversComponentKey('hooks-deny-write', 'hooks')).toBe(true);
    expect(coversComponentKey('hooksmith', 'hooks')).toBe(false);
    expect(coversComponentKey('mcp-servers-placeholder', 'mcp-servers')).toBe(true);
  });

  it('matches the composition key', () => {
    expect(coversComponentKey('composition', 'composition')).toBe(true);
    expect(coversComponentKey('composition-smoke', 'composition')).toBe(true);
  });

  it('does not match unrelated ids', () => {
    expect(coversComponentKey('agent-alpha', 'skill-alpha')).toBe(false);
    expect(coversComponentKey('regression-baseline', 'skill-alpha')).toBe(false);
  });
});

describe('filterScenarios', () => {
  const scenarios: ScenarioRef[] = [
    {
      id: 'email-validator',
      dir: '/tmp/email-validator',
      configPath: '/tmp/email-validator/scenario.yaml',
    },
    { id: 'email-parser', dir: '/tmp/email-parser', configPath: '/tmp/email-parser/scenario.yaml' },
    { id: 'url-parser', dir: '/tmp/url-parser', configPath: '/tmp/url-parser/scenario.yaml' },
  ];

  it('filters by exact match', () => {
    const result = filterScenarios(scenarios, 'email-validator');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('email-validator');
  });

  it('filters by glob wildcard', () => {
    const result = filterScenarios(scenarios, 'email-*');
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(['email-validator', 'email-parser']);
  });

  it('filters by comma-separated list', () => {
    const result = filterScenarios(scenarios, 'email-validator,url-parser');
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(['email-validator', 'url-parser']);
  });

  it('supports comma-separated globs', () => {
    const result = filterScenarios(scenarios, 'email-*,url-*');
    expect(result).toHaveLength(3);
  });

  it('returns empty array when nothing matches', () => {
    const result = filterScenarios(scenarios, 'nonexistent');
    expect(result).toEqual([]);
  });

  it('handles whitespace around commas', () => {
    const result = filterScenarios(scenarios, 'email-validator , url-parser');
    expect(result).toHaveLength(2);
  });

  describe('regex metacharacter escaping in wildcard patterns', () => {
    const metaScenarios: ScenarioRef[] = [
      { id: 'a.b', dir: '/tmp/a.b', configPath: '/tmp/a.b/scenario.yaml' },
      { id: 'aXb', dir: '/tmp/aXb', configPath: '/tmp/aXb/scenario.yaml' },
      { id: 'a+b', dir: '/tmp/a+b', configPath: '/tmp/a+b/scenario.yaml' },
      { id: 'aab', dir: '/tmp/aab', configPath: '/tmp/aab/scenario.yaml' },
      { id: 'x.y', dir: '/tmp/x.y', configPath: '/tmp/x.y/scenario.yaml' },
      { id: 'x_y', dir: '/tmp/x_y', configPath: '/tmp/x_y/scenario.yaml' },
    ];

    it('does not treat literal `.` as a wildcard', () => {
      // Pattern `a.*` should anchor on a literal dot, then any suffix
      const result = filterScenarios(metaScenarios, 'a.*');
      expect(result.map((s) => s.id)).toEqual(['a.b']);
    });

    it('does not treat literal `+` as a quantifier', () => {
      const result = filterScenarios(metaScenarios, 'a+*');
      expect(result.map((s) => s.id)).toEqual(['a+b']);
    });

    it('matches a literal dot inside an exact pattern', () => {
      // No `*` → exact-match fast path; not affected by regex
      const result = filterScenarios(metaScenarios, 'x.y');
      expect(result.map((s) => s.id)).toEqual(['x.y']);
    });

    it('does not throw SyntaxError on unbalanced metacharacters', () => {
      // Previously: `a(` + `*` → regex `^a(.*$` → invalid → SyntaxError
      expect(() => filterScenarios(metaScenarios, 'a(*')).not.toThrow();
    });
  });
});

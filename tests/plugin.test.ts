import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';

describe('plugin', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('plugin');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe('loadPluginManifest', () => {
    it('parses a minimal manifest with only name', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(tmpDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-plugin' }),
      );
      const manifest = await loadPluginManifest(tmpDir);
      expect(manifest.name).toBe('my-plugin');
    });

    it('throws with the file path when plugin.json is missing', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await expect(loadPluginManifest(tmpDir)).rejects.toThrow(/plugin\.json/);
    });

    it('throws when plugin.json contains malformed JSON', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), '{ not valid json');
      await expect(loadPluginManifest(tmpDir)).rejects.toThrow(/plugin\.json/);
    });

    it('throws when the name field is missing', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(tmpDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ version: '1.0.0' }),
      );
      await expect(loadPluginManifest(tmpDir)).rejects.toThrow();
    });

    it('throws when the name field is empty', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: '' }));
      await expect(loadPluginManifest(tmpDir)).rejects.toThrow();
    });

    it('round-trips all known optional metadata fields', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      const input = {
        name: 'claudecraft',
        description: 'A plugin for crafting things.',
        version: '0.2.0',
        license: 'MIT',
        repository: 'https://github.com/example/repo',
        homepage: 'https://example.com',
        keywords: ['skills', 'plugins'],
        author: { name: 'Jane Doe', email: 'jane@example.com' },
      };
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), JSON.stringify(input));
      const manifest = await loadPluginManifest(tmpDir);
      expect(manifest).toMatchObject(input);
    });

    it('accepts a string-form author field', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(tmpDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'p', author: 'Jane Doe <jane@example.com>' }),
      );
      const manifest = await loadPluginManifest(tmpDir);
      expect(manifest.author).toBe('Jane Doe <jane@example.com>');
    });

    it('preserves unknown top-level fields (forward-compatible)', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(tmpDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'p', futureField: { nested: true } }),
      );
      const manifest = await loadPluginManifest(tmpDir);
      expect((manifest as Record<string, unknown>).futureField).toEqual({ nested: true });
    });
  });

  describe('enumeratePluginComponents', () => {
    it('returns all-empty result when no component dirs or files exist', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components).toEqual({
        skills: [],
        agents: [],
        commands: [],
        hasHooks: false,
        hasMcpServers: false,
      });
    });

    it('lists skills sorted alphabetically from skills/<id>/SKILL.md', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'skills', 'zebra'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'zebra', 'SKILL.md'), '---\nname: zebra\n---\n');
      await mkdir(join(tmpDir, 'skills', 'alpha'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n');
      await mkdir(join(tmpDir, 'skills', 'mango'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'mango', 'SKILL.md'), '---\nname: mango\n---\n');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.skills).toEqual(['alpha', 'mango', 'zebra']);
    });

    it('excludes skills/ subdirectories that lack a SKILL.md', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'skills', 'real'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'real', 'SKILL.md'), '');
      await mkdir(join(tmpDir, 'skills', 'not-a-skill'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'not-a-skill', 'readme.md'), 'no skill md here');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.skills).toEqual(['real']);
    });

    it('ignores non-directory entries inside skills/', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'skills'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', '.DS_Store'), 'mac noise');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.skills).toEqual([]);
    });

    it('lists agents sorted alphabetically from agents/<id>.md', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'agents'), { recursive: true });
      await writeFile(join(tmpDir, 'agents', 'reviewer.md'), '---\nname: reviewer\n---');
      await writeFile(join(tmpDir, 'agents', 'auditor.md'), '---\nname: auditor\n---');
      await writeFile(join(tmpDir, 'agents', 'README.txt'), 'not an agent');
      await mkdir(join(tmpDir, 'agents', 'subdir'), { recursive: true });
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.agents).toEqual(['auditor', 'reviewer']);
    });

    it('lists commands sorted alphabetically from commands/<id>.md', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'commands'), { recursive: true });
      await writeFile(join(tmpDir, 'commands', 'deploy.md'), '# deploy');
      await writeFile(join(tmpDir, 'commands', 'build.md'), '# build');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.commands).toEqual(['build', 'deploy']);
    });

    it('reports hasHooks=true when hooks/hooks.json exists', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'hooks'), { recursive: true });
      await writeFile(join(tmpDir, 'hooks', 'hooks.json'), '{}');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.hasHooks).toBe(true);
    });

    it('reports hasHooks=false when only hooks/ dir exists without hooks.json', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await mkdir(join(tmpDir, 'hooks'), { recursive: true });
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.hasHooks).toBe(false);
    });

    it('reports hasMcpServers=true when .mcp.json exists at plugin root', async () => {
      const { enumeratePluginComponents } = await import('../src/plugin.js');
      await writeFile(join(tmpDir, '.mcp.json'), '{"mcpServers":{}}');
      const components = await enumeratePluginComponents(tmpDir);
      expect(components.hasMcpServers).toBe(true);
    });
  });
});

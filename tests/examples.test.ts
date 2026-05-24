import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const NOTE_TAKER_ROOT = join(__dirname, '..', 'examples', 'note-taker');

async function readFrontmatter(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, 'utf8');
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    throw new Error(`${path}: expected frontmatter to start with --- on line 1`);
  }
  const closeIndex = lines.indexOf('---', 1);
  if (closeIndex === -1) {
    throw new Error(`${path}: unterminated frontmatter`);
  }
  const yamlContent = lines.slice(1, closeIndex).join('\n');
  const parsed = parseYaml(yamlContent);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: frontmatter must parse to a mapping`);
  }
  return parsed as Record<string, unknown>;
}

describe('note-taker plugin fixture', () => {
  describe('plugin manifest', () => {
    it('has a valid manifest with required fields', async () => {
      const { loadPluginManifest } = await import('../src/plugin.js');
      const manifest = await loadPluginManifest(NOTE_TAKER_ROOT);
      expect(manifest.name).toBe('note-taker');
      expect(typeof manifest.description).toBe('string');
      expect((manifest.description ?? '').length).toBeGreaterThan(20);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('take-notes skill', () => {
    it('ships at skills/take-notes/SKILL.md with valid frontmatter', async () => {
      const fm = await readFrontmatter(join(NOTE_TAKER_ROOT, 'skills', 'take-notes', 'SKILL.md'));
      expect(fm.name).toBe('take-notes');
      expect(typeof fm.description).toBe('string');
      expect((fm.description as string).length).toBeGreaterThan(30);
    });
  });

  describe('note-summarizer sub-agent', () => {
    it('ships at agents/note-summarizer.md with valid frontmatter', async () => {
      const fm = await readFrontmatter(join(NOTE_TAKER_ROOT, 'agents', 'note-summarizer.md'));
      expect(fm.name).toBe('note-summarizer');
      expect(typeof fm.description).toBe('string');
      expect((fm.description as string).length).toBeGreaterThan(30);
      expect(['sonnet', 'haiku', 'opus']).toContain(fm.model);
    });
  });

  describe('evals.yaml', () => {
    it('loads with project.plugins: [.] and plugin-mode detection', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      const cfg = await loadEvalsConfig(NOTE_TAKER_ROOT);
      expect(cfg.version).toBe('1');
      expect(cfg.mode).toBe('plugin');
      expect(cfg.plugin?.manifest.name).toBe('note-taker');
      const project = cfg.scenariosBase.project;
      expect(project).toBeDefined();
      expect((project as Record<string, unknown>).plugins).toEqual(['.']);
    });
  });

  describe('scenario: takes-notes (skill-only)', () => {
    const dir = join(NOTE_TAKER_ROOT, 'evals', 'takes-notes');

    it('has a parseable scenario.yaml with a prompt', async () => {
      const raw = await readFile(join(dir, 'scenario.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      expect(typeof parsed.prompt).toBe('string');
      expect((parsed.prompt as string).length).toBeGreaterThan(20);
    });

    it('has a checks.yaml with at least 3 check entries each shaped correctly', async () => {
      const raw = await readFile(join(dir, 'checks.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const checks = parsed.checks as Array<Record<string, Record<string, unknown>>>;
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThanOrEqual(3);
      for (const wrapper of checks) {
        const ids = Object.keys(wrapper);
        expect(ids.length).toBe(1);
        const body = wrapper[ids[0]];
        expect(typeof body.check).toBe('string');
        expect((body.check as string).length).toBeGreaterThan(0);
      }
    });
  });

  describe('scenario: summarizes-notes (sub-agent-only)', () => {
    const dir = join(NOTE_TAKER_ROOT, 'evals', 'summarizes-notes');

    it('has a parseable scenario.yaml that fixtures a notes.md via project.files', async () => {
      const raw = await readFile(join(dir, 'scenario.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      expect(typeof parsed.prompt).toBe('string');
      const project = parsed.project as Record<string, unknown> | undefined;
      const files = project?.files as Record<string, string> | undefined;
      expect(files).toBeDefined();
      expect(typeof files?.['notes.md']).toBe('string');
      expect((files?.['notes.md'] as string).length).toBeGreaterThan(20);
    });

    it('has a checks.yaml with at least 3 check entries each shaped correctly', async () => {
      const raw = await readFile(join(dir, 'checks.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const checks = parsed.checks as Array<Record<string, Record<string, unknown>>>;
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThanOrEqual(3);
      for (const wrapper of checks) {
        const ids = Object.keys(wrapper);
        expect(ids.length).toBe(1);
        const body = wrapper[ids[0]];
        expect(typeof body.check).toBe('string');
      }
    });
  });

  describe('scenario: takes-then-summarizes (cross-component)', () => {
    const dir = join(NOTE_TAKER_ROOT, 'evals', 'takes-then-summarizes');

    it('has a parseable scenario.yaml with a prompt that asks for both capture and summary', async () => {
      const raw = await readFile(join(dir, 'scenario.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      expect(typeof parsed.prompt).toBe('string');
      expect((parsed.prompt as string).length).toBeGreaterThan(40);
    });

    it('has a checks.yaml with at least one check whose note references both components', async () => {
      const raw = await readFile(join(dir, 'checks.yaml'), 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const checks = parsed.checks as Array<Record<string, Record<string, unknown>>>;
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThanOrEqual(3);

      const notes = checks
        .map((wrapper) => {
          const ids = Object.keys(wrapper);
          return wrapper[ids[0]].note;
        })
        .filter((n): n is string => typeof n === 'string');

      const crossComponent = notes.some(
        (n) => n.includes('skills/take-notes') && n.includes('agents/note-summarizer'),
      );
      expect(crossComponent).toBe(true);
    });
  });
});

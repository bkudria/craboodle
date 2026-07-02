import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { makeTmpDir } from './_fixtures.js';

describe('evals-config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('evals-config');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function writeEvals(contents: unknown): Promise<void> {
    await writeFile(join(tmpDir, 'evals.yaml'), stringify(contents));
  }

  describe('loadEvalsConfig', () => {
    it('parses version, pipeline fields, scenarios.path, and scenarios.base', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({
        version: '1',
        min_pass_rate: 0.8,
        max_budget_usd: 5.0,
        repeats: 4,
        artifact_retention_days: 14,
        scenarios: {
          path: 'tests',
          base: { model: 'claude-sonnet-5', tools: ['Read', 'Write'] },
        },
      });

      const config = await loadEvalsConfig(tmpDir);

      expect(config.version).toBe('1');
      expect(config.minPassRate).toBe(0.8);
      expect(config.maxBudgetUsd).toBe(5.0);
      expect(config.repeats).toBe(4);
      expect(config.artifactRetentionDays).toBe(14);
      expect(config.scenariosPath).toBe('tests');
      expect(config.scenariosBase).toEqual({
        model: 'claude-sonnet-5',
        tools: ['Read', 'Write'],
      });
    });

    it("defaults scenarios.path to 'evals' when omitted", async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.scenariosPath).toBe('evals');
    });

    it('accepts an empty scenarios.base object', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.scenariosBase).toEqual({});
    });

    it('throws when evals.yaml is missing', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/evals\.yaml/);
    });

    it('throws when version is missing', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('missing required "version" field');
    });

    it('throws on unsupported version', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '99', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('Unsupported eval format version: 99');
    });

    it('accepts version as a number (coerced to string)', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: 1, scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.version).toBe('1');
    });

    it('throws when scenarios is missing', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1' });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios/);
    });

    it('throws when scenarios.base is missing', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: 'evals' } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.base/);
    });

    it('throws when scenarios is not an object', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: 'oops' });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios/);
    });

    it('throws when scenarios.base is not an object', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: 'oops' } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.base/);
    });

    it('throws when scenarios.path is not a string', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: 42, base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.path/);
    });

    it('throws when scenarios.path is empty', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: '', base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.path/);
    });

    it('throws when scenarios.path contains a forward slash', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: 'tests/evals', base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        /scenarios\.path.*single directory name|single directory name.*scenarios\.path/i,
      );
    });

    it("throws when scenarios.path is '.'", async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: '.', base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.path/);
    });

    it("throws when scenarios.path is '..'", async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { path: '..', base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/scenarios\.path/);
    });

    it('parses a valid auth value', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', auth: 'subscription', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.auth).toBe('subscription');
    });

    it('leaves auth undefined when omitted', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.auth).toBeUndefined();
    });

    it('throws on an invalid auth value', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', auth: 'oauth', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'auth must be one of: auto, subscription, api-key',
      );
    });

    it('throws on a non-string auth value', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', auth: 3, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'auth must be one of: auto, subscription, api-key',
      );
    });

    it('throws on invalid min_pass_rate type', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', min_pass_rate: 'high', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'min_pass_rate must be a number between 0 and 1',
      );
    });

    it('throws on min_pass_rate out of range', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', min_pass_rate: 1.5, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'min_pass_rate must be a number between 0 and 1',
      );
    });

    it('throws on invalid max_budget_usd type', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', max_budget_usd: 'expensive', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'max_budget_usd must be a positive number',
      );
    });

    it('throws on non-positive max_budget_usd', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', max_budget_usd: 0, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'max_budget_usd must be a positive number',
      );
    });

    it('parses max_error_rate into EvalsConfig.maxErrorRate', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({
        version: '1',
        min_pass_rate: 0.8,
        max_error_rate: 0.2,
        scenarios: { base: {} },
      });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.maxErrorRate).toBe(0.2);
    });

    it('accepts max_error_rate: 0 (the strict default value)', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({
        version: '1',
        min_pass_rate: 0.8,
        max_error_rate: 0,
        scenarios: { base: {} },
      });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.maxErrorRate).toBe(0);
    });

    it('accepts max_error_rate: 1', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({
        version: '1',
        min_pass_rate: 0.8,
        max_error_rate: 1,
        scenarios: { base: {} },
      });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.maxErrorRate).toBe(1);
    });

    it('leaves maxErrorRate undefined when absent', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.maxErrorRate).toBeUndefined();
    });

    it('throws on invalid max_error_rate type', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', max_error_rate: 'low', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'max_error_rate must be a number between 0 and 1',
      );
    });

    it('throws on max_error_rate out of range', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', max_error_rate: 1.5, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'max_error_rate must be a number between 0 and 1',
      );
    });

    it('warns when max_error_rate is set without min_pass_rate (gate inert)', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      const writes: string[] = [];
      const warn = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
          return true;
        });
      await writeEvals({ version: '1', max_error_rate: 0.2, scenarios: { base: {} } });
      await loadEvalsConfig(tmpDir);
      warn.mockRestore();
      const joined = writes.join('');
      expect(joined).toMatch(/max_error_rate/);
      expect(joined).toMatch(/min_pass_rate/);
    });

    it('does not warn when max_error_rate and min_pass_rate are both set', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      await writeEvals({
        version: '1',
        min_pass_rate: 0.8,
        max_error_rate: 0.2,
        scenarios: { base: {} },
      });
      await loadEvalsConfig(tmpDir);
      const calls = warn.mock.calls.length;
      warn.mockRestore();
      expect(calls).toBe(0);
    });

    it('throws on non-numeric repeats', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', repeats: 'three', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('repeats must be a positive integer');
    });

    it('throws on non-integer repeats', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', repeats: 1.5, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('repeats must be a positive integer');
    });

    it('throws on non-positive repeats', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', repeats: 0, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('repeats must be a positive integer');
    });

    it('parses top-level timeout into EvalsConfig.timeout', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', timeout: 600, scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.timeout).toBe(600);
    });

    it('leaves config.timeout undefined when absent', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.timeout).toBeUndefined();
    });

    it('throws on non-numeric timeout', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', timeout: 'forever', scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('timeout must be a positive integer');
    });

    it('throws on non-integer timeout', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', timeout: 1.5, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('timeout must be a positive integer');
    });

    it('throws on non-positive timeout', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', timeout: 0, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow('timeout must be a positive integer');
    });

    it('accepts artifact_retention_days: 0 to disable cleanup', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', artifact_retention_days: 0, scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.artifactRetentionDays).toBe(0);
    });

    it('throws on non-integer artifact_retention_days', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', artifact_retention_days: 1.5, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'artifact_retention_days must be a non-negative integer',
      );
    });

    it('throws on negative artifact_retention_days', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', artifact_retention_days: -1, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        'artifact_retention_days must be a non-negative integer',
      );
    });

    it('throws on unknown top-level keys', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', max_budgett_usd: 5.0, scenarios: { base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(
        /unknown.*max_budgett_usd|max_budgett_usd.*unknown/i,
      );
    });

    it('throws on unknown keys inside scenarios', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { paths: 'evals', base: {} } });
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/unknown.*paths|paths.*unknown/i);
    });

    it('throws when evals.yaml top-level is not a mapping', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeFile(join(tmpDir, 'evals.yaml'), '- just\n- a list\n');
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/mapping at the top level/);
    });

    it('treats an empty evals.yaml as missing required fields', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeFile(join(tmpDir, 'evals.yaml'), '');
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/version/);
    });

    it('re-throws non-ENOENT errors when reading evals.yaml', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      // Make evals.yaml a directory so reading it gives EISDIR
      await mkdir(join(tmpDir, 'evals.yaml'));
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow();
    });

    it('detects mode=skill when SKILL.md is at the root', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await writeFile(join(tmpDir, 'SKILL.md'), '---\nname: x\n---\n# X\n');
      const config = await loadEvalsConfig(tmpDir);
      expect(config.mode).toBe('skill');
    });

    it('detects mode=plugin when .claude-plugin/plugin.json is at the root', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await mkdir(join(tmpDir, '.claude-plugin'));
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), '{"name":"x"}');
      const config = await loadEvalsConfig(tmpDir);
      expect(config.mode).toBe('plugin');
    });

    it('prefers mode=plugin when both markers are present', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await writeFile(join(tmpDir, 'SKILL.md'), '---\nname: x\n---\n');
      await mkdir(join(tmpDir, '.claude-plugin'));
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), '{"name":"x"}');
      const config = await loadEvalsConfig(tmpDir);
      expect(config.mode).toBe('plugin');
    });

    it('falls back to mode=generic when neither marker is present', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.mode).toBe('generic');
    });

    it('exposes the parsed manifest and enumerated components in plugin mode', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await mkdir(join(tmpDir, '.claude-plugin'));
      await writeFile(
        join(tmpDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'sample-plugin', version: '1.2.3' }),
      );
      await mkdir(join(tmpDir, 'skills', 'alpha'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---');
      const config = await loadEvalsConfig(tmpDir);
      expect(config.plugin?.manifest.name).toBe('sample-plugin');
      expect(config.plugin?.manifest.version).toBe('1.2.3');
      expect(config.plugin?.components.skills).toEqual(['alpha']);
    });

    it('leaves config.plugin undefined in skill mode', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await writeFile(join(tmpDir, 'SKILL.md'), '---\nname: x\n---\n');
      const config = await loadEvalsConfig(tmpDir);
      expect(config.plugin).toBeUndefined();
    });

    it('leaves config.plugin undefined in generic mode', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.plugin).toBeUndefined();
    });

    it('surfaces malformed plugin.json as a load error', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      await writeEvals({ version: '1', scenarios: { base: {} } });
      await mkdir(join(tmpDir, '.claude-plugin'));
      await writeFile(join(tmpDir, '.claude-plugin', 'plugin.json'), '{ not json');
      await expect(loadEvalsConfig(tmpDir)).rejects.toThrow(/plugin\.json/);
    });

    it('keeps scenarios.base opaque (does not validate scuttlerun fields)', async () => {
      const { loadEvalsConfig } = await import('../src/config.js');
      // Arbitrary nested structure that scuttlerun would interpret; craboodle must
      // pass it through unchanged.
      await writeEvals({
        version: '1',
        scenarios: {
          base: {
            project: { skills: ['.'], claude_md: '# hi' },
            sdk: { plugins: [{ type: 'local', path: '.' }] },
            user: { max_turns: 10 },
            unknown_to_craboodle: 'kept',
          },
        },
      });
      const config = await loadEvalsConfig(tmpDir);
      expect(config.scenariosBase).toEqual({
        project: { skills: ['.'], claude_md: '# hi' },
        sdk: { plugins: [{ type: 'local', path: '.' }] },
        user: { max_turns: 10 },
        unknown_to_craboodle: 'kept',
      });
    });
  });

  describe('DEFAULT_REPEATS', () => {
    it('exports 3 as the canonical default', async () => {
      const { DEFAULT_REPEATS } = await import('../src/config.js');
      expect(DEFAULT_REPEATS).toBe(3);
    });
  });

  describe('resolveRepeats', () => {
    it('falls back to DEFAULT_REPEATS when neither is provided', async () => {
      const { resolveRepeats, DEFAULT_REPEATS } = await import('../src/config.js');
      expect(resolveRepeats(undefined, undefined)).toBe(DEFAULT_REPEATS);
    });
    it('uses the CLI value when only CLI is provided', async () => {
      const { resolveRepeats } = await import('../src/config.js');
      expect(resolveRepeats(5, undefined)).toBe(5);
    });
    it('uses the yaml value when only yaml is provided', async () => {
      const { resolveRepeats } = await import('../src/config.js');
      expect(resolveRepeats(undefined, 7)).toBe(7);
    });
    it('prefers the CLI value when both are provided', async () => {
      const { resolveRepeats } = await import('../src/config.js');
      expect(resolveRepeats(5, 7)).toBe(5);
    });
  });

  describe('resolveTimeout', () => {
    it('returns undefined when neither is provided (lets scuttlerun apply its own default)', async () => {
      const { resolveTimeout } = await import('../src/config.js');
      expect(resolveTimeout(undefined, undefined)).toBeUndefined();
    });
    it('uses the CLI value when only CLI is provided', async () => {
      const { resolveTimeout } = await import('../src/config.js');
      expect(resolveTimeout(900, undefined)).toBe(900);
    });
    it('uses the yaml value when only yaml is provided', async () => {
      const { resolveTimeout } = await import('../src/config.js');
      expect(resolveTimeout(undefined, 600)).toBe(600);
    });
    it('prefers the CLI value when both are provided', async () => {
      const { resolveTimeout } = await import('../src/config.js');
      expect(resolveTimeout(900, 600)).toBe(900);
    });
  });

  describe('parseTimeoutFlag', () => {
    it('returns undefined when the raw flag is undefined', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(parseTimeoutFlag(undefined)).toBeUndefined();
    });
    it('parses a positive integer string to a number', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(parseTimeoutFlag('120')).toBe(120);
    });
    it('throws on non-numeric flag', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(() => parseTimeoutFlag('abc')).toThrow('--timeout must be a positive integer');
    });
    it('throws on non-positive flag', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(() => parseTimeoutFlag('0')).toThrow('--timeout must be a positive integer');
    });
    it('throws on non-integer flag (e.g., decimal)', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(() => parseTimeoutFlag('1.5')).toThrow('--timeout must be a positive integer');
    });
    it('throws on negative flag', async () => {
      const { parseTimeoutFlag } = await import('../src/config.js');
      expect(() => parseTimeoutFlag('-5')).toThrow('--timeout must be a positive integer');
    });
  });

  describe('resolveRepeatsFromRawFlag', () => {
    it('prefers the CLI flag over the yaml value', async () => {
      const { resolveRepeatsFromRawFlag } = await import('../src/config.js');
      expect(resolveRepeatsFromRawFlag('1', 3)).toBe(1);
    });
    it('falls back to yaml when flag is undefined', async () => {
      const { resolveRepeatsFromRawFlag } = await import('../src/config.js');
      expect(resolveRepeatsFromRawFlag(undefined, 5)).toBe(5);
    });
    it('falls back to DEFAULT_REPEATS when neither is provided', async () => {
      const { resolveRepeatsFromRawFlag, DEFAULT_REPEATS } = await import('../src/config.js');
      expect(resolveRepeatsFromRawFlag(undefined, undefined)).toBe(DEFAULT_REPEATS);
    });
    it('throws on non-numeric flag', async () => {
      const { resolveRepeatsFromRawFlag } = await import('../src/config.js');
      expect(() => resolveRepeatsFromRawFlag('abc', undefined)).toThrow(
        '--repeats must be a positive integer',
      );
    });
    it('throws on non-positive flag', async () => {
      const { resolveRepeatsFromRawFlag } = await import('../src/config.js');
      expect(() => resolveRepeatsFromRawFlag('0', undefined)).toThrow(
        '--repeats must be a positive integer',
      );
    });
  });
});

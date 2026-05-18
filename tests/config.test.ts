import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'craboodle-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe('loadCraboodleConfig', () => {
    it('parses version, min_pass_rate, max_budget_usd, and repeats', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(
        configPath,
        stringify({
          version: '1',
          min_pass_rate: 0.8,
          max_budget_usd: 5.0,
          repeats: 3,
        }),
      );

      const config = await loadCraboodleConfig(configPath);

      expect(config.version).toBe('1');
      expect(config.minPassRate).toBe(0.8);
      expect(config.maxBudgetUsd).toBe(5.0);
      expect(config.repeats).toBe(3);
    });

    it('returns defaults when file does not exist', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const config = await loadCraboodleConfig(join(tmpDir, 'nonexistent.yaml'));

      expect(config.version).toBeUndefined();
      expect(config.minPassRate).toBeUndefined();
      expect(config.maxBudgetUsd).toBeUndefined();
      expect(config.repeats).toBeUndefined();
    });

    it('throws when version is missing from existing file', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ min_pass_rate: 0.8 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'missing required "version" field',
      );
    });

    it('throws on unsupported version', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '99' }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'Unsupported eval format version: 99',
      );
    });

    it('accepts version 1 as a number (coerced to string)', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: 1 }));

      const config = await loadCraboodleConfig(configPath);
      expect(config.version).toBe('1');
    });

    it('throws on invalid min_pass_rate', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', min_pass_rate: 'high' }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'min_pass_rate must be a number between 0 and 1',
      );
    });

    it('throws on min_pass_rate out of range', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', min_pass_rate: 1.5 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'min_pass_rate must be a number between 0 and 1',
      );
    });

    it('throws on invalid max_budget_usd', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', max_budget_usd: 'expensive' }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'max_budget_usd must be a positive number',
      );
    });

    it('throws on non-positive max_budget_usd', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', max_budget_usd: 0 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'max_budget_usd must be a positive number',
      );
    });

    it('throws on non-numeric repeats', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', repeats: 'three' }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'repeats must be a positive integer',
      );
    });

    it('throws on non-integer repeats', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', repeats: 1.5 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'repeats must be a positive integer',
      );
    });

    it('throws on non-positive repeats', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', repeats: 0 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'repeats must be a positive integer',
      );
    });

    it('parses artifact_retention_days', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', artifact_retention_days: 14 }));

      const config = await loadCraboodleConfig(configPath);
      expect(config.artifactRetentionDays).toBe(14);
    });

    it('accepts artifact_retention_days: 0 to disable cleanup', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', artifact_retention_days: 0 }));

      const config = await loadCraboodleConfig(configPath);
      expect(config.artifactRetentionDays).toBe(0);
    });

    it('throws on non-integer artifact_retention_days', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', artifact_retention_days: 1.5 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'artifact_retention_days must be a non-negative integer',
      );
    });

    it('throws on negative artifact_retention_days', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', artifact_retention_days: -1 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        'artifact_retention_days must be a non-negative integer',
      );
    });

    it('re-throws non-ENOENT errors', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      // Reading a directory as a file gives EISDIR
      await expect(loadCraboodleConfig(tmpDir)).rejects.toThrow();
    });

    it('throws on unknown top-level keys', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1', max_budgett_usd: 5.0 }));

      await expect(loadCraboodleConfig(configPath)).rejects.toThrow(
        /unknown.*max_budgett_usd|max_budgett_usd.*unknown/i,
      );
    });

    it('allows all fields to be optional except version', async () => {
      const { loadCraboodleConfig } = await import('../src/config.js');
      const configPath = join(tmpDir, 'craboodle.yaml');
      await writeFile(configPath, stringify({ version: '1' }));

      const config = await loadCraboodleConfig(configPath);

      expect(config.version).toBe('1');
      expect(config.minPassRate).toBeUndefined();
      expect(config.maxBudgetUsd).toBeUndefined();
      expect(config.repeats).toBeUndefined();
    });
  });

  describe('checkBaseConfig', () => {
    it('returns path when base.yaml exists', async () => {
      const { checkBaseConfig } = await import('../src/config.js');
      const basePath = join(tmpDir, 'base.yaml');
      await writeFile(basePath, stringify({ model: 'claude-sonnet-4-6' }));

      const result = await checkBaseConfig(basePath);
      expect(result).toBe(basePath);
    });

    it('returns null when base.yaml does not exist', async () => {
      const { checkBaseConfig } = await import('../src/config.js');
      const result = await checkBaseConfig(join(tmpDir, 'nonexistent.yaml'));
      expect(result).toBeNull();
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

import { describe, it, expect } from 'vitest';
import { formatErrorWithHint, formatCommandError } from '../src/errors.js';

describe('formatErrorWithHint', () => {
  it('emits three lines when reference is provided', () => {
    const out = formatErrorWithHint('something failed', 'fix it', 'docs --help');
    expect(out).toBe('[craboodle] something failed\n  Try: fix it\n  See: docs --help\n');
  });

  it('omits the See: line when reference is undefined', () => {
    const out = formatErrorWithHint('trivial', 'just retry');
    expect(out).toBe('[craboodle] trivial\n  Try: just retry\n');
  });

  it('shapes a budget-exceeded message with cap and recovery', () => {
    const out = formatErrorWithHint(
      'Budget exceeded (max_budget_usd: 10)',
      'raise max_budget_usd in craboodle.yaml',
      'craboodle --help',
    );
    expect(out).toContain('max_budget_usd: 10');
    expect(out).toContain('Try: raise max_budget_usd');
    expect(out).toContain('See: craboodle --help');
  });

  it('shapes a catch-all message that points at subprocess prerequisites', () => {
    const out = formatErrorWithHint(
      'Error: ENOENT',
      'verify scuttlerun and pincenez are installed (scuttlerun --version, pincenez --version) if a subprocess failed',
      'craboodle --help',
    );
    expect(out).toContain('scuttlerun --version');
    expect(out).toContain('pincenez --version');
  });
});

describe('formatCommandError', () => {
  it('emits a path-specific hint when err.code is EVALS_CONFIG_NOT_FOUND', () => {
    const err = new Error('evals.yaml not found at /tmp/foo/evals.yaml') as Error & {
      code?: string;
    };
    err.code = 'EVALS_CONFIG_NOT_FOUND';
    const out = formatCommandError(err);
    expect(out).toContain('evals.yaml not found');
    expect(out).toContain('pass the skill/plugin root');
    expect(out).not.toContain('scuttlerun --version');
    expect(out).toContain('craboodle --help');
  });

  it('falls back to the dependency hint for errors without that code', () => {
    const err = new Error('boom');
    const out = formatCommandError(err);
    expect(out).toContain('boom');
    expect(out).toContain('scuttlerun --version');
    expect(out).toContain('pincenez --version');
    expect(out).toContain('craboodle --help');
  });

  it('handles non-Error throwables by stringifying them', () => {
    const out = formatCommandError('a bare string');
    expect(out).toContain('a bare string');
    expect(out).toContain('scuttlerun --version');
  });
});

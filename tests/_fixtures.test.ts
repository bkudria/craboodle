import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { makeTmpDir } from './_fixtures.js';

describe('makeTmpDir', () => {
  const created: string[] = [];

  afterEach(async () => {
    while (created.length > 0) {
      const path = created.pop();
      if (path) await rm(path, { recursive: true, force: true });
    }
  });

  it('creates a directory under tmpdir() with the craboodle-<name>-test- prefix', async () => {
    const path = await makeTmpDir('foo');
    created.push(path);

    expect(dirname(path)).toBe(tmpdir());
    expect(basename(path)).toMatch(/^craboodle-foo-test-/);
    const info = await stat(path);
    expect(info.isDirectory()).toBe(true);
  });

  it('appends the role between -test- and the random suffix when provided', async () => {
    const path = await makeTmpDir('foo', 'bar');
    created.push(path);

    expect(basename(path)).toMatch(/^craboodle-foo-test-bar-/);
  });

  it('returns a distinct path on each invocation', async () => {
    const a = await makeTmpDir('foo');
    created.push(a);
    const b = await makeTmpDir('foo');
    created.push(b);

    expect(a).not.toBe(b);
  });
});

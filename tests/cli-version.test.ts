import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const execFileAsync = promisify(execFile);

describe('cli --version', () => {
  it('matches the version declared in package.json', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const { stdout } = await execFileAsync('./node_modules/.bin/tsx', [
      'src/cli.ts',
      '--version',
    ]);
    expect(stdout.trim()).toBe(pkg.version);
  });
});

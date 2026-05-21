import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpDir(testName: string, role?: string): Promise<string> {
  const suffix = role ? `-test-${role}-` : '-test-';
  return mkdtemp(join(tmpdir(), `craboodle-${testName}${suffix}`));
}

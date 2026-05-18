import { access, constants } from 'node:fs/promises';
import { join, delimiter } from 'node:path';

async function findOnPath(name: string): Promise<string | null> {
  const PATH = process.env.PATH ?? '';
  const dirs = PATH.split(delimiter);
  const isWindows = process.platform === 'win32';
  const exts = isWindows ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const fp = join(dir, name + ext);
      try {
        await access(fp, constants.X_OK);
        return fp;
      } catch {
        /* not here, keep looking */
      }
    }
  }
  return null;
}

export interface MissingBinary {
  name: string;
}

export async function findMissingBinaries(names: string[]): Promise<MissingBinary[]> {
  const checks = await Promise.all(
    names.map(async (name) => ({ name, found: await findOnPath(name) })),
  );
  return checks.filter((c) => c.found === null).map(({ name }) => ({ name }));
}

export function formatMissingBinariesError(missing: MissingBinary[]): string {
  const names = missing.map((m) => m.name);
  const list = names.join(', ');
  const plural = names.length === 1 ? 'is' : 'are';
  return (
    `Error: ${list} ${plural} not found on PATH\n` +
    `\n` +
    `craboodle requires the following companion CLIs:\n` +
    `  scuttlerun  https://github.com/bkudria/scuttlerun\n` +
    `  pincenez    https://github.com/bkudria/pincenez\n` +
    `\n` +
    `Install both and ensure they are reachable on PATH, then retry.\n`
  );
}

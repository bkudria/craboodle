import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PREFIXES = ['craboodle-run-', 'craboodle-staged-'];
const MS_PER_DAY = 86_400_000;

/**
 * Remove craboodle artifact directories older than maxAgeDays from $TMPDIR.
 * Best-effort: failures are silently ignored.
 * Returns count of directories removed.
 * If maxAgeDays is 0, cleanup is disabled and the function returns 0.
 */
export async function cleanOldArtifacts(
  maxAgeDays: number,
  options: { verbose?: boolean } = {},
): Promise<number> {
  if (maxAgeDays === 0) {
    return 0;
  }
  const tmp = tmpdir();
  const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
  let cleaned = 0;

  try {
    const entries = await readdir(tmp, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !PREFIXES.some((p) => entry.name.startsWith(p))) continue;

      const dirPath = join(tmp, entry.name);
      try {
        const info = await stat(dirPath);
        if (info.mtimeMs < cutoff) {
          await rm(dirPath, { recursive: true });
          cleaned++;
        }
      } catch {
        // Ignore per-directory errors (in use, already deleted, etc.)
      }
    }
  } catch {
    // Ignore readdir errors (permission issues, etc.)
  }

  if (options.verbose && cleaned > 0) {
    process.stderr.write(`[craboodle] Cleaned ${cleaned} old artifact dir(s)\n`);
  }

  return cleaned;
}

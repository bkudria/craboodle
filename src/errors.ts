export function formatErrorWithHint(
  explanation: string,
  recovery: string,
  reference?: string,
): string {
  const lines = [`[craboodle] ${explanation}`, `  Try: ${recovery}`];
  if (reference) lines.push(`  See: ${reference}`);
  return lines.join('\n') + '\n';
}

const DEPENDENCY_RECOVERY_HINT =
  'verify scuttlerun and pincenez are installed (scuttlerun --version, pincenez --version) if a subprocess failed';

const EVALS_CONFIG_NOT_FOUND_HINT =
  'pass the skill/plugin root, not its evals/ subdirectory; or verify the path contains an evals.yaml';

export function formatCommandError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  const recovery =
    code === 'EVALS_CONFIG_NOT_FOUND' ? EVALS_CONFIG_NOT_FOUND_HINT : DEPENDENCY_RECOVERY_HINT;
  return formatErrorWithHint(`Error: ${message}`, recovery, 'craboodle --help');
}

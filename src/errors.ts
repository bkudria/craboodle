export function formatErrorWithHint(
  explanation: string,
  recovery: string,
  reference?: string,
): string {
  const lines = [`[craboodle] ${explanation}`, `  Try: ${recovery}`];
  if (reference) lines.push(`  See: ${reference}`);
  return lines.join('\n') + '\n';
}

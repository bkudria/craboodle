import { InvalidArgumentError } from 'commander';

export function parseConcurrency(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError(`must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return n;
}

import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prepend the committed test-stub bin dir to PATH so craboodle's preflight
// (and any subprocess invocations) find scuttlerun/pincenez in CI and on
// fresh checkouts where the real binaries are not installed.
//
// Tests that need scuttlerun/pincenez to fail can set
// CRABOODLE_STUB_SCUTTLERUN_EXIT / CRABOODLE_STUB_PINCENEZ_EXIT on the
// child env. Tests that need a clean PATH (e.g. asserting the
// "not found on PATH" error) override the PATH env explicitly.
const stubDir = join(dirname(fileURLToPath(import.meta.url)), 'stubs');
process.env.PATH = `${stubDir}${delimiter}${process.env.PATH ?? ''}`;

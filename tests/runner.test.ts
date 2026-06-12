import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess, ExecFileException } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);
// Alias for existing assertions that reference command/args via .mock.calls
const mockExecFile = mockSpawn;

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

// Test helper: keep the cb-style API from the previous execFile-based
// implementation, but route through a spawn mock that produces the
// appropriate event stream. Routing rules for the cb's error argument:
//   - null/undefined           → emit 'close' with code 0
//   - error.code === 'ABORT_ERR' → skip emission; the test must abort
//                                  the controller to drive the abort path
//   - error.code numeric       → emit 'close' with that exit code; stderr
//                                  pushed into the stream beforehand
//   - error.code non-numeric   → emit 'error' on the child (ENOENT-like)
function mockExecFileCall(respond: (cb: ExecFileCallback) => void): void {
  mockSpawn.mockImplementation((() => {
    const stdoutStream = new Readable({ read() {} });
    const stderrStream = new Readable({ read() {} });
    const child = new EventEmitter() as ChildProcess;
    (child as unknown as { stdout: Readable }).stdout = stdoutStream;
    (child as unknown as { stderr: Readable }).stderr = stderrStream;
    (child as unknown as { pid: number }).pid = 12345;
    (child as unknown as { kill: () => boolean }).kill = vi.fn(() => true);

    queueMicrotask(() => {
      respond((error, stdout, stderr) => {
        if (stdout) stdoutStream.push(stdout);
        if (stderr) stderrStream.push(stderr);
        stdoutStream.push(null);
        stderrStream.push(null);

        const emitClose = (code: number): void => {
          // Wait for both streams to finish flushing before emitting 'close',
          // matching real Node.js semantics where 'close' fires after stdout
          // and stderr have ended.
          let pending = 2;
          const done = (): void => {
            pending--;
            if (pending === 0) child.emit('close', code, null);
          };
          stdoutStream.on('end', done);
          stderrStream.on('end', done);
          stdoutStream.resume();
          stderrStream.resume();
        };

        if (error) {
          const code = (error as Error & { code?: number | string }).code;
          if (code === 'ABORT_ERR') {
            // The runner's abort listener owns rejection on this path.
            // Emit close so the close handler runs with aborted=true.
            emitClose(0);
            return;
          }
          if (typeof code === 'number') {
            emitClose(code);
          } else {
            child.emit('error', error);
          }
        } else {
          emitClose(0);
        }
      });
    });

    return child;
  }) as unknown as typeof spawn);
}

describe('runner', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('runner');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe('runScuttlerun', () => {
    it('forwards subprocess stderr to process.stderr on success', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { runScuttlerun } = await import('../src/runner.js');

      const warningText = '[scuttlerun] WARNING: Unknown tool name "TaskCrate" in tools: list.\n';
      mockExecFileCall((cb) => cb(null, 'session: abc\n', warningText));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(result.success).toBe(true);
      expect(stderrSpy).toHaveBeenCalledWith(warningText);
      stderrSpy.mockRestore();
    });

    it('forwards subprocess stderr to process.stderr on failure', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { runScuttlerun } = await import('../src/runner.js');

      const diagnostic = '[scuttlerun] boom: tool X exploded\n';
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, '', diagnostic));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(result.success).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(diagnostic);
      stderrSpy.mockRestore();
    });

    it('invokes scuttlerun with base and scenario config files', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'session: abc\nconversation: []\n', ''));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: '/path/to/base.yaml',
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe('scuttlerun');
      expect(args).toContain('/path/to/base.yaml');
      expect(args).toContain('/path/to/scenario.yaml');
      expect(result.success).toBe(true);
    });

    it('skips base.yaml when basePath is null', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'session: abc\n', ''));

      await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      const [, args] = mockExecFile.mock.calls[0];
      if (!args) throw new Error('mockExecFile call missing args');
      // Should only have: <scenario.yaml>
      expect(args.filter((a: string) => a.endsWith('.yaml'))).toHaveLength(1);
    });

    it('writes stdout to output file', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const transcript = 'session: abc\nconversation:\n  - user: hello\n';
      mockExecFileCall((cb) => cb(null, transcript, ''));

      const outputPath = join(tmpDir, 'output.yaml');
      await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath,
      });

      const content = await readFile(outputPath, 'utf8');
      expect(content).toBe(transcript);
    });

    it('forwards --model when agentModel is provided', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'session: abc\n', ''));

      await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
        agentModel: 'claude-sonnet-4-6',
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-6');
    });

    it('returns error with stderr on non-zero exit', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & {
        code: number;
        stderr: string;
      };
      error.code = 6;
      error.stderr = 'scuttlerun: timeout after 120s';
      mockExecFileCall((cb) => cb(error, '', 'scuttlerun: timeout after 120s'));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('scuttlerun');
        expect(result.error.message).toContain('timeout after 120s');
        expect(result.error.exitCode).toBe(6);
      }
    });

    it('embeds "(exit N)" in fallback message when stderr is empty', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & { code: number };
      error.code = 6;
      mockExecFileCall((cb) => cb(error, '', ''));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('(exit 6)');
        expect(result.error.exitCode).toBe(6);
      }
    });

    it('falls back to error.message when stderr is empty', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const error = new Error('ENOENT: scuttlerun not found') as Error & { code: string };
      error.code = 'ENOENT';
      mockExecFileCall((cb) => cb(error, '', ''));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('ENOENT: scuttlerun not found');
        expect(result.error.exitCode).toBeUndefined();
      }
    });

    it('persists partial output.yaml when scuttlerun exits non-zero with stdout', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const partial = 'session: abc\nconversation:\n  - user: hi\n';
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 6;
      mockExecFileCall((cb) => cb(error, partial, ''));

      const outputPath = join(tmpDir, 'output.yaml');
      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.transcriptPath).toBe(outputPath);
      }
      const content = await readFile(outputPath, 'utf8');
      expect(content).toBe(partial);
    });

    it('omits transcriptPath when scuttlerun exits non-zero with empty stdout', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & { code: number };
      error.code = 1;
      mockExecFileCall((cb) => cb(error, '', ''));

      const outputPath = join(tmpDir, 'output.yaml');
      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.transcriptPath).toBeUndefined();
      }
      await expect(readFile(outputPath, 'utf8')).rejects.toThrow(/ENOENT/);
    });

    it('persists partial output.yaml when scuttlerun is aborted mid-stream', async () => {
      const { runScuttlerun } = await import('../src/runner.js');

      const partial = 'session: abc\nconversation:\n  - user: hi\n';
      const controller = new AbortController();
      controller.abort();
      mockExecFileCall((cb) => cb(null, partial, ''));

      const outputPath = join(tmpDir, 'output.yaml');
      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath,
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('Interrupted (SIGINT)');
        expect(result.error.transcriptPath).toBe(outputPath);
      }
      const content = await readFile(outputPath, 'utf8');
      expect(content).toBe(partial);
    });
  });

  describe('runPincenezLint', () => {
    it('forwards subprocess stderr to process.stderr on failure', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { runPincenezLint } = await import('../src/runner.js');

      const diagnostic = '[pincenez] grader crashed: boom\n';
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, '', diagnostic));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
      });

      expect(result.success).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(diagnostic);
      stderrSpy.mockRestore();
    });

    it('invokes pincenez lint with checks file', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      const lintYaml =
        'checks:\n  - id: a1\n    check: "test"\n    issues: []\nchecks_total: 1\nchecks_with_issues: 0\n';
      mockExecFileCall((cb) => cb(null, lintYaml, ''));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      if (!args) throw new Error('mockExecFile call missing args');
      expect(cmd).toBe('pincenez');
      expect(args[0]).toBe('lint');
      expect(args).toContain('/path/to/checks.yaml');
      expect(result.success).toBe(true);
    });

    it('returns stdout on success', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      const lintYaml = 'checks:\n  - id: a1\n    check: "test"\n    issues: []\n';
      mockExecFileCall((cb) => cb(null, lintYaml, ''));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stdout).toBe(lintYaml);
      }
    });

    it('forwards --model when graderModel is provided', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\n', ''));

      await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
        graderModel: 'claude-sonnet-4-6',
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-6');
    });

    it('forwards --context when context is provided', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\n', ''));

      await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
        context: 'Write a function that adds two numbers',
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--context');
      expect(args).toContain('Write a function that adds two numbers');
    });

    it('forwards --available-tools as a comma-joined list when provided', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\n', ''));

      await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
        availableTools: ['Read', 'Skill', 'TaskCreate'],
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--available-tools');
      expect(args).toContain('Read,Skill,TaskCreate');
    });

    it('omits --available-tools when the list is absent or empty', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\n', ''));
      await runPincenezLint({ checksPath: '/path/to/checks.yaml' });
      expect(mockExecFile.mock.calls[0][1]).not.toContain('--available-tools');

      mockExecFileCall((cb) => cb(null, 'checks: []\n', ''));
      await runPincenezLint({ checksPath: '/path/to/checks.yaml', availableTools: [] });
      expect(mockExecFile.mock.calls[1][1]).not.toContain('--available-tools');
    });

    it('returns error with stderr on failure', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, '', 'pincenez: API error'));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('pincenez');
        expect(result.error.message).toContain('API error');
        expect(result.error.exitCode).toBe(2);
      }
    });

    it('falls back to error.message when stderr is empty', async () => {
      const { runPincenezLint } = await import('../src/runner.js');

      const error = new Error('pincenez not found') as Error & { code: string };
      error.code = 'ENOENT';
      mockExecFileCall((cb) => cb(error, '', ''));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('pincenez not found');
      }
    });
  });

  describe('listScuttlerunConfig', () => {
    it('forwards subprocess stderr to process.stderr on failure', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { listScuttlerunConfig } = await import('../src/runner.js');

      const diagnostic = '[scuttlerun] invalid config: boom\n';
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 1;
      mockExecFileCall((cb) => cb(error, '', diagnostic));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
      });

      expect(result.success).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(diagnostic);
      stderrSpy.mockRestore();
    });

    it('invokes scuttlerun --dry-run with base and scenario config', async () => {
      const { listScuttlerunConfig } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'model: claude-sonnet-4-6\n', ''));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: '/path/to/base.yaml',
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      if (!args) throw new Error('mockExecFile call missing args');
      expect(cmd).toBe('scuttlerun');
      expect(args[0]).toBe('--dry-run');
      expect(args).toContain('/path/to/base.yaml');
      expect(args).toContain('/path/to/scenario.yaml');
      expect(result.success).toBe(true);
    });

    it('returns stdout on success', async () => {
      const { listScuttlerunConfig } = await import('../src/runner.js');

      const configYaml = 'model: claude-sonnet-4-6\ntools:\n  - Read\n';
      mockExecFileCall((cb) => cb(null, configYaml, ''));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stdout).toBe(configYaml);
      }
    });

    it('returns error on failure', async () => {
      const { listScuttlerunConfig } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & { code: number };
      error.code = 1;
      mockExecFileCall((cb) => cb(error, '', 'scuttlerun: invalid config'));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('scuttlerun');
        expect(result.error.message).toContain('invalid config');
        expect(result.error.exitCode).toBe(1);
      }
    });

    it('falls back to error.message when stderr is empty', async () => {
      const { listScuttlerunConfig } = await import('../src/runner.js');

      const error = new Error('scuttlerun not found') as Error & { code: string };
      error.code = 'ENOENT';
      mockExecFileCall((cb) => cb(error, '', ''));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('scuttlerun not found');
      }
    });
  });

  describe('runPincenez', () => {
    it('forwards subprocess stderr to process.stderr on failure', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { runPincenez } = await import('../src/runner.js');

      const diagnostic = '[pincenez] grader crashed: boom\n';
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, '', diagnostic));

      const result = await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
      });

      expect(result.success).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(diagnostic);
      stderrSpy.mockRestore();
    });

    it('invokes pincenez with checks file and output file', async () => {
      const { runPincenez } = await import('../src/runner.js');

      const gradingYaml =
        'checks:\n  - id: a1\n    check: "test"\n    pass: true\n    evidence: "ok"\npass_rate: 1.0\n';
      mockExecFileCall((cb) => cb(null, gradingYaml, ''));

      const result = await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe('pincenez');
      expect(args).toContain('/path/to/checks.yaml');
      expect(args).toContain('/path/to/output.yaml');
      expect(result.success).toBe(true);
    });

    it('forwards --model when graderModel is provided', async () => {
      const { runPincenez } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\npass_rate: 0\n', ''));

      await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
        graderModel: 'claude-sonnet-4-6',
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-6');
    });

    it('forwards --context when context is provided', async () => {
      const { runPincenez } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\npass_rate: 0\n', ''));

      await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
        context: 'Write a haiku about the ocean',
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain('--context');
      expect(args).toContain('Write a haiku about the ocean');
    });

    it('omits --context when context is absent', async () => {
      const { runPincenez } = await import('../src/runner.js');

      mockExecFileCall((cb) => cb(null, 'checks: []\npass_rate: 0\n', ''));

      await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
      });

      expect(mockExecFile.mock.calls[0][1]).not.toContain('--context');
    });

    it('returns error with stderr on failure', async () => {
      const { runPincenez } = await import('../src/runner.js');

      const error = new Error('Command failed') as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, '', 'pincenez: API error'));

      const result = await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('pincenez');
        expect(result.error.message).toContain('API error');
        expect(result.error.exitCode).toBe(2);
      }
    });

    it('falls back to error.message when stderr is empty', async () => {
      const { runPincenez } = await import('../src/runner.js');

      const error = new Error('pincenez not found') as Error & { code: string };
      error.code = 'ENOENT';
      mockExecFileCall((cb) => cb(error, '', ''));

      const result = await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('pincenez not found');
      }
    });
  });

  describe('AbortSignal plumbing', () => {
    it('aborting the signal maps runScuttlerun to "Interrupted (SIGINT)"', async () => {
      const { runScuttlerun } = await import('../src/runner.js');
      const controller = new AbortController();
      controller.abort();
      mockExecFileCall((cb) => cb(null, '', ''));

      const result = await runScuttlerun({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        outputPath: join(tmpDir, 'output.yaml'),
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('scuttlerun');
        expect(result.error.message).toBe('Interrupted (SIGINT)');
      }
    });

    it('aborting the signal maps runPincenez to "Interrupted (SIGINT)"', async () => {
      const { runPincenez } = await import('../src/runner.js');
      const controller = new AbortController();
      controller.abort();
      mockExecFileCall((cb) => cb(null, '', ''));

      const result = await runPincenez({
        checksPath: '/path/to/checks.yaml',
        outputPath: '/path/to/output.yaml',
        gradingPath: join(tmpDir, 'grading.yaml'),
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('pincenez');
        expect(result.error.message).toBe('Interrupted (SIGINT)');
      }
    });

    it('aborting the signal maps runPincenezLint to "Interrupted (SIGINT)"', async () => {
      const { runPincenezLint } = await import('../src/runner.js');
      const controller = new AbortController();
      controller.abort();
      mockExecFileCall((cb) => cb(null, '', ''));

      const result = await runPincenezLint({
        checksPath: '/path/to/checks.yaml',
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('pincenez');
        expect(result.error.message).toBe('Interrupted (SIGINT)');
      }
    });

    it('aborting the signal maps listScuttlerunConfig to "Interrupted (SIGINT)"', async () => {
      const { listScuttlerunConfig } = await import('../src/runner.js');
      const controller = new AbortController();
      controller.abort();
      mockExecFileCall((cb) => cb(null, '', ''));

      const result = await listScuttlerunConfig({
        scenarioPath: '/path/to/scenario.yaml',
        basePath: null,
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe('scuttlerun');
        expect(result.error.message).toBe('Interrupted (SIGINT)');
      }
    });
  });
});

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const SIGTERM_GRACE_MS = 500;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface RepError {
  stage: 'scuttlerun' | 'pincenez';
  message: string;
  exitCode?: number;
  transcriptPath?: string;
}

export type SubprocessResult = { success: true } | { success: false; error: RepError };

export interface RunScuttlerunOptions {
  scenarioPath: string;
  basePath: string | null;
  outputPath: string;
  agentModel?: string;
  signal?: AbortSignal;
}

export interface RunPincenezOptions {
  checksPath: string;
  outputPath: string;
  gradingPath: string;
  graderModel?: string;
  signal?: AbortSignal;
}

function execFilePromise(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let aborted = false;
    let bufferExceeded = false;
    let stdout = '';
    let stderr = '';
    const isWindows = process.platform === 'win32';
    // `detached: true` on POSIX makes the child the leader of a new process
    // group, so we can signal the whole subtree via process.kill(-pid, ...).
    // On Windows it spawns a new console; we'll fall back to direct child
    // signaling below.
    const child = spawn(cmd, args, { detached: !isWindows });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BUFFER) {
        bufferExceeded = true;
        child.kill();
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err: Error & { code?: string }) => {
      // Spawn-level error (ENOENT, EACCES, ...). The error already carries
      // a meaningful message; surface it as-is.
      reject(err);
    });

    child.on('close', (code: number | null, killSignal: NodeJS.Signals | null) => {
      if (aborted) {
        const err = new Error('The operation was aborted') as Error & {
          code?: string;
          stderr?: string;
          stdout?: string;
        };
        err.code = 'ABORT_ERR';
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      if (bufferExceeded) {
        const err = new Error('stdout maxBuffer length exceeded') as Error & {
          code?: string;
          stderr?: string;
          stdout?: string;
        };
        err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      if (code !== 0 || killSignal !== null) {
        const reason = code !== null ? `exit ${code}` : `signal ${killSignal}`;
        const err = new Error(`Command failed (${reason}): ${cmd} ${args.join(' ')}`) as Error & {
          code?: number | string;
          signal?: NodeJS.Signals;
          stderr?: string;
          stdout?: string;
        };
        if (code !== null) err.code = code;
        if (killSignal !== null) err.signal = killSignal;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      if (stderr) {
        process.stderr.write(stderr);
      }
      resolve({ stdout, stderr });
    });

    if (signal) {
      const onAbort = (): void => {
        aborted = true;
        const pid = child.pid;
        if (pid === undefined) return;
        if (isWindows) {
          try {
            child.kill('SIGTERM');
          } catch {
            /* already gone */
          }
          return;
        }
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
        const handle = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }, SIGTERM_GRACE_MS);
        (handle as { unref?: () => void }).unref?.();
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

function isAbortError(err: Error & { code?: string | number }): boolean {
  return err.code === 'ABORT_ERR';
}

export async function runScuttlerun(options: RunScuttlerunOptions): Promise<SubprocessResult> {
  const { scenarioPath, basePath, outputPath, agentModel, signal } = options;

  const args: string[] = [];
  if (basePath) {
    args.push(basePath);
  }
  args.push(scenarioPath);

  if (agentModel) {
    args.push('--model', agentModel);
  }

  try {
    const { stdout } = await execFilePromise('scuttlerun', args, signal);
    await writeFile(outputPath, stdout);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error & {
      stderr?: string;
      stdout?: string;
      code?: string | number;
    };
    const exitCode = typeof error.code === 'number' ? error.code : undefined;
    let transcriptPath: string | undefined;
    if (error.stdout && error.stdout.length > 0) {
      await writeFile(outputPath, error.stdout);
      transcriptPath = outputPath;
    }
    return {
      success: false,
      error: {
        stage: 'scuttlerun',
        message: isAbortError(error) ? 'Interrupted (SIGINT)' : error.stderr || error.message,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(transcriptPath !== undefined ? { transcriptPath } : {}),
      },
    };
  }
}

export interface ListScuttlerunOptions {
  scenarioPath: string;
  basePath: string | null;
  signal?: AbortSignal;
}

export async function listScuttlerunConfig(
  options: ListScuttlerunOptions,
): Promise<SubprocessResult & { stdout?: string }> {
  const { scenarioPath, basePath, signal } = options;

  const args = ['--dry-run'];
  if (basePath) {
    args.push(basePath);
  }
  args.push(scenarioPath);

  try {
    const { stdout } = await execFilePromise('scuttlerun', args, signal);
    return { success: true, stdout };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; code?: string | number };
    const exitCode = typeof error.code === 'number' ? error.code : undefined;
    return {
      success: false,
      error: {
        stage: 'scuttlerun',
        message: isAbortError(error) ? 'Interrupted (SIGINT)' : error.stderr || error.message,
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
    };
  }
}

export interface RunPincenezLintOptions {
  checksPath: string;
  graderModel?: string;
  context?: string;
  availableTools?: string[];
  signal?: AbortSignal;
}

export type LintSubprocessResult =
  | { success: true; stdout: string }
  | { success: false; error: RepError };

export async function runPincenezLint(
  options: RunPincenezLintOptions,
): Promise<LintSubprocessResult> {
  const { checksPath, graderModel, context, availableTools, signal } = options;

  const args: string[] = ['lint'];
  if (graderModel) {
    args.push('--model', graderModel);
  }
  if (context) {
    args.push('--context', context);
  }
  if (availableTools && availableTools.length > 0) {
    args.push('--available-tools', availableTools.join(','));
  }
  args.push(checksPath);

  try {
    const { stdout } = await execFilePromise('pincenez', args, signal);
    return { success: true, stdout };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; code?: string | number };
    const exitCode = typeof error.code === 'number' ? error.code : undefined;
    return {
      success: false,
      error: {
        stage: 'pincenez',
        message: isAbortError(error) ? 'Interrupted (SIGINT)' : error.stderr || error.message,
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
    };
  }
}

export async function runPincenez(options: RunPincenezOptions): Promise<SubprocessResult> {
  const { checksPath, outputPath, gradingPath, graderModel, signal } = options;

  const args: string[] = [];
  if (graderModel) {
    args.push('--model', graderModel);
  }
  args.push(checksPath, outputPath);

  try {
    const { stdout } = await execFilePromise('pincenez', args, signal);
    await writeFile(gradingPath, stdout);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; code?: string | number };
    const exitCode = typeof error.code === 'number' ? error.code : undefined;
    return {
      success: false,
      error: {
        stage: 'pincenez',
        message: isAbortError(error) ? 'Interrupted (SIGINT)' : error.stderr || error.message,
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
    };
  }
}

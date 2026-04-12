import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";

export interface RepError {
  stage: "scuttlerun" | "pincenez";
  message: string;
}

export type SubprocessResult =
  | { success: true }
  | { success: false; error: RepError };

export interface RunScuttlerunOptions {
  scenarioPath: string;
  basePath: string | null;
  outputPath: string;
  agentModel?: string;
}

export interface RunPincenezOptions {
  checksPath: string;
  outputPath: string;
  gradingPath: string;
  graderModel?: string;
}

function execFilePromise(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const err = error as Error & { stderr?: string };
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function runScuttlerun(
  options: RunScuttlerunOptions,
): Promise<SubprocessResult> {
  const { scenarioPath, basePath, outputPath, agentModel } = options;

  const args: string[] = [];
  if (basePath) {
    args.push(basePath);
  }
  args.push(scenarioPath);

  if (agentModel) {
    args.push("--model", agentModel);
  }

  try {
    const { stdout } = await execFilePromise("scuttlerun", args);
    await writeFile(outputPath, stdout);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    return {
      success: false,
      error: {
        stage: "scuttlerun",
        message: error.stderr || error.message,
      },
    };
  }
}

export interface ListScuttlerunOptions {
  scenarioPath: string;
  basePath: string | null;
}

export async function listScuttlerunConfig(
  options: ListScuttlerunOptions,
): Promise<SubprocessResult & { stdout?: string }> {
  const { scenarioPath, basePath } = options;

  const args = ["--dry-run"];
  if (basePath) {
    args.push(basePath);
  }
  args.push(scenarioPath);

  try {
    const { stdout } = await execFilePromise("scuttlerun", args);
    return { success: true, stdout };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    return {
      success: false,
      error: {
        stage: "scuttlerun",
        message: error.stderr || error.message,
      },
    };
  }
}

export interface RunPincenezLintOptions {
  checksPath: string;
  graderModel?: string;
  context?: string;
}

export type LintSubprocessResult =
  | { success: true; stdout: string }
  | { success: false; error: RepError };

export async function runPincenezLint(
  options: RunPincenezLintOptions,
): Promise<LintSubprocessResult> {
  const { checksPath, graderModel, context } = options;

  const args: string[] = ["lint"];
  if (graderModel) {
    args.push("--model", graderModel);
  }
  if (context) {
    args.push("--context", context);
  }
  args.push(checksPath);

  try {
    const { stdout } = await execFilePromise("pincenez", args);
    return { success: true, stdout };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    return {
      success: false,
      error: {
        stage: "pincenez",
        message: error.stderr || error.message,
      },
    };
  }
}

export async function runPincenez(
  options: RunPincenezOptions,
): Promise<SubprocessResult> {
  const { checksPath, outputPath, gradingPath, graderModel } = options;

  const args: string[] = [];
  if (graderModel) {
    args.push("--model", graderModel);
  }
  args.push(checksPath, outputPath);

  try {
    const { stdout } = await execFilePromise("pincenez", args);
    await writeFile(gradingPath, stdout);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    return {
      success: false,
      error: {
        stage: "pincenez",
        message: error.stderr || error.message,
      },
    };
  }
}

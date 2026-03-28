import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

export interface RepError {
  stage: "scuttlerun" | "pincenez";
  message: string;
}

export type SubprocessResult =
  | { success: true }
  | { success: false; error: RepError };

export interface RunScuttlerunOptions {
  override: Record<string, unknown>;
  basePath: string | null;
  outputPath: string;
  tmpDir: string;
  agentModel?: string;
}

export interface RunPincenezOptions {
  rubricPath: string;
  outputPath: string;
  gradingPath: string;
  graderModel?: string;
}

function execFilePromise(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8" }, (error, stdout, stderr) => {
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
  const { override, basePath, outputPath, tmpDir, agentModel } = options;

  const overridePath = join(tmpDir, "scuttlerun-override.yml");
  await writeFile(overridePath, stringify(override));

  const args = ["run"];
  if (basePath) {
    args.push(basePath);
  }
  args.push(overridePath);

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

export interface RunPincenezLintOptions {
  rubricPath: string;
  graderModel?: string;
}

export type LintSubprocessResult =
  | { success: true; stdout: string }
  | { success: false; error: RepError };

export async function runPincenezLint(
  options: RunPincenezLintOptions,
): Promise<LintSubprocessResult> {
  const { rubricPath, graderModel } = options;

  const args: string[] = ["lint"];
  if (graderModel) {
    args.push("--model", graderModel);
  }
  args.push(rubricPath);

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
  const { rubricPath, outputPath, gradingPath, graderModel } = options;

  const args: string[] = [];
  if (graderModel) {
    args.push("--model", graderModel);
  }
  args.push(rubricPath, outputPath);

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

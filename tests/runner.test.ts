import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess, ExecFileException, ExecFileOptions } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

function mockExecFileCall(respond: (cb: ExecFileCallback) => void): void {
  mockExecFile.mockImplementation(
    ((
      _file: string,
      _args: readonly string[] | null,
      _options: ExecFileOptions | null,
      callback?: ExecFileCallback | null,
    ): ChildProcess => {
      if (callback) respond(callback);
      return {} as ChildProcess;
    }) as typeof execFile,
  );
}

describe("runner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("runScuttlerun", () => {
    it("invokes scuttlerun with base and override config files", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "session: abc\nconversation: []\n", ""));

      const result = await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: "/path/to/base.yaml",
        outputPath: join(tmpDir, "output.yaml"),
        tmpDir,
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe("scuttlerun");
      expect(args![0]).toBe("run");
      expect(args).toContain("/path/to/base.yaml");
      expect(result.success).toBe(true);
    });

    it("skips base.yaml when basePath is null", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "session: abc\n", ""));

      await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: null,
        outputPath: join(tmpDir, "output.yaml"),
        tmpDir,
      });

      const [, args] = mockExecFile.mock.calls[0];
      // Should only have: run <override.yaml>
      expect(args!.filter((a: string) => a.endsWith(".yaml"))).toHaveLength(1);
    });

    it("writes stdout to output file", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      const transcript = "session: abc\nconversation:\n  - user: hello\n";
      mockExecFileCall((cb) => cb(null, transcript, ""));

      const outputPath = join(tmpDir, "output.yaml");
      await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: null,
        outputPath,
        tmpDir,
      });

      const content = await readFile(outputPath, "utf8");
      expect(content).toBe(transcript);
    });

    it("forwards --model when agentModel is provided", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "session: abc\n", ""));

      await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: null,
        outputPath: join(tmpDir, "output.yaml"),
        tmpDir,
        agentModel: "claude-sonnet-4-6",
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-6");
    });

    it("returns error with stderr on non-zero exit", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      const error = new Error("Command failed") as Error & {
        code: number;
        stderr: string;
      };
      error.code = 1;
      error.stderr = "scuttlerun: timeout after 120s";
      mockExecFileCall((cb) => cb(error, "", "scuttlerun: timeout after 120s"));

      const result = await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: null,
        outputPath: join(tmpDir, "output.yaml"),
        tmpDir,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe("scuttlerun");
        expect(result.error.message).toContain("timeout after 120s");
      }
    });

    it("falls back to error.message when stderr is empty", async () => {
      const { runScuttlerun } = await import("../src/runner.js");

      const error = new Error("ENOENT: scuttlerun not found") as Error & { code: number };
      error.code = 127;
      mockExecFileCall((cb) => cb(error, "", ""));

      const result = await runScuttlerun({
        override: { prompt: "Write a haiku" },
        basePath: null,
        outputPath: join(tmpDir, "output.yaml"),
        tmpDir,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("ENOENT: scuttlerun not found");
      }
    });
  });

  describe("runPincenezLint", () => {
    it("invokes pincenez lint with rubric file", async () => {
      const { runPincenezLint } = await import("../src/runner.js");

      const lintYaml =
        'assertions:\n  - id: a1\n    check: "test"\n    issues: []\nassertions_total: 1\nassertions_with_issues: 0\n';
      mockExecFileCall((cb) => cb(null, lintYaml, ""));

      const result = await runPincenezLint({
        rubricPath: "/path/to/rubric.yaml",
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe("pincenez");
      expect(args![0]).toBe("lint");
      expect(args).toContain("/path/to/rubric.yaml");
      expect(result.success).toBe(true);
    });

    it("returns stdout on success", async () => {
      const { runPincenezLint } = await import("../src/runner.js");

      const lintYaml = 'assertions:\n  - id: a1\n    check: "test"\n    issues: []\n';
      mockExecFileCall((cb) => cb(null, lintYaml, ""));

      const result = await runPincenezLint({
        rubricPath: "/path/to/rubric.yaml",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stdout).toBe(lintYaml);
      }
    });

    it("forwards --model when graderModel is provided", async () => {
      const { runPincenezLint } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "assertions: []\n", ""));

      await runPincenezLint({
        rubricPath: "/path/to/rubric.yaml",
        graderModel: "claude-sonnet-4-6",
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-6");
    });

    it("returns error with stderr on failure", async () => {
      const { runPincenezLint } = await import("../src/runner.js");

      const error = new Error("Command failed") as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, "", "pincenez: API error"));

      const result = await runPincenezLint({
        rubricPath: "/path/to/rubric.yaml",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe("pincenez");
        expect(result.error.message).toContain("API error");
      }
    });

    it("falls back to error.message when stderr is empty", async () => {
      const { runPincenezLint } = await import("../src/runner.js");

      const error = new Error("pincenez not found") as Error & { code: number };
      error.code = 127;
      mockExecFileCall((cb) => cb(error, "", ""));

      const result = await runPincenezLint({
        rubricPath: "/path/to/rubric.yaml",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("pincenez not found");
      }
    });
  });

  describe("listScuttlerunConfig", () => {
    it("invokes scuttlerun list with base and override config", async () => {
      const { listScuttlerunConfig } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "model: claude-sonnet-4-6\n", ""));

      const result = await listScuttlerunConfig({
        override: { prompt: "Write a haiku" },
        basePath: "/path/to/base.yaml",
        tmpDir,
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe("scuttlerun");
      expect(args![0]).toBe("list");
      expect(args).toContain("/path/to/base.yaml");
      expect(result.success).toBe(true);
    });

    it("returns stdout on success", async () => {
      const { listScuttlerunConfig } = await import("../src/runner.js");

      const configYaml = "model: claude-sonnet-4-6\ntools:\n  - Read\n";
      mockExecFileCall((cb) => cb(null, configYaml, ""));

      const result = await listScuttlerunConfig({
        override: { prompt: "Write a haiku" },
        basePath: null,
        tmpDir,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stdout).toBe(configYaml);
      }
    });

    it("returns error on failure", async () => {
      const { listScuttlerunConfig } = await import("../src/runner.js");

      const error = new Error("Command failed") as Error & { code: number };
      error.code = 1;
      mockExecFileCall((cb) => cb(error, "", "scuttlerun: invalid config"));

      const result = await listScuttlerunConfig({
        override: { prompt: "Write a haiku" },
        basePath: null,
        tmpDir,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe("scuttlerun");
        expect(result.error.message).toContain("invalid config");
      }
    });

    it("falls back to error.message when stderr is empty", async () => {
      const { listScuttlerunConfig } = await import("../src/runner.js");

      const error = new Error("scuttlerun not found") as Error & { code: number };
      error.code = 127;
      mockExecFileCall((cb) => cb(error, "", ""));

      const result = await listScuttlerunConfig({
        override: { prompt: "Write a haiku" },
        basePath: null,
        tmpDir,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("scuttlerun not found");
      }
    });
  });

  describe("runPincenez", () => {
    it("invokes pincenez with rubric and output file", async () => {
      const { runPincenez } = await import("../src/runner.js");

      const gradingYaml =
        'assertions:\n  - id: a1\n    check: "test"\n    pass: true\n    evidence: "ok"\npass_rate: 1.0\n';
      mockExecFileCall((cb) => cb(null, gradingYaml, ""));

      const result = await runPincenez({
        rubricPath: "/path/to/rubric.yaml",
        outputPath: "/path/to/output.yaml",
        gradingPath: join(tmpDir, "grading.yaml"),
      });

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe("pincenez");
      expect(args).toContain("/path/to/rubric.yaml");
      expect(args).toContain("/path/to/output.yaml");
      expect(result.success).toBe(true);
    });

    it("forwards --model when graderModel is provided", async () => {
      const { runPincenez } = await import("../src/runner.js");

      mockExecFileCall((cb) => cb(null, "assertions: []\npass_rate: 0\n", ""));

      await runPincenez({
        rubricPath: "/path/to/rubric.yaml",
        outputPath: "/path/to/output.yaml",
        gradingPath: join(tmpDir, "grading.yaml"),
        graderModel: "claude-sonnet-4-6",
      });

      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-6");
    });

    it("returns error with stderr on failure", async () => {
      const { runPincenez } = await import("../src/runner.js");

      const error = new Error("Command failed") as Error & { code: number };
      error.code = 2;
      mockExecFileCall((cb) => cb(error, "", "pincenez: API error"));

      const result = await runPincenez({
        rubricPath: "/path/to/rubric.yaml",
        outputPath: "/path/to/output.yaml",
        gradingPath: join(tmpDir, "grading.yaml"),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.stage).toBe("pincenez");
        expect(result.error.message).toContain("API error");
      }
    });

    it("falls back to error.message when stderr is empty", async () => {
      const { runPincenez } = await import("../src/runner.js");

      const error = new Error("pincenez not found") as Error & { code: number };
      error.code = 127;
      mockExecFileCall((cb) => cb(error, "", ""));

      const result = await runPincenez({
        rubricPath: "/path/to/rubric.yaml",
        outputPath: "/path/to/output.yaml",
        gradingPath: join(tmpDir, "grading.yaml"),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("pincenez not found");
      }
    });
  });
});

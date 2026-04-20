import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stringify } from "yaml";

const execFileAsync = promisify(execFile);

async function runAndGetExit(args: string[]): Promise<number> {
  try {
    await execFileAsync("craboodle", args);
    return 0;
  } catch (err) {
    const e = err as { code?: number };
    if (typeof e.code !== "number") throw err;
    return e.code;
  }
}

describe("cli exit codes (unified taxonomy)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-exit-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("code 4 — infrastructure/dependency error", () => {
    it("run: exits 4 when no scenarios in evals dir", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      const code = await runAndGetExit(["run", tmpDir]);
      expect(code).toBe(4);
    });

    it("run: exits 4 when --scenario filter matches nothing", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      await mkdir(join(tmpDir, "alpha"));
      await writeFile(join(tmpDir, "alpha", "scenario.yaml"), stringify({ prompt: "a\n" }));
      await writeFile(
        join(tmpDir, "alpha", "checks.yaml"),
        stringify({
          context: "alpha context",
          checks: [{ "check-a": { check: "alpha check", note: "note" } }],
        }),
      );
      const code = await runAndGetExit(["run", "--scenario", "nomatch", tmpDir]);
      expect(code).toBe(4);
    });

    it("list: exits 4 when no scenarios in evals dir", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      const code = await runAndGetExit(["list", tmpDir]);
      expect(code).toBe(4);
    });

    it("list: exits 4 when --scenario filter matches nothing", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      await mkdir(join(tmpDir, "alpha"));
      await writeFile(join(tmpDir, "alpha", "scenario.yaml"), stringify({ prompt: "a\n" }));
      await writeFile(
        join(tmpDir, "alpha", "checks.yaml"),
        stringify({
          context: "alpha context",
          checks: [{ "check-a": { check: "alpha check", note: "note" } }],
        }),
      );
      const code = await runAndGetExit(["list", "--scenario", "nomatch", tmpDir]);
      expect(code).toBe(4);
    });

    it("lint: exits 4 when no scenarios in evals dir", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      const code = await runAndGetExit(["lint", tmpDir]);
      expect(code).toBe(4);
    });

    it("lint: exits 4 when --scenario filter matches nothing", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      await mkdir(join(tmpDir, "alpha"));
      await writeFile(join(tmpDir, "alpha", "scenario.yaml"), stringify({ prompt: "a\n" }));
      await writeFile(
        join(tmpDir, "alpha", "checks.yaml"),
        stringify({
          context: "alpha context",
          checks: [{ "check-a": { check: "alpha check", note: "note" } }],
        }),
      );
      const code = await runAndGetExit(["lint", "--scenario", "nomatch", tmpDir]);
      expect(code).toBe(4);
    });

    it("run: exits 4 when all reps fail due to scuttlerun config errors", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      await writeFile(
        join(tmpDir, "base.yaml"),
        stringify({ project: { skills: ["/nonexistent/skill-path-for-test"] } }),
      );
      await mkdir(join(tmpDir, "alpha"));
      await writeFile(join(tmpDir, "alpha", "scenario.yaml"), stringify({ prompt: "a\n" }));
      await writeFile(
        join(tmpDir, "alpha", "checks.yaml"),
        stringify({
          context: "alpha context",
          checks: [{ "check-a": { check: "alpha check", note: "note" } }],
        }),
      );
      const code = await runAndGetExit(["run", "--repeats", "1", tmpDir]);
      expect(code).toBe(4);
    });

    it("lint: exits 4 when all pincenez lint invocations fail", async () => {
      await writeFile(join(tmpDir, "craboodle.yaml"), stringify({ version: "1" }));
      await mkdir(join(tmpDir, "alpha"));
      await writeFile(join(tmpDir, "alpha", "scenario.yaml"), stringify({ prompt: "a\n" }));
      // Invalid checks.yaml structure — pincenez lint rejects it at load time (exit 1)
      await writeFile(join(tmpDir, "alpha", "checks.yaml"), "not_a_checks_file: true\n");
      const code = await runAndGetExit(["lint", tmpDir]);
      expect(code).toBe(4);
    });
  });
});

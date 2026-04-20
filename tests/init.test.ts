import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);

describe("init", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "craboodle-init-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("creates craboodle.yaml and base.yaml with no example scenario", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const craboodleContent = await readFile(join(initDir, "craboodle.yaml"), "utf8");
    const craboodleData = parse(craboodleContent);
    expect(craboodleData).toHaveProperty("version");

    const entries = await readdir(initDir);
    expect([...entries].sort()).toEqual(["base.yaml", "craboodle.yaml"]);
  });

  it("base.yaml header documents the tools-array replace semantic", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const baseContent = await readFile(join(initDir, "base.yaml"), "utf8");
    expect(baseContent).toMatch(/REPLACE/);
  });

  it("base.yaml documents additional_tools: as the additive pattern", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const baseContent = await readFile(join(initDir, "base.yaml"), "utf8");
    expect(baseContent).toMatch(/^\s*#\s*additional_tools:/m);
  });

  it("base.yaml parses as empty (all fields commented)", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const baseContent = await readFile(join(initDir, "base.yaml"), "utf8");
    const parsed = parse(baseContent);
    expect(parsed ?? null).toBeNull();
  });

  it("omits min_pass_rate from the default template", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const craboodleContent = await readFile(join(initDir, "craboodle.yaml"), "utf8");
    const craboodleData = parse(craboodleContent);
    expect(craboodleData).not.toHaveProperty("min_pass_rate");
  });

  it("mentions min_pass_rate as a commented guidance line", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const craboodleContent = await readFile(join(initDir, "craboodle.yaml"), "utf8");
    expect(craboodleContent).toMatch(/^\s*#.*min_pass_rate/m);
  });

  it("surfaces the repeats default value (3) in the scaffold", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const craboodleContent = await readFile(join(initDir, "craboodle.yaml"), "utf8");
    expect(craboodleContent).toMatch(/^\s*#\s*repeats:.*\b3\b/m);
  });

  it("run --help documents CLI > config precedence for --repeats", async () => {
    const { stdout } = await execFileAsync("craboodle", ["run", "--help"]);
    expect(stdout).toContain("--repeats");
    expect(stdout).toMatch(/overrides\s+craboodle\.yaml|takes precedence/i);
  });
});

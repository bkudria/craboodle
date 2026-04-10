import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("generates checks.yaml in pincenez-accepted format", async () => {
    const initDir = join(tmpDir, "evals");
    await execFileAsync("craboodle", ["init", initDir]);

    const checksContent = await readFile(join(initDir, "hello-world", "checks.yaml"), "utf8");
    const checksData = parse(checksContent);

    // Must have a top-level `checks` key wrapping an array
    expect(checksData).toHaveProperty("checks");
    expect(Array.isArray(checksData.checks)).toBe(true);
    expect(checksData.checks.length).toBeGreaterThanOrEqual(1);

    // Each item must be a single-key object (id-as-key format)
    for (const entry of checksData.checks) {
      const keys = Object.keys(entry);
      expect(keys).toHaveLength(1);
      const value = entry[keys[0]];
      expect(value).toHaveProperty("check");
    }
  });
});

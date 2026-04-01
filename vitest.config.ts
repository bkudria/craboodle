import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 79,
        functions: 91,
        lines: 85,
      },
    },
  },
});

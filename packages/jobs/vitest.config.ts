import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});

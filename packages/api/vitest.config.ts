import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "integration-tests/**/*.test.ts"],
    // Module-heavy router tests can exceed the default timeout when run all at once.
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      "@kan/db": resolve(__dirname, "../db/src"),
    },
  },
});

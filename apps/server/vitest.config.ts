import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests share one database; run files one after another.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

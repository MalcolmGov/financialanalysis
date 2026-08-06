import { defineConfig } from "vitest/config";

// Unit tests for portal lib/ helpers (pure logic — reconciler, etc.).
// Route/workflow/UI code is covered by typecheck + build + the live demos.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});

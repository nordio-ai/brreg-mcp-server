import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fixture tier is the blocking gate; live tests are an opt-in canary.
    // `BRREG_LIVE=1 npm test` includes them.
    include: ["tests/**/*.test.ts"],
    exclude: process.env.BRREG_LIVE ? [] : ["tests/live/**"],
  },
});

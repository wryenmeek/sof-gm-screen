import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    exclude: ["**/node_modules/**", "**/test/visual/**"]
  }
});

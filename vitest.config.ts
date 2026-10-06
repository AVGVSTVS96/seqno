import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "features/*", "tools/*", "fixtures"],
    maxWorkers: 2,
  },
})

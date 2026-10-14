import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      "features/*",
      "tools/*",
      "fixtures",
      {
        root: "packages/graph",
        test: { name: "@seqno/graph v2", env: { SEQNO_GRAPH: "v2" } },
      },
      {
        root: "apps/web",
        test: {
          name: "@seqno/web v2",
          environment: "node",
          include: ["src/worker/test/**/*.test.ts"],
          env: { SEQNO_GRAPH: "v2" },
        },
      },
    ],
    maxWorkers: 2,
  },
})

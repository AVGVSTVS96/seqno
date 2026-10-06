import { defineProject } from "vitest/config"

export default defineProject({
  test: {
    name: "@seqno/web",
    environment: "node",
    include: ["test/**/*.test.ts", "src/worker/test/**/*.test.ts"],
  },
})

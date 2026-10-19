import { defineConfig } from "@playwright/test"
import { browserFlag } from "./src/browser.ts"
import { size } from "./src/size.ts"

const port = 4174

export default defineConfig({
  testDir: "src",
  testMatch: "*.bench.ts",
  workers: 1,
  timeout: size.years * size.density * 90_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: [browserFlag] },
  },
  webServer: {
    command: `pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})

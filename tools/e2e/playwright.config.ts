import { defineConfig } from "@playwright/test"
import { baseURL, externalUrl, managedServer, webAppExists } from "./src/env.ts"

const ci = process.env["CI"] !== undefined

export default defineConfig({
  testDir: "flows",
  testMatch: "*.e2e.ts",
  workers: 1,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  ...(externalUrl === undefined && webAppExists ? { webServer: managedServer } : {}),
})

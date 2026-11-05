import { defineConfig } from "@playwright/test"
import { baseURL, externalUrl, managedServer, webAppExists } from "./src/env.ts"

const ci = process.env["CI"] !== undefined

const config = defineConfig({
  testDir: "flows",
  testMatch: "*.e2e.ts",
  workers: 1,
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
})

if (externalUrl === undefined && webAppExists) {
  config.webServer = managedServer
}

export default config

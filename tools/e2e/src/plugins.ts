import { expect } from "@playwright/test"
import type { BrowserContext, Page, Route } from "@playwright/test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

const fixtures = fileURLToPath(new URL("../../../fixtures/logseq-plugins/", import.meta.url))

const cors = { "access-control-allow-origin": "*" }

const fulfill = (path: string) =>
  existsSync(path) ? { path, headers: cors } : { status: 404, headers: cors }

export const serveMarketplace = async (context: BrowserContext) => {
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/(plugins|stats)\.json$/u,
    async (route, request) => {
      await route.fulfill(
        fulfill(`${fixtures}${new URL(request.url()).pathname.split("/").at(-1) ?? ""}`),
      )
    },
  )
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/packages\//u,
    async (route) => {
      await route.fulfill({ status: 404, headers: cors })
    },
  )
  await context.route(/^https:\/\/plugins\.logseq\.io\/r2\//u, async (route, request) => {
    await route.fulfill(
      fulfill(
        `${fixtures}packages/${new URL(request.url()).pathname.replace("/r2/", "").replace("/", "__")}.json`,
      ),
    )
  })
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\//u, async (route, request) => {
    await route.fulfill(
      fulfill(`${fixtures}jsdelivr${decodeURIComponent(new URL(request.url()).pathname)}`),
    )
  })
  await context.route(
    /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//u,
    async (route) => {
      await route.fulfill({ status: 404, headers: cors })
    },
  )
  await context.route(/\/lsp\//u, async (route, request) => {
    await route.fulfill(
      fulfill(
        `${fixtures}files${decodeURIComponent(new URL(request.url()).pathname).replace(/^.*?\/lsp/u, "")}`,
      ),
    )
  })
}

export const serveOlderVersion = async (context: BrowserContext, repo: string, version: string) => {
  const url = `https://plugins.logseq.io/r2/${repo}`

  const older = async (route: Route) => {
    await route.fulfill(fulfill(`${fixtures}packages/${repo.replace("/", "__")}@${version}.json`))
  }

  await context.route(url, older)

  return async () => {
    await context.unroute(url, older)
  }
}

export const openPlugins = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()

  return page.getByRole("dialog", { name: "Plugins" })
}

export const useTheme = async (page: Page, title: string, theme: string) => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
  const card = dialog.getByRole("listitem", { name: title })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await dialog.getByRole("tab", { name: "Installed" }).click()
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
  await dialog.getByRole("radio", { name: new RegExp(`^${theme}( light| dark)?$`, "u") }).click()
  await page.keyboard.press("Escape")
}

const decodeSettings = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
)

export const settingsSaved = async (page: Page) => {
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("seqno.plugins.settings."))
          .map((key) => localStorage.getItem(key) ?? "{}"),
      )

      return saved.some((json) => Object.keys(decodeSettings(json)).length > 1)
    })
    .toBe(true)
}

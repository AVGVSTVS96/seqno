import { expect } from "@playwright/test"
import type { BrowserContext, Page, Route } from "@playwright/test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const fixtures = fileURLToPath(new URL("../../../fixtures/logseq-plugins/", import.meta.url))

const cors = { "access-control-allow-origin": "*" }

const fulfill = (path: string) =>
  existsSync(path) ? { path, headers: cors } : { status: 404, headers: cors }

export const serveMarketplace = async (context: BrowserContext) => {
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/(plugins|stats)\.json$/,
    async (route, request) => {
      await route.fulfill(
        fulfill(`${fixtures}${new URL(request.url()).pathname.split("/").at(-1) ?? ""}`),
      )
    },
  )
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/packages\//,
    async (route) => {
      await route.fulfill({ status: 404, headers: cors })
    },
  )
  await context.route(/^https:\/\/plugins\.logseq\.io\/r2\//, async (route, request) => {
    await route.fulfill(
      fulfill(
        `${fixtures}packages/${new URL(request.url()).pathname.replace("/r2/", "").replace("/", "__")}.json`,
      ),
    )
  })
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, async (route, request) => {
    await route.fulfill(
      fulfill(`${fixtures}jsdelivr${decodeURIComponent(new URL(request.url()).pathname)}`),
    )
  })
  await context.route(
    /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
    async (route) => {
      await route.fulfill({ status: 404, headers: cors })
    },
  )
  await context.route(/\/lsp\//, async (route, request) => {
    await route.fulfill(
      fulfill(
        `${fixtures}files${decodeURIComponent(new URL(request.url()).pathname).replace(/^.*?\/lsp/, "")}`,
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
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  const card = dialog.getByRole("listitem", { name: title })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await dialog.getByRole("tab", { name: "Installed" }).click()
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  await dialog.getByRole("radio", { name: new RegExp(`^${theme}( light| dark)?$`) }).click()
  await page.keyboard.press("Escape")
}

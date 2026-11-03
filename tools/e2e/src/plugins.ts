import { expect, type BrowserContext, type Page } from "@playwright/test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const fixtures = fileURLToPath(new URL("../../../fixtures/logseq-plugins/", import.meta.url))

const cors = { "access-control-allow-origin": "*" }

const fulfill = (path: string) =>
  existsSync(path) ? { path, headers: cors } : { status: 404, headers: cors }

export const serveMarketplace = async (context: BrowserContext) => {
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/(plugins|stats)\.json$/,
    (route, request) =>
      route.fulfill(
        fulfill(`${fixtures}${new URL(request.url()).pathname.split("/").at(-1) ?? ""}`),
      ),
  )
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/packages\//,
    (route) => route.fulfill({ status: 404, headers: cors }),
  )
  await context.route(/^https:\/\/plugins\.logseq\.io\/r2\//, (route, request) =>
    route.fulfill(
      fulfill(
        `${fixtures}packages/${new URL(request.url()).pathname.replace("/r2/", "").replace("/", "__")}.json`,
      ),
    ),
  )
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, (route, request) =>
    route.fulfill(
      fulfill(`${fixtures}jsdelivr${decodeURIComponent(new URL(request.url()).pathname)}`),
    ),
  )
  await context.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) =>
    route.fulfill({ status: 404, headers: cors }),
  )
  await context.route(
    /^https:\/\/pub-80f42b85b62c40219354a834fcf2bbfa\.r2\.dev\//,
    (route, request) =>
      route.fulfill(
        fulfill(`${fixtures}files${decodeURIComponent(new URL(request.url()).pathname)}`),
      ),
  )
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

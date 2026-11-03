import type { BrowserContext } from "@playwright/test"
import { fileURLToPath } from "node:url"

const fixtures = fileURLToPath(new URL("../../../fixtures/logseq-plugins/", import.meta.url))

const cors = { "access-control-allow-origin": "*" }

export const serveMarketplace = async (context: BrowserContext) => {
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/(plugins|stats)\.json$/,
    (route, request) =>
      route.fulfill({
        path: `${fixtures}${new URL(request.url()).pathname.split("/").at(-1) ?? ""}`,
        headers: cors,
      }),
  )
  await context.route(
    /^https:\/\/raw\.githubusercontent\.com\/logseq\/marketplace\/master\/packages\//,
    (route) => route.fulfill({ status: 404, headers: cors }),
  )
  await context.route(/^https:\/\/plugins\.logseq\.io\/r2\//, (route, request) =>
    route.fulfill({
      path: `${fixtures}packages/${new URL(request.url()).pathname.replace("/r2/", "").replace("/", "__")}.json`,
      headers: cors,
    }),
  )
  await context.route(
    /^https:\/\/pub-80f42b85b62c40219354a834fcf2bbfa\.r2\.dev\//,
    (route, request) =>
      route.fulfill({
        path: `${fixtures}files${decodeURIComponent(new URL(request.url()).pathname)}`,
        headers: cors,
      }),
  )
}

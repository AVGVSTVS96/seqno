import type { BrowserContext } from "@playwright/test"
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
  await context.route(
    /^https:\/\/pub-80f42b85b62c40219354a834fcf2bbfa\.r2\.dev\//,
    (route, request) =>
      route.fulfill(
        fulfill(`${fixtures}files${decodeURIComponent(new URL(request.url()).pathname)}`),
      ),
  )
}

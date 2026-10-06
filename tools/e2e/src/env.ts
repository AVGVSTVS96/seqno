import { existsSync } from "node:fs"
import { Schema } from "effect"

const managedPort = 4173
const managedUrl = `http://localhost:${managedPort}/`

export const externalUrl = Schema.decodeUnknownSync(Schema.UndefinedOr(Schema.URLFromString))(
  process.env["SEQNO_E2E_BASE_URL"],
)

export const baseURL = externalUrl?.href ?? managedUrl

export const webAppExists = existsSync(new URL("../../../apps/web/package.json", import.meta.url))

export const appAvailable = externalUrl !== undefined || webAppExists

export const managedServer = {
  command: `pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port ${managedPort} --strictPort`,
  url: managedUrl,
  reuseExistingServer: false,
  timeout: 180_000,
}

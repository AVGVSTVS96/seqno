import { existsSync } from "node:fs"
import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { Schema } from "effect"

const isPipe = (address: AddressInfo | string): address is string => typeof address === "string"

const freePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "localhost", () => {
      const address = server.address()
      server.close(() => {
        if (address !== null && !isPipe(address)) {
          resolve(address.port)
        } else {
          reject(new Error("no port"))
        }
      })
    })
  })

const managedPort =
  Schema.decodeUnknownSync(Schema.UndefinedOr(Schema.FiniteFromString))(
    process.env["SEQNO_E2E_PORT"],
  ) ?? (await freePort())

process.env["SEQNO_E2E_PORT"] = String(managedPort)

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

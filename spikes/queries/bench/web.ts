import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { chromium } from "playwright"
import { build } from "vite"

const web = join(import.meta.dirname, "..", "web")
const dist = join(web, "dist")
await build({ configFile: join(web, "vite.config.ts"), logLevel: "error" })
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" }

const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "") || "index.html"
  try {
    const body = await readFile(join(dist, path))
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = (server.address() as { port: number }).port

const query = process.argv
  .filter((a) => a.startsWith("--"))
  .map((a) => a.slice(2).replace(/-(\w)/g, (_, c: string) => c.toUpperCase()))
  .join("&")
const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/?${query}`)
  const handle = await page.waitForFunction(() => (window as { __result?: unknown }).__result, null, { timeout: 600_000, polling: 500 })
  const result = (await handle.jsonValue()) as { ok?: unknown; error?: string }
  if (result.error) throw new Error(result.error)
  console.log(JSON.stringify(result.ok, null, 2))
} finally {
  await browser.close()
  server.close()
}

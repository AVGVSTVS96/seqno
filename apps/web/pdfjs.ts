import { readdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { Plugin } from "vite"

const folders = ["cmaps", "standard_fonts", "wasm", "iccs"]

const distRoot = dirname(
  createRequire(new URL("../../features/pdf/package.json", import.meta.url)).resolve(
    "pdfjs-dist/package.json",
  ),
)

const filesOf = async (): Promise<readonly string[]> =>
  (
    await Promise.all(
      folders.map(async (folder) =>
        (await readdir(join(distRoot, folder))).map((name) => `${folder}/${name}`),
      ),
    )
  ).flat()

export const pdfjsAssets = (): Plugin => ({
  name: "seqno-pdfjs-assets",
  configureServer(server) {
    server.middlewares.use("/pdfjs/", (request, response, next) => {
      const path = (request.url ?? "").replace(/^\//, "").split("?")[0] ?? ""

      if (!folders.some((folder) => path.startsWith(`${folder}/`)) || path.includes("..")) {
        next()

        return
      }

      readFile(join(distRoot, path)).then(
        (source) => response.end(source),
        () => {
          next()
        },
      )
    })
  },
  async generateBundle() {
    if (this.environment.name !== "client") {
      return
    }

    for (const path of await filesOf()) {
      this.emitFile({
        type: "asset",
        fileName: `pdfjs/${path}`,
        source: new Uint8Array(await readFile(join(distRoot, path))),
      })
    }
  },
})

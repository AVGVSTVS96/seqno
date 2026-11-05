import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { relative } from "node:path"
import { transformWithOxc } from "vite"
import type { Plugin } from "vite"

const mirror = "https://pub-80f42b85b62c40219354a834fcf2bbfa.r2.dev"

const source = new URL("sw/sw.ts", import.meta.url).pathname

const precached = (file: string) => !/\.(?:map|ttf|woff)$/.test(file)

const filesIn = async (folder: string) =>
  (await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, `${entry.parentPath}/${entry.name}`))

export const offline = (): Plugin => ({
  name: "seqno-offline",
  enforce: "post",
  config: ({ base = "/" }) => {
    const proxy = {
      [`${base}lsp/`]: {
        target: mirror,
        changeOrigin: true,
        rewrite: (path: string) => path.slice(`${base}lsp`.length),
      },
    }

    return { server: { proxy }, preview: { proxy } }
  },
  async generateBundle(_, bundle) {
    if (this.environment.name !== "client") {
      return
    }

    const files = [...Object.keys(bundle), ...(await filesIn(this.environment.config.publicDir))]
      .filter(precached)
      .toSorted()

    const revision = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12)
    const { code } = await transformWithOxc(await readFile(source, "utf-8"), source)
    this.emitFile({
      type: "asset",
      fileName: "sw.js",
      source: `const build = ${JSON.stringify({ revision, files })};\n${code}`,
    })
  },
})

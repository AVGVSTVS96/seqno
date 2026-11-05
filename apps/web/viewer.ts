import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { readFile } from "node:fs/promises"
import type { ServerResponse } from "node:http"
import { build } from "vite"
import type { Connect, Plugin, Rolldown } from "vite"

const root = new URL(".", import.meta.url).pathname

export const viewerFolder = "publish"

type ViewerFile = readonly [path: string, source: string | Uint8Array]

const outputsOf = (
  result: Rolldown.RolldownOutput | Rolldown.RolldownOutput[] | Rolldown.RolldownWatcher,
): ReadonlyArray<Rolldown.OutputChunk | Rolldown.OutputAsset> =>
  Array.isArray(result)
    ? result.flatMap((each) => each.output)
    : "output" in result
      ? result.output
      : []

const OLDER_FONTS = /,url\([^)]*\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/gu

const woff2Fonts = (): Plugin => ({
  name: "seqno-viewer-woff2",
  enforce: "pre",
  transform: (code, id) =>
    id.includes("/katex.min.css") ? code.replaceAll(OLDER_FONTS, "") : null,
})

const buildViewer = async (): Promise<readonly ViewerFile[]> => {
  const result = await build({
    configFile: false,
    root,
    logLevel: "warn",
    base: "./",
    plugins: [woff2Fonts(), react(), babel({ presets: [reactCompilerPreset()] })],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: "src/publish/main.tsx",
        formats: ["iife"],
        name: "seqno",
        fileName: () => "static/js/seqno.js",
      },
    },
  })

  const icon = await readFile(new URL("public/favicon.svg", import.meta.url))

  return [
    ...outputsOf(result).map((output): ViewerFile => [
      output.fileName,
      output.type === "chunk" ? output.code : output.source,
    ]),
    ["static/img/logo.svg", new Uint8Array(icon)],
  ]
}

const manifest = (files: readonly ViewerFile[]) => JSON.stringify(files.map(([path]) => path))

const serve = async (
  served: Promise<readonly ViewerFile[]>,
  path: string,
  response: ServerResponse,
  next: Connect.NextFunction,
) => {
  let files: readonly ViewerFile[]

  try {
    files = await served
  } catch (error) {
    next(error)

    return
  }

  const found = path === "files.json" ? manifest(files) : files.find(([name]) => name === path)?.[1]

  if (found === undefined) {
    next()

    return
  }

  response.end(found)
}

export const viewer = (): Plugin => {
  let served: Promise<readonly ViewerFile[]> | null = null

  const respond: Connect.NextHandleFunction = (request, response, next) => {
    const path = (request.url ?? "").replace(/^\//u, "").split("?")[0] ?? ""

    if (path === "files.json") {
      served = buildViewer()
    }

    served ??= buildViewer()

    void serve(served, path, response, next)
  }

  return {
    name: "seqno-viewer",
    configureServer(server) {
      server.middlewares.use(`/${viewerFolder}/`, respond)
    },
    async generateBundle() {
      if (this.environment.name !== "client") {
        return
      }

      const files = await buildViewer()

      for (const [path, source] of files) {
        this.emitFile({ type: "asset", fileName: `${viewerFolder}/${path}`, source })
      }

      this.emitFile({
        type: "asset",
        fileName: `${viewerFolder}/files.json`,
        source: manifest(files),
      })
    },
  }
}

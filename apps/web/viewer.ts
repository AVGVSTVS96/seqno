import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { readFile } from "node:fs/promises"
import { build, type Plugin, type Rollup } from "vite"

const root = new URL(".", import.meta.url).pathname

export const viewerFolder = "publish"

type ViewerFile = readonly [path: string, source: string | Uint8Array]

const outputsOf = (
  result: Rollup.RollupOutput | ReadonlyArray<Rollup.RollupOutput> | Rollup.RollupWatcher,
): ReadonlyArray<Rollup.OutputChunk | Rollup.OutputAsset> =>
  Array.isArray(result)
    ? result.flatMap((each) => each.output)
    : "output" in result
      ? result.output
      : []

const buildViewer = async (): Promise<ReadonlyArray<ViewerFile>> => {
  const result = await build({
    configFile: false,
    root,
    logLevel: "warn",
    base: "./",
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
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

const manifest = (files: ReadonlyArray<ViewerFile>) => JSON.stringify(files.map(([path]) => path))

export const viewer = (): Plugin => {
  let served: Promise<ReadonlyArray<ViewerFile>> | null = null
  return {
    name: "seqno-viewer",
    configureServer(server) {
      server.middlewares.use(`/${viewerFolder}/`, (request, response, next) => {
        const path = (request.url ?? "").replace(/^\//, "").split("?")[0] ?? ""
        if (path === "files.json") served = buildViewer()
        served ??= buildViewer()
        void served.then(
          (files) => {
            const found =
              path === "files.json" ? manifest(files) : files.find(([name]) => name === path)?.[1]
            if (found === undefined) return next()
            response.end(found)
          },
          (error: unknown) => next(error),
        )
      })
    },
    async generateBundle() {
      if (this.environment.name !== "client") return
      const files = await buildViewer()
      for (const [path, source] of files)
        this.emitFile({ type: "asset", fileName: `${viewerFolder}/${path}`, source })
      this.emitFile({
        type: "asset",
        fileName: `${viewerFolder}/files.json`,
        source: manifest(files),
      })
    },
  }
}

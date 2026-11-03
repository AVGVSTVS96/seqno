const loadModules = async () => {
  const lib = await import("pdfjs-dist")
  lib.GlobalWorkerOptions.workerPort = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  })
  Reflect.set(globalThis, "pdfjsLib", lib)
  const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs")
  return { lib, viewer }
}

export type Pdfjs = Awaited<ReturnType<typeof loadModules>>

let loading: Promise<Pdfjs> | null = null

export const loadPdfjs = (): Promise<Pdfjs> => {
  loading ??= loadModules()
  return loading
}

export const pdfjsAssets = `${import.meta.env.BASE_URL}pdfjs/`

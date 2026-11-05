import { Effect, Result } from "effect"
import type { AtomRegistry } from "effect/reactivity"
import type { Block } from "@seqno/domain"
import { CoreClient } from "@seqno/rpc"
import { runCore, ensureRefPage } from "./annotations.ts"
import { emptyHighlightsFile, readHighlights } from "./highlights.ts"
import type { Highlights } from "./highlights.ts"
import { messageOf, notifyFailure } from "./host.ts"
import type { PdfFiles } from "./host.ts"
import { inflateAsset, isHlsPage, keyOfHlsPage } from "./model.ts"
import type { PdfAsset } from "./model.ts"
import { loadPdfjs, pdfjsAssets } from "./pdfjs.ts"
import { currentPdf, liveHighlights, refHighlight } from "./state.ts"
import type { CurrentPdf, Loaded } from "./state.ts"

const nameOf = (cause: unknown) => (cause instanceof Error ? cause.name : "Error")

export const readHighlightsFile = async (
  files: PdfFiles,
  asset: PdfAsset,
): Promise<Highlights | null> => {
  const url = files.resolveAsset(asset.hlsFile)

  try {
    const text =
      url === undefined
        ? await files
            .writeAsset(asset.hlsFile, new Blob([emptyHighlightsFile]))
            .then(() => emptyHighlightsFile)
        : await fetch(url).then(async (response) => await response.text())

    const read = readHighlights(text)

    if (Result.isSuccess(read)) {
      return read.success
    }

    throw new Error(read.failure)
  } catch (error) {
    files.notify(
      `Error: failed to load the highlights file: "${asset.hlsFile}". \n${messageOf(error)}`,
    )

    return null
  }
}

export const closePdf = (registry: AtomRegistry.AtomRegistry) => {
  registry.set(currentPdf, null)
}

const failed = (
  registry: AtomRegistry.AtomRegistry,
  files: PdfFiles,
  asset: PdfAsset,
  cause: unknown,
): Loaded => {
  const name = nameOf(cause)

  if (name === "PasswordException") {
    return { _tag: "Password" }
  }

  const message = messageOf(cause)
  files.notify(
    name === "InvalidPDFException"
      ? `Error: ${message}\nIs this .pdf file corrupted?\nPlease confirm with external pdf viewer.`
      : name === "MissingPDFException" || name === "ResponseException"
        ? `Error: ${message}\n Is this the correct path?`
        : `Error: ${name}\n${message}\nPlease confirm with pdf file resource.`,
  )

  if (registry.get(currentPdf)?.asset.identity === asset.identity) {
    closePdf(registry)
  }

  return { _tag: "Failed" }
}

const load = async (
  registry: AtomRegistry.AtomRegistry,
  files: PdfFiles,
  asset: PdfAsset,
  url: string,
  password: string,
): Promise<Loaded> => {
  try {
    const { lib } = await loadPdfjs()

    const [document, highlights] = await Promise.all([
      lib.getDocument({
        url,
        password,
        cMapUrl: `${pdfjsAssets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${pdfjsAssets}standard_fonts/`,
        wasmUrl: `${pdfjsAssets}wasm/`,
        iccUrl: `${pdfjsAssets}iccs/`,
      }).promise,
      readHighlightsFile(files, asset),
    ])

    return { _tag: "Ready", document, highlights, pdfjs: await loadPdfjs() }
  } catch (error) {
    return failed(registry, files, asset, error)
  }
}

const show = (
  registry: AtomRegistry.AtomRegistry,
  files: PdfFiles,
  asset: PdfAsset,
  url: string,
  attempt: number,
  password: string,
) => {
  const next: CurrentPdf = {
    asset,
    url,
    attempt,
    loading: load(registry, files, asset, url, password),
  }

  registry.set(currentPdf, next)
}

export const retryWithPassword = (
  registry: AtomRegistry.AtomRegistry,
  files: PdfFiles,
  current: CurrentPdf,
  password: string,
) => {
  show(registry, files, current.asset, current.url, current.attempt + 1, password)
}

const urlOf = (files: PdfFiles, path: string) =>
  files.resolveAsset(path) ?? (/^https?:\/\//iu.test(path) ? path : undefined)

export const openPdf = (registry: AtomRegistry.AtomRegistry, files: PdfFiles, path: string) => {
  const asset = inflateAsset(path)

  if (asset === null) {
    return
  }

  if (registry.get(currentPdf)?.asset.identity === asset.identity) {
    return
  }

  const url = urlOf(files, path)

  if (url === undefined) {
    files.notify(`Error: Missing PDF "${path}".\n Is this the correct path?`)

    return
  }

  show(registry, files, asset, url, 0, "")
  runCore(registry, ensureRefPage(asset)).catch(
    notifyFailure(files, `Couldn't make the page hls__${asset.key}`),
  )
}

const pageOf = async (registry: AtomRegistry.AtomRegistry, block: Block) =>
  await runCore(
    registry,
    Effect.flatMap(CoreClient, (client) => client.GetPage({ pageId: block.pageId })),
  ).then((tree) => tree.page)

export const openAnnotation = async (
  registry: AtomRegistry.AtomRegistry,
  files: PdfFiles,
  block: Block,
) => {
  const page = await pageOf(registry, block).catch(() => null)

  if (page === null || !isHlsPage(page.title)) {
    return
  }

  const key = keyOfHlsPage(page.title)
  const id = (block.props["id"] ?? block.id).toLowerCase()
  const hlsUrl = files.resolveAsset(`assets/${key}.edn`)

  const read =
    hlsUrl === undefined
      ? null
      : await fetch(hlsUrl)
          .then(async (response) => await response.text())
          .then((text) => Result.getOrNull(readHighlights(text)))
          .catch(() => null)

  const live = registry.get(liveHighlights)
  const pool = live?.key === key ? live.highlights : (read?.highlights ?? [])
  const highlight = pool.find((candidate) => candidate.id.toLowerCase() === id) ?? null
  const hlPage = Number(block.props["hl-page"])

  if (highlight === null && !Number.isInteger(hlPage)) {
    return
  }

  registry.set(refHighlight, { page: highlight?.page ?? hlPage, highlight })
  openPdf(registry, files, page.props["file-path"] ?? `../assets/${key}.pdf`)
}

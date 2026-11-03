import { Clock, Effect } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { AssetClient, type Asset } from "@seqno/rpc"
import type { Block } from "@seqno/domain"
import { openAnnotation, openPdf as openPdfViewer, type PdfFiles } from "@seqno/pdf"
import type { AssetBridge } from "@seqno/plugins"
import { assetFileName, assetLink, type Dialect } from "@seqno/syntax"
import { assetFiles, assetResolver, assetRuntime } from "../atoms.ts"
import { notify } from "./shell/Notices.tsx"

export const runAssets = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  effect: Effect.Effect<A, E, AssetClient>,
) =>
  Effect.runPromise(
    Effect.flatMap(AtomRegistry.getResult(registry, assetRuntime), (context) =>
      Effect.provide(effect, context),
    ),
  )

const bytesOf = (file: Blob) => Effect.promise(async () => new Uint8Array(await file.arrayBuffer()))

export const saveFile = (name: string, file: Blob, now: number, index: number) =>
  Effect.flatMap(Effect.zip(Effect.service(AssetClient), bytesOf(file)), ([client, data]) =>
    client.SaveAsset({ name: assetFileName(name, now, index), data }),
  )

export const writeFile = (path: string, file: Blob) =>
  Effect.flatMap(Effect.zip(Effect.service(AssetClient), bytesOf(file)), ([client, data]) =>
    client.WriteAsset({ path, data }),
  )

const labelOf = (file: File) => (file.name === "" ? "image" : file.name)

export const linksOf = (files: ReadonlyArray<File>, dialect: Dialect = "markdown") =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.forEach(files, (file, index) =>
      Effect.map(saveFile(labelOf(file), file, now, index), (saved: Asset) =>
        assetLink(labelOf(file), saved.path, dialect),
      ),
    ),
  )

const failed = (registry: AtomRegistry.AtomRegistry) => (cause: unknown) => {
  notify(
    registry,
    `Couldn't save the file: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
  return []
}

export const saveAssets = (
  registry: AtomRegistry.AtomRegistry,
  files: ReadonlyArray<File>,
  dialect: Dialect = "markdown",
) => runAssets(registry, linksOf(files, dialect)).catch(failed(registry))

export const saveAssetFiles = (
  registry: AtomRegistry.AtomRegistry,
  files: ReadonlyArray<File>,
): Promise<ReadonlyArray<Asset>> =>
  runAssets(
    registry,
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.forEach(files, (file, index) => saveFile(labelOf(file), file, now, index)),
    ),
  ).catch(failed(registry))

const removeFile = (path: string) =>
  Effect.flatMap(Effect.service(AssetClient), (client) => client.RemoveAsset({ path }))

export const pdfFiles = (registry: AtomRegistry.AtomRegistry): PdfFiles => ({
  resolveAsset: (path) => registry.get(assetResolver)(path),
  writeAsset: (path, data) => runAssets(registry, writeFile(path, data)).then(() => undefined),
  removeAsset: (path) => runAssets(registry, removeFile(path)),
  notify: (message) => notify(registry, message),
})

export const openPdf = (registry: AtomRegistry.AtomRegistry, path: string) =>
  openPdfViewer(registry, pdfFiles(registry), path)

export const openAnnotationBlock = (registry: AtomRegistry.AtomRegistry, block: Block) =>
  void openAnnotation(registry, pdfFiles(registry), block)

export const assetBridge = (registry: AtomRegistry.AtomRegistry): AssetBridge => ({
  listed: () => registry.get(assetFiles),
  write: (path, data) =>
    runAssets(
      registry,
      Effect.flatMap(Effect.service(AssetClient), (client) => client.WriteAsset({ path, data })),
    ),
  remove: (path) => runAssets(registry, removeFile(path)),
  openPdf: (path) => openPdf(registry, path),
})

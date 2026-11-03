import { Clock, Effect } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { AssetClient, type Asset } from "@seqno/rpc"
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

export const saveAssets = (
  registry: AtomRegistry.AtomRegistry,
  files: ReadonlyArray<File>,
  dialect: Dialect = "markdown",
) =>
  runAssets(registry, linksOf(files, dialect)).catch((cause: unknown) => {
    notify(
      registry,
      `Couldn't save the file: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    return []
  })

export const openPdf = (registry: AtomRegistry.AtomRegistry, path: string) => {
  const source = registry.get(assetResolver)(path)
  if (source !== undefined) window.open(source, "_blank", "noopener")
}

export const assetBridge = (registry: AtomRegistry.AtomRegistry): AssetBridge => ({
  listed: () => registry.get(assetFiles),
  write: (path, data) =>
    runAssets(
      registry,
      Effect.flatMap(Effect.service(AssetClient), (client) => client.WriteAsset({ path, data })),
    ),
  remove: (path) =>
    runAssets(
      registry,
      Effect.flatMap(Effect.service(AssetClient), (client) => client.RemoveAsset({ path })),
    ),
  openPdf: (path) => openPdf(registry, path),
})

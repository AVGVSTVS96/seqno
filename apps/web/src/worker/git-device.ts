import { Effect } from "effect"
import { GitFailed } from "@seqno/rpc"
import { layerGitDevice, type DeviceFile } from "./git.ts"

const gitFolder = Effect.promise(async () =>
  (await navigator.storage.getDirectory()).getDirectoryHandle("git", { create: true }),
)

const deviceFile = (name: string): DeviceFile => ({
  read: Effect.flatMap(gitFolder, (folder) =>
    Effect.promise(async () => {
      const file = await folder.getFileHandle(name).catch(() => null)
      return file === null ? null : (await file.getFile()).text()
    }),
  ),
  write: (text) =>
    Effect.flatMap(gitFolder, (folder) =>
      Effect.tryPromise({
        try: async () => {
          const writable = await (
            await folder.getFileHandle(name, { create: true })
          ).createWritable()
          await writable.write(text)
          await writable.close()
        },
        catch: (cause) => new GitFailed({ reason: `couldn't save git/${name}: ${String(cause)}` }),
      }),
    ),
})

export const BrowserGitDevice = layerGitDevice({
  settings: deviceFile("settings.json"),
  config: deviceFile("config.json"),
})

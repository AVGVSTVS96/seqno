import { Data, Effect, FileSystem, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { fileURLToPath } from "node:url"

export interface DownloadSource {
  readonly name: string
  readonly repo: string
  readonly commit: string
  readonly license: string
  readonly licenseFile: string
  readonly licenseLine: string
  readonly paths: ReadonlyArray<string>
}

export const logseqDocs: DownloadSource = {
  name: "logseq-docs",
  repo: "https://github.com/logseq/docs.git",
  commit: "08f855f24d66e4509b7ea808554c13b4649e6ee1",
  license: "MIT",
  licenseFile: "LICENSE.md",
  licenseLine: "MIT License",
  paths: ["pages", "journals", "logseq", "whiteboards"],
}

export const downloadSources: ReadonlyArray<DownloadSource> = [logseqDocs]

export const downloadsDir = fileURLToPath(new URL("../downloads/", import.meta.url))

export class DownloadError extends Data.TaggedError("DownloadError")<{ readonly source: string; readonly message: string }> {}

const git = Effect.fn("git")(function* (source: DownloadSource, cwd: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const code = yield* spawner.exitCode(ChildProcess.make("git", args, { cwd, stdout: "inherit", stderr: "inherit" }))
  if (code !== 0) return yield* new DownloadError({ source: source.name, message: `git ${args.join(" ")} exited with ${code}` })
})

export const download = Effect.fn("download")(function* (source: DownloadSource) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const dir = path.join(downloadsDir, source.name)
  const licensePath = path.join(dir, source.licenseFile)
  const head = (yield* fs.exists(path.join(dir, ".git")))
    ? (yield* spawner.string(ChildProcess.make("git", ["rev-parse", "HEAD"], { cwd: dir }))).trim()
    : ""
  if (head !== source.commit) {
    yield* fs.remove(dir, { recursive: true, force: true })
    yield* fs.makeDirectory(dir, { recursive: true })
    yield* git(source, dir, ["init", "--quiet"])
    yield* git(source, dir, ["remote", "add", "origin", source.repo])
    yield* git(source, dir, ["sparse-checkout", "set", ...source.paths])
    yield* git(source, dir, ["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", source.commit])
    yield* git(source, dir, ["checkout", "--quiet", "FETCH_HEAD"])
  }
  const license = yield* fs.readFileString(licensePath)
  if (!license.includes(source.licenseLine))
    return yield* new DownloadError({ source: source.name, message: `${source.licenseFile} no longer says "${source.licenseLine}"` })
  return dir
})

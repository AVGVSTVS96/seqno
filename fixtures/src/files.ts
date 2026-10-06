import { Effect, FileSystem, Path } from "effect"

export interface GraphFile {
  readonly path: string
  readonly content: string
}

export const writeGraph = Effect.fn("writeGraph")(function* (dir: string, files: ReadonlyArray<GraphFile>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const file of files) {
    const target = path.join(dir, file.path)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, file.content)
  }
})

export const readGraph = Effect.fn("readGraph")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(dir, { recursive: true })
  const files: GraphFile[] = []
  for (const entry of entries.toSorted()) {
    const info = yield* fs.stat(path.join(dir, entry))
    if (info.type === "File") files.push({ path: entry.split(path.sep).join("/"), content: yield* fs.readFileString(path.join(dir, entry)) })
  }
  return files
})

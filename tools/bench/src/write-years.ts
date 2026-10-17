import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DeviceId } from "@seqno/domain"
import { editLogDir, seenPath, snapshotName, snapshotPath, treePerPageMarker } from "@seqno/vault"
import { shapeOf, writeSlicesInFreshProcesses, type Layout } from "./years.ts"

const writer = DeviceId.make("bench")

const write = async (path: string, bytes: Uint8Array) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

export const writeYears = async (
  out: string,
  years: number,
  longPage: number,
  layout: Layout = "one-tree",
) => {
  const started = performance.now()
  const asked = { years, until: new Date(), longPage }
  const slices = await mkdtemp(join(tmpdir(), "seqno-years-"))
  try {
    const { snapshot, version } = await writeSlicesInFreshProcesses(slices, asked, layout)
    const log = layout === "tree-per-page" ? editLogDir : ""
    const name = await snapshotName(writer, snapshot)
    await write(join(out, log, snapshotPath(name)), snapshot)
    await write(
      join(out, log, seenPath(writer)),
      new TextEncoder().encode(
        JSON.stringify({ vv: version, verified: [], snapshots: [[name, version]] }),
      ),
    )
    if (layout === "tree-per-page") {
      await write(
        join(out, treePerPageMarker.path),
        new TextEncoder().encode(treePerPageMarker.text),
      )
    }
    const { days, pages, blocks } = shapeOf(asked)
    return {
      days,
      pages,
      blocks,
      bytes: snapshot.length,
      ms: Math.round(performance.now() - started),
    }
  } finally {
    await rm(slices, { recursive: true })
  }
}

if (import.meta.main) {
  const [out = "years", years = "10", longPage = "0", layout] = process.argv.slice(2)
  writeYears(
    out,
    Number(years),
    Number(longPage),
    layout === "tree-per-page" ? layout : "one-tree",
  ).then(
    (shape) => console.log(JSON.stringify(shape)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}

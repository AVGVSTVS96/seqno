import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { journalTitle } from "../src/journal.ts"
import { fixtureGraph } from "../src/opfs.ts"

export const showcaseDir = fixtureGraph("graphs/showcase")

export const assetPath = (name: string) => join(showcaseDir, "assets", name)

export interface Journal {
  readonly file: string
  readonly date: Date
  readonly title: string
  readonly markdown: string
}

const journalName = /^(\d{4})_(\d{2})_(\d{2})\.md$/

const dayOf = (file: string) => {
  const [, year, month, day] = journalName.exec(file) ?? []
  return new Date(Number(year), Number(month) - 1, Number(day))
}

const fileOf = (date: Date) =>
  `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, "0")}_${String(date.getDate()).padStart(2, "0")}.md`

const daysBetween = (later: Date, earlier: Date) =>
  Math.round((later.getTime() - earlier.getTime()) / 86_400_000)

const shifted = (today: Date, back: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)

export const showcaseJournals = async (today: Date): Promise<ReadonlyArray<Journal>> => {
  const files = (await readdir(join(showcaseDir, "journals")))
    .filter((file) => journalName.test(file))
    .toSorted()
    .toReversed()
  const newest = dayOf(files[0] ?? "")
  return Promise.all(
    files.map(async (file) => {
      const date = shifted(today, daysBetween(newest, dayOf(file)))
      return {
        file,
        date,
        title: journalTitle(date),
        markdown: await readFile(join(showcaseDir, "journals", file), "utf8"),
      }
    }),
  )
}

export const showcasePage = (file: string) => readFile(join(showcaseDir, "pages", file), "utf8")

export const withoutPageProperties = (markdown: string) =>
  markdown.slice(Math.max(0, markdown.search(/^- /m)))

export const materializeShowcase = async (today: Date) => {
  const dir = await mkdtemp(join(tmpdir(), "seqno-design-"))
  const journals = join(dir, "journals")
  await cp(showcaseDir, dir, {
    recursive: true,
    filter: (source) => !source.startsWith(join(showcaseDir, "journals")),
  })
  await mkdir(journals)
  for (const journal of await showcaseJournals(today)) {
    await writeFile(join(journals, fileOf(journal.date)), journal.markdown)
  }
  return dir
}

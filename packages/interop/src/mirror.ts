import { Effect, Schema } from "effect"
import { DeviceId, type Block, type BlockId, type Page, type Props } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { printConfig, type LogseqConfig } from "./config.ts"
import { formatJournalDay } from "./dates.ts"
import { fileBodyFromTitle } from "./filenames.ts"
import { GraphFolder } from "./folder.ts"
import { LogseqSyntax, type OutlineBlock } from "./outline.ts"

const blockRef = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

const referencedIds = (pages: ReadonlyArray<PageTree>): ReadonlySet<string> =>
  new Set(
    pages.flatMap(({ blocks }) =>
      blocks.flatMap((block) =>
        [block.text, ...Object.values(block.props)].flatMap((text) =>
          [...text.matchAll(blockRef)].map((match) => (match[1] ?? "").toLowerCase()),
        ),
      ),
    ),
  )

const outlineOf = (
  blocks: ReadonlyArray<Block>,
  referenced: ReadonlySet<string>,
): ReadonlyArray<OutlineBlock> => {
  const ids = new Set(blocks.map((block) => block.id))
  const children = Map.groupBy(blocks, (block) =>
    block.parentId !== null && ids.has(block.parentId) ? block.parentId : null,
  )
  const build = (parent: BlockId | null): ReadonlyArray<OutlineBlock> =>
    (children.get(parent) ?? []).map((block) => ({
      text: block.text,
      props:
        block.props["id"] === undefined && referenced.has(block.id.toLowerCase())
          ? { ...block.props, id: block.id }
          : block.props,
      collapsed: block.collapsed,
      children: build(block.id),
    }))
  return build(null)
}

const pageProps = (page: Page): Props =>
  page.props["title"] === undefined ? page.props : { ...page.props, title: page.title }

export const mirrorPath = (page: Page, config: LogseqConfig): string =>
  page.journalDay === null
    ? `${config.pagesDirectory}/${fileBodyFromTitle(page.title)}.md`
    : `${config.journalsDirectory}/${formatJournalDay(page.journalDay, config.journalFileFormat)}.md`

export const renderMirror = (pages: ReadonlyArray<PageTree>, config: LogseqConfig) =>
  Effect.gen(function* () {
    const syntax = yield* LogseqSyntax
    const referenced = referencedIds(pages)
    return new Map(
      pages
        .filter(({ page, blocks }) => blocks.length > 0 || Object.keys(page.props).length > 0)
        .map(({ page, blocks }) => [
          mirrorPath(page, config),
          syntax.print({ props: pageProps(page), blocks: outlineOf(blocks, referenced) }),
        ]),
    )
  })

export const MirrorOutcome = Schema.TaggedUnion({
  NotWriter: { writer: DeviceId },
  Mirrored: { written: Schema.Array(Schema.String), removed: Schema.Array(Schema.String) },
})
export type MirrorOutcome = typeof MirrorOutcome.Type

const isMirrorPage = (path: string, config: LogseqConfig): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return (
    (path.startsWith(`${config.journalsDirectory}/`) ||
      path.startsWith(`${config.pagesDirectory}/`)) &&
    path.endsWith(".md") &&
    !name.startsWith(".")
  )
}

export interface MirrorRequest {
  readonly device: DeviceId
  readonly writer: DeviceId
  readonly pages: ReadonlyArray<PageTree>
  readonly config: LogseqConfig
}

export const writeMirror = ({ device, writer, pages, config }: MirrorRequest) =>
  Effect.gen(function* () {
    if (device !== writer) return MirrorOutcome.cases.NotWriter.make({ writer })
    const folder = yield* GraphFolder
    const files = yield* renderMirror(pages, config)
    const listed = new Map((yield* folder.list).map((path) => [path.normalize("NFC"), path]))
    const stale = [...listed].filter(([path]) => isMirrorPage(path, config) && !files.has(path))
    yield* Effect.forEach(stale, ([, original]) => folder.remove(original), { discard: true })
    const changed = yield* Effect.filter([...files], ([path, text]) => {
      const original = listed.get(path)
      return original === undefined
        ? Effect.succeed(true)
        : Effect.map(
            Effect.orElseSucceed(folder.read(original), () => null),
            (current) => current !== text,
          )
    })
    yield* Effect.forEach(changed, ([path, text]) => folder.write(path, text), { discard: true })
    const configMissing = !listed.has("logseq/config.edn")
    if (configMissing) yield* folder.write("logseq/config.edn", printConfig(config))
    return MirrorOutcome.cases.Mirrored.make({
      written: [...changed.map(([path]) => path), ...(configMissing ? ["logseq/config.edn"] : [])],
      removed: stale.map(([path]) => path),
    })
  })

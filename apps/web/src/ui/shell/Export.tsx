import { useAtom, useAtomValue } from "@effect/atom-react"
import { IconX } from "@tabler/icons-react"
import { Clock, Effect, Option, Schema } from "effect"
import { AsyncResult, Atom } from "effect/reactivity"
import { domToBlob } from "modern-screenshot"
import { useId, useRef, useState } from "react"
import type { Block, BlockId, Page, PageId, Props } from "@seqno/domain"
import {
  exportBlocks,
  exportGraph,
  referencedIds,
  type BlockFormat,
  type ExportTarget,
  type GraphFormat,
  type IndentStyle,
} from "@seqno/export"
import { Outliner, PlainTextEditor } from "@seqno/outliner"
import { CoreClient, type ExportedTree } from "@seqno/rpc"
import { isHiddenProperty, joinProperties } from "@seqno/syntax"
import { appRuntime, assetResolver, openGraph, settingsLayer } from "../../atoms.ts"
import { closeDialogOf, Dialog, openDialog } from "./popover.tsx"

export interface ExportRequest {
  readonly name: string
  readonly target: ExportTarget
  readonly pages: ReadonlyArray<PageId>
}

export const exported = Atom.make<ExportRequest | null>(null).pipe(Atom.keepAlive)

const shown = (props: Props) => Object.entries(props).filter(([key]) => !isHiddenProperty(key))

export const childrenOf = (blocks: ReadonlyArray<Block>) => {
  const map = new Map<BlockId | null, Array<Block>>()
  for (const block of blocks) {
    const siblings = map.get(block.parentId)
    if (siblings === undefined) map.set(block.parentId, [block])
    else siblings.push(block)
  }
  return (id: BlockId | null): ReadonlyArray<Block> => map.get(id) ?? []
}

export const markdownOf = (
  children: (id: BlockId | null) => ReadonlyArray<Block>,
  block: Block,
  level = 0,
): string => {
  const pad = "\t".repeat(level)
  const text = joinProperties(block.text, shown(block.props))
  return [
    `${pad}- ${text.replaceAll("\n", `\n${pad}  `)}`,
    ...children(block.id).map((child) => markdownOf(children, child, level + 1)),
  ].join("\n")
}

type Format = BlockFormat | "png"

const formats: ReadonlyArray<readonly [Format, string]> = [
  ["text", "Text"],
  ["opml", "OPML"],
  ["html", "HTML"],
  ["png", "PNG"],
]

const Removal = Schema.Literals(["page-ref", "emphasis", "tag", "property"])
type Removal = typeof Removal.Type

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

const indentStyle = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.export.indentStyle",
  schema: Schema.Literals(["dashes", "spaces", "no-indent"]),
  defaultValue: (): IndentStyle => "dashes",
}).pipe(Atom.keepAlive)

const removals = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.export.removals",
  schema: Schema.Array(Removal),
  defaultValue: (): ReadonlyArray<Removal> => [],
}).pipe(Atom.keepAlive)

const format = Atom.make<Format>("text").pipe(Atom.keepAlive)
const newlineAfterBlock = Atom.make(false).pipe(Atom.keepAlive)
const level = Atom.make<number | null>(null).pipe(Atom.keepAlive)

const exportTrees = appRuntime.atom((get) => {
  const request = get(exported)
  return request === null
    ? Effect.succeed<ReadonlyArray<ExportedTree>>([])
    : Effect.flatMap(CoreClient, (core) => core.ExportPages({ from: request.pages }))
})

const fileName = (name: string, extension: string) =>
  `seqno_${name.replaceAll(/[\\/:*?"<>|]/g, "_")}.${extension}`

const save = (blob: Blob, name: string) => {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

const typeOf = { text: "text/plain", opml: "text/x-opml", html: "text/html" } as const
const extensionOf = { text: "txt", opml: "opml", html: "html", png: "png" } as const

const pictureOf = (element: HTMLElement | null) =>
  element === null ? Promise.resolve(null) : domToBlob(element, { scale: window.devicePixelRatio })

const Picture = ({
  target,
  transparent,
  pictured,
}: {
  readonly target: ExportTarget
  readonly transparent: boolean
  readonly pictured: (element: HTMLDivElement | null) => void
}) => {
  const resolveAsset = useAtomValue(assetResolver)
  const outline = (pageId: Page["id"], zoom: BlockId | null) => (
    <Outliner
      key={zoom ?? pageId}
      pageId={pageId}
      zoom={zoom}
      embedded
      onNavigate={() => undefined}
      editor={PlainTextEditor}
      resolveAsset={resolveAsset}
    />
  )
  const trees = AsyncResult.getOrElse(useAtomValue(exportTrees), () => [])
  const pageOf = (id: BlockId) =>
    trees.find((tree) => tree.blocks.some((block) => block.id === id))?.page.id
  return (
    <div className="export-dialog-picture" aria-label="Exported picture" role="img">
      <div className="export-dialog-picture-inner" data-transparent={transparent} ref={pictured}>
        {target._tag === "Page" ? (
          <>
            <h1 className="export-dialog-picture-title">
              {trees.find((tree) => tree.page.id === target.pageId)?.page.title}
            </h1>
            {outline(target.pageId, null)}
          </>
        ) : (
          target.blockIds.flatMap((id) => {
            const pageId = pageOf(id)
            return pageId === undefined ? [] : [outline(pageId, id)]
          })
        )}
      </div>
    </div>
  )
}

const Check = ({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) => (
  <label className="export-dialog-check">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    {label}
  </label>
)

const Options = ({ kind }: { readonly kind: BlockFormat }) => {
  const [indent, setIndent] = useAtom(indentStyle)
  const [removed, setRemoved] = useAtom(removals)
  const [newline, setNewline] = useAtom(newlineAfterBlock)
  const [upTo, setUpTo] = useAtom(level)
  const indentLabel = useId()
  const levelLabel = useId()
  const removal = (key: Removal, label: string) => (
    <Check
      label={label}
      checked={removed.includes(key)}
      onChange={(checked) =>
        setRemoved(checked ? [...removed, key] : removed.filter((entry) => entry !== key))
      }
    />
  )
  return (
    <div className="export-dialog-options">
      {kind === "text" ? (
        <div className="export-dialog-row">
          <label id={indentLabel}>Indentation style:</label>
          <select
            aria-labelledby={indentLabel}
            value={indent}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (value === "dashes" || value === "spaces" || value === "no-indent")
                setIndent(value)
            }}
          >
            <option value="dashes">dashes</option>
            <option value="spaces">spaces</option>
            <option value="no-indent">no-indent</option>
          </select>
        </div>
      ) : null}
      <div className="export-dialog-row">
        {removal("page-ref", "[[text]] -> text")}
        {removal("emphasis", "remove emphasis")}
        {removal("tag", "remove #tags")}
      </div>
      {kind === "text" ? (
        <div className="export-dialog-row">
          <Check label="newline after block" checked={newline} onChange={setNewline} />
          {removal("property", "remove properties")}
        </div>
      ) : null}
      <div className="export-dialog-row">
        <label id={levelLabel}>level &lt;=</label>
        <select
          aria-labelledby={levelLabel}
          value={upTo === null ? "all" : String(upTo)}
          onChange={(event) => {
            const value = event.currentTarget.value
            setUpTo(value === "all" ? null : Number(value))
          }}
        >
          {["all", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

const useExportText = (request: ExportRequest, kind: Format) => {
  const trees = useAtomValue(exportTrees)
  const indent = useAtomValue(indentStyle)
  const removed = useAtomValue(removals)
  const newline = useAtomValue(newlineAfterBlock)
  const upTo = useAtomValue(level)
  if (kind === "png") return null
  return AsyncResult.match(trees, {
    onInitial: () => null,
    onFailure: () => "",
    onSuccess: ({ value }) =>
      exportBlocks({ pages: value, referenced: referencedIds(value) }, request.target, kind, {
        indent,
        removeBrackets: removed.includes("page-ref"),
        removeEmphasis: removed.includes("emphasis"),
        removeTags: removed.includes("tag"),
        removeProperties: removed.includes("property"),
        newlineAfterBlock: newline,
        level: upTo,
      }),
  })
}

const ExportBody = ({ request }: { readonly request: ExportRequest }) => {
  const [kind, setKind] = useAtom(format)
  const [transparent, setTransparent] = useState(false)
  const [copied, setCopied] = useState(false)
  const picture = useRef<HTMLDivElement | null>(null)
  const text = useExportText(request, kind)
  const blob = () =>
    kind === "png"
      ? pictureOf(picture.current)
      : Promise.resolve(text === null ? null : new Blob([text], { type: typeOf[kind] }))
  const copy = () => {
    if (kind === "png") {
      void navigator.clipboard
        .write([new ClipboardItem({ "image/png": blob().then((png) => png ?? new Blob()) })])
        .then(() => setCopied(true))
        .catch(() => undefined)
      return
    }
    if (text === null) return
    const items: Record<string, Blob> = { "text/plain": new Blob([text], { type: "text/plain" }) }
    if (kind === "html") items["text/html"] = new Blob([text], { type: "text/html" })
    void navigator.clipboard
      .write([new ClipboardItem(items)])
      .then(() => setCopied(true))
      .catch(() => undefined)
  }
  return (
    <>
      <div className="export-dialog-head">
        <div className="export-dialog-formats" role="group" aria-label="Format">
          {formats.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kind === value ? "button-primary" : "button-secondary"}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value)
                setCopied(false)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Close"
          className="icon-button export-dialog-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
      </div>
      {kind === "png" ? (
        <>
          <Picture
            target={request.target}
            transparent={transparent}
            pictured={(element) => {
              picture.current = element
            }}
          />
          <div className="export-dialog-row">
            <Check
              label="Transparent background"
              checked={transparent}
              onChange={(checked) => {
                setTransparent(checked)
                setCopied(false)
              }}
            />
          </div>
        </>
      ) : (
        <>
          <textarea
            className="export-dialog-text"
            readOnly
            value={text ?? ""}
            aria-label="Exported text"
            aria-busy={text === null}
          />
          <Options kind={kind} />
        </>
      )}
      <div className="export-dialog-actions">
        <button type="button" className="button-primary" onClick={copy}>
          {copied ? "Copied to clipboard!" : "Copy to clipboard"}
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={() =>
            void blob().then((file) => {
              const stamp = request.target._tag === "Page" ? request.name : new Date().toISOString()
              if (file !== null) save(file, fileName(stamp, extensionOf[kind]))
            })
          }
        >
          Save to file
        </button>
      </div>
    </>
  )
}

export const ExportDialog = () => {
  const [value, setValue] = useAtom(exported)
  if (value === null) return null
  return (
    <dialog
      className="dialog export-dialog"
      aria-label="Export"
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) dialog.showModal()
      }}
      onClose={() => setValue(null)}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
    >
      <ExportBody request={value} />
    </dialog>
  )
}

export const graphExportDialogId = "seqno-export-graph"

const graphChoices: ReadonlyArray<readonly [GraphFormat, string]> = [
  ["edn", "Export as EDN"],
  ["json", "Export as JSON"],
  ["markdown", "Export as standard Markdown (no block properties)"],
  ["opml", "Export as OPML"],
  ["roam-json", "Export as Roam JSON"],
]

const exportGraphAs = appRuntime.fn((kind: GraphFormat, get) =>
  Effect.gen(function* () {
    const graph = Option.match(AsyncResult.value(get(openGraph)), {
      onNone: () => "graph",
      onSome: (opened) => opened.graph,
    })
    const trees = yield* Effect.flatMap(CoreClient, (core) => core.ExportPages({}))
    const paths = new Map(trees.map((tree) => [tree.page.id, tree.path]))
    const millis = yield* Clock.currentTimeMillis
    const file = exportGraph(trees, kind, {
      graph,
      seconds: Math.floor(millis / 1000),
      path: (page) => paths.get(page.id) ?? `pages/${page.name}.md`,
    })
    yield* Effect.sync(() =>
      save(new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name),
    )
  }),
)

export const GraphExportDialog = () => {
  const [running, run] = useAtom(exportGraphAs)
  const busy = AsyncResult.isWaiting(running)
  return (
    <Dialog id={graphExportDialogId} label="Export graph" className="export-graph-dialog">
      <div className="export-dialog-head">
        <h2 className="export-graph-title">Export</h2>
        <button
          type="button"
          aria-label="Close"
          className="icon-button export-dialog-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
      </div>
      <ul className="export-graph-choices" aria-busy={busy}>
        {graphChoices.map(([kind, label]) => (
          <li key={kind}>
            <button
              type="button"
              className="export-graph-choice"
              disabled={busy}
              onClick={() => run(kind)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

export const openGraphExport = () => openDialog(graphExportDialogId)

import { useAtom } from "@effect/atom-react"
import { IconX } from "@tabler/icons-react"
import { Atom } from "effect/reactivity"
import type { Block, BlockId, Props } from "@seqno/domain"
import { isHiddenProperty, joinProperties } from "@seqno/syntax"
import { closeDialogOf } from "./popover.tsx"

export interface Exported {
  readonly name: string
  readonly text: string
}

export const exported = Atom.make<Exported | null>(null).pipe(Atom.keepAlive)

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

export const pageMarkdown = (props: Props, blocks: ReadonlyArray<Block>) => {
  const children = childrenOf(blocks)
  const preamble = shown(props).map(([key, value]) => `${key}:: ${value}`)
  const body = children(null).map((block) => markdownOf(children, block))
  return [...preamble, ...(preamble.length > 0 ? [""] : []), ...body].join("\n")
}

const download = (name: string, text: string) => {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }))
  link.download = `${name.replaceAll(/[\\/:*?"<>|]/g, "_")}.md`
  link.click()
  URL.revokeObjectURL(link.href)
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
      <div className="export-dialog-head">
        <button type="button" className="button-primary" aria-pressed>
          Text
        </button>
        <button
          type="button"
          aria-label="Close"
          className="icon-button export-dialog-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
      </div>
      <textarea
        className="export-dialog-text"
        readOnly
        value={value.text}
        aria-label="Exported text"
      />
      <div className="export-dialog-actions">
        <button
          type="button"
          className="button-primary"
          onClick={(event) => {
            void navigator.clipboard.writeText(value.text).catch(() => undefined)
            closeDialogOf(event.currentTarget)
          }}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={() => download(value.name, value.text)}
        >
          Save to file
        </button>
      </div>
    </dialog>
  )
}

import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconHeading,
  IconHeadingOff,
  IconMinus,
} from "@tabler/icons-react"
import { AsyncResult, Atom } from "effect/reactivity"
import type { ComponentType } from "react"
import type { Block, BlockId, Command } from "@seqno/domain"
import { pageTreeAtom, type BlockMenuRequest } from "@seqno/outliner"
import { blockContent } from "@seqno/syntax"
import { dispatch, rightSidebar } from "../../atoms.ts"
import { Keys } from "./Keys.tsx"
import { MenuItem, MenuSeparator, onMenuKeyDown } from "./popover.tsx"

export const blockMenu = Atom.make<BlockMenuRequest | null>(null).pipe(Atom.keepAlive)

const exported = Atom.make<string | null>(null)

const colors = ["yellow", "red", "pink", "green", "blue", "purple", "gray"] as const

type Heading = 1 | 2 | 3 | 4 | 5 | 6 | "auto" | null

const headings: ReadonlyArray<
  readonly [Heading, string, ComponentType<{ readonly size: number }>]
> = [
  [1, "Heading 1", IconH1],
  [2, "Heading 2", IconH2],
  [3, "Heading 3", IconH3],
  [4, "Heading 4", IconH4],
  [5, "Heading 5", IconH5],
  [6, "Heading 6", IconH6],
  ["auto", "Auto heading", IconHeading],
  [null, "Remove heading", IconHeadingOff],
]

const headingPrefix = /^#{1,6}[ \t]+/

const levels = [1, 2, 3, 4, 5, 6] as const

const headingOf = (block: Block): Heading => {
  const level = levels.find((candidate) => candidate === blockContent(block.text).heading)
  return level ?? (block.props["heading"] === "true" ? "auto" : null)
}

const headingCommands = (block: Block, heading: Heading): ReadonlyArray<Command> => {
  const prefix = headingPrefix.exec(block.text)?.[0] ?? ""
  const wanted = typeof heading === "number" ? `${"#".repeat(heading)} ` : ""
  const text: ReadonlyArray<Command> =
    prefix === wanted
      ? []
      : [{ _tag: "EditText", blockId: block.id, from: 0, to: prefix.length, insert: wanted }]
  const auto = heading === "auto" ? "true" : null
  const prop: ReadonlyArray<Command> =
    (block.props["heading"] ?? null) === auto
      ? []
      : [
          {
            _tag: "SetProperty",
            target: { _tag: "BlockTarget", blockId: block.id },
            key: "heading",
            value: auto,
          },
        ]
  return [...text, ...prop]
}

const childrenOf = (blocks: ReadonlyArray<Block>) => {
  const map = new Map<BlockId | null, Array<Block>>()
  for (const block of blocks) {
    const siblings = map.get(block.parentId)
    if (siblings === undefined) map.set(block.parentId, [block])
    else siblings.push(block)
  }
  return (id: BlockId | null): ReadonlyArray<Block> => map.get(id) ?? []
}

const markdownOf = (
  children: (id: BlockId | null) => ReadonlyArray<Block>,
  block: Block,
  level: number,
): string => {
  const pad = "\t".repeat(level)
  return [
    `${pad}- ${block.text.replaceAll("\n", `\n${pad}  `)}`,
    ...children(block.id).map((child) => markdownOf(children, child, level + 1)),
  ].join("\n")
}

const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => undefined)

const close = (menu: HTMLElement) => menu.closest<HTMLElement>("[popover]")?.hidePopover()

const placeAt = (menu: HTMLElement, x: number, y: number) => {
  const below = y + menu.offsetHeight + 8 <= window.innerHeight
  const top = below ? y : Math.max(8, y - menu.offsetHeight)
  menu.style.setProperty("--anchor-x", `${x}px`)
  menu.style.setProperty("--anchor-y", `${top}px`)
  menu.style.setProperty("--shift", "0%")
  menu.style.setProperty("--inset", "8px")
  menu.style.setProperty("--origin", below ? "0% 0%" : "0% 100%")
}

const MenuView = ({
  request,
  blocks,
  onClose,
}: {
  readonly request: BlockMenuRequest
  readonly blocks: ReadonlyArray<Block>
  readonly onClose: () => void
}) => {
  const run = useAtomSet(dispatch)
  const updateSidebar = useAtomSet(rightSidebar)
  const setExported = useAtomSet(exported)
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const chosen = request.blockIds.flatMap((id) => {
    const block = byId.get(id)
    return block === undefined ? [] : [block]
  })
  const children = childrenOf(blocks)
  const first = chosen[0]
  const current = first === undefined ? null : headingOf(first)
  const numbered = chosen.every((block) => block.props["logseq.order-list-type"] === "number")
  const send = (commands: ReadonlyArray<Command>) => {
    for (const command of commands) run(command)
  }
  const property = (key: string, value: string | null) =>
    send(
      chosen.map((block) => ({
        _tag: "SetProperty",
        target: { _tag: "BlockTarget", blockId: block.id },
        key,
        value,
      })),
    )
  const markdown = () => chosen.map((block) => markdownOf(children, block, 0)).join("\n")
  const descendants = (block: Block): ReadonlyArray<Block> => [
    block,
    ...children(block.id).flatMap(descendants),
  ]
  const collapseAll = (collapsed: boolean) =>
    send(
      chosen
        .flatMap(descendants)
        .filter((block) => children(block.id).length > 0 && block.collapsed !== collapsed)
        .map((block) => ({ _tag: "SetCollapsed", blockId: block.id, collapsed })),
    )
  const remove = () => send([{ _tag: "DeleteBlocks", blockIds: request.blockIds }])
  return (
    <div
      popover="manual"
      role="menu"
      aria-label="Block actions"
      tabIndex={-1}
      className="menu block-menu"
      data-keeps-selection
      ref={(menu) => {
        if (menu === null) return
        menu.showPopover()
        placeAt(menu, request.x, request.y)
        menu.focus()
        const outside = (event: PointerEvent) => {
          if (!(event.target instanceof Node && menu.contains(event.target))) menu.hidePopover()
        }
        document.addEventListener("pointerdown", outside, true)
        return () => document.removeEventListener("pointerdown", outside, true)
      }}
      onToggle={(event) => {
        if (event.newState === "closed") onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.hidePopover()
        else onMenuKeyDown(event)
      }}
    >
      <div className="block-menu-colors">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="block-menu-color"
            title={color[0]?.toUpperCase() + color.slice(1)}
            aria-label={`${color} background`}
            style={{ "--swatch": `var(--swatch-${color})` }}
            onClick={(event) => {
              property("background-color", color)
              close(event.currentTarget)
            }}
          />
        ))}
        <button
          type="button"
          className="block-menu-color is-clear"
          title="Remove background"
          aria-label="Remove background"
          onClick={(event) => {
            property("background-color", null)
            close(event.currentTarget)
          }}
        >
          <IconMinus size={12} aria-hidden />
        </button>
      </div>
      <div className="block-menu-headings">
        {headings.map(([heading, label, Icon]) => (
          <button
            key={label}
            type="button"
            className="block-menu-heading"
            title={label}
            aria-label={label}
            aria-pressed={heading === current}
            onClick={(event) => {
              send(chosen.flatMap((block) => headingCommands(block, heading)))
              close(event.currentTarget)
            }}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <MenuSeparator />
      <MenuItem
        hint={<Keys keys={["shift", "Click"]} />}
        onSelect={() =>
          updateSidebar({
            _tag: "Open",
            item: { _tag: "Block", blockId: request.blockIds[0] },
          })
        }
      >
        Open in sidebar
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => copy(request.blockIds.map((id) => `((${id}))`).join("\n"))}>
        Copy block ref
      </MenuItem>
      <MenuItem
        onSelect={() => copy(request.blockIds.map((id) => `{{embed ((${id}))}}`).join("\n"))}
      >
        Copy block embed
      </MenuItem>
      <MenuItem onSelect={() => setExported(markdown())}>Copy / Export as..</MenuItem>
      <MenuItem
        hint={<Keys keys={["mod", "x"]} />}
        onSelect={() => {
          copy(markdown())
          remove()
        }}
      >
        Cut
      </MenuItem>
      <MenuItem hint={<Keys keys={["Delete"]} framed />} onSelect={remove}>
        Delete selected blocks
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => property("logseq.order-list-type", numbered ? null : "number")}>
        Toggle number list
      </MenuItem>
      <MenuSeparator />
      <MenuItem hint={<Keys keys={["mod", "↓"]} />} onSelect={() => collapseAll(false)}>
        Expand all
      </MenuItem>
      <MenuItem hint={<Keys keys={["mod", "↑"]} />} onSelect={() => collapseAll(true)}>
        Collapse all
      </MenuItem>
    </div>
  )
}

const noBlocks: ReadonlyArray<Block> = []

const LoadedMenu = ({
  request,
  onClose,
}: {
  readonly request: BlockMenuRequest
  readonly onClose: () => void
}) => {
  const tree = useAtomValue(pageTreeAtom(request.pageId))
  const blocks = AsyncResult.getOrElse(
    AsyncResult.map(tree, (value) => value.blocks),
    () => noBlocks,
  )
  return blocks.length === 0 ? null : (
    <MenuView request={request} blocks={blocks} onClose={onClose} />
  )
}

const ExportDialog = ({
  text,
  onClose,
}: {
  readonly text: string
  readonly onClose: () => void
}) => (
  <dialog
    className="dialog export-dialog"
    aria-label="Export blocks"
    ref={(dialog) => {
      if (dialog !== null && !dialog.open) dialog.showModal()
    }}
    onClose={onClose}
    onClick={(event) => {
      if (event.target === event.currentTarget) event.currentTarget.close()
    }}
  >
    <div className="export-dialog-head">
      <span className="export-dialog-title">Text</span>
    </div>
    <textarea className="export-dialog-text" readOnly value={text} aria-label="Exported text" />
    <div className="export-dialog-actions">
      <button
        type="button"
        className="button-primary"
        onClick={(event) => {
          void navigator.clipboard.writeText(text).catch(() => undefined)
          event.currentTarget.closest("dialog")?.close()
        }}
      >
        Copy
      </button>
    </div>
  </dialog>
)

export const BlockMenu = () => {
  const [request, setRequest] = useAtom(blockMenu)
  const [text, setText] = useAtom(exported)
  return (
    <>
      {request === null ? null : (
        <LoadedMenu
          key={`${request.x},${request.y},${request.blockIds.join()}`}
          request={request}
          onClose={() => setRequest(null)}
        />
      )}
      {text === null ? null : <ExportDialog text={text} onClose={() => setText(null)} />}
    </>
  )
}

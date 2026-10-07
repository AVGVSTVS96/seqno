import {
  use,
  useContext,
  useRef,
  useState,
  type ComponentType,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Block, BlockId, Command, GraphEvent, PageId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { pastedBlocks, plainText, setMarker, type Inline, type Marker } from "@seqno/syntax"
import { BlockView } from "./BlockView.tsx"
import { caretFromPoint, hasTextSelection } from "./caret.ts"
import {
  blockAtom,
  blockRefCountsAtom,
  dispatchAtom,
  editRequest,
  pageNamedAtom,
  pageTreeAtom,
  type Editing,
} from "./core.ts"
import { moveCommand, type DropTarget } from "./drop.ts"
import { offsets, segments, windowOf, type Viewport } from "./layout.ts"
import type { Navigate, OpenBlockMenu } from "./navigation.ts"
import { PlainTextEditor } from "./PlainTextEditor.tsx"
import {
  clickOnEnter,
  contentOf,
  RenderContext,
  type EmbedTarget,
  type Renderer,
} from "./render.ts"
import { RowView, type RowActions } from "./Row.tsx"
import { highlights, selectedRange, type Selection } from "./selection.ts"
import { EditorIntent, type EditorSlotProps } from "./slot.ts"
import { nextMarker } from "./tasks.ts"
import { outline, topLevel, type Outline, type Row } from "./tree.ts"
import styles from "./outliner.css?inline"

export interface OutlinerProps {
  readonly pageId: PageId
  readonly zoom: BlockId | null
  readonly onNavigate: Navigate
  readonly editor?: ComponentType<EditorSlotProps>
  readonly embedded?: boolean
  readonly resolveAsset?: (path: string) => string | undefined
  readonly onBlockMenu?: OpenBlockMenu
}

export const Outliner = (props: OutlinerProps) =>
  AsyncResult.match(useAtomValue(pageTreeAtom(props.pageId)), {
    onInitial: () => (
      <div className="seqno-outliner-status" role="status">
        Loading page
      </div>
    ),
    onFailure: () => (
      <div className="seqno-outliner-status" role="alert">
        This page could not be loaded.{" "}
        <a
          role="link"
          tabIndex={0}
          onClick={() => props.onNavigate({ _tag: "Journals" })}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onNavigate({ _tag: "Journals" })
          }}
        >
          Go to journals
        </a>
      </div>
    ),
    onSuccess: ({ value }) => <OutlineView tree={value} {...props} />,
  })

const noCounts: Readonly<Record<string, number>> = {}

const overscan = 800
const edgeMargin = "400px 0px"
const orderListKey = "logseq.order-list-type"
const numbered = /^[ \t]*logseq\.order-list-type::[ \t]*number[ \t]*$/m

const createdBlock = (events: ReadonlyArray<GraphEvent>, except: BlockId) =>
  events.flatMap((event) =>
    event._tag === "BlockUpserted" && event.block.id !== except ? [event.block.id] : [],
  )[0]

const nonEmpty = <A,>(items: ReadonlyArray<A>): readonly [A, ...Array<A>] | null => {
  const [first, ...rest] = items
  return first === undefined ? null : [first, ...rest]
}

const viewportOf = (element: HTMLElement | null, current: Viewport): Viewport => {
  if (element === null) return current
  const box = element.getBoundingClientRect()
  const top = Math.round(-box.top)
  const bottom = Math.round(window.innerHeight - box.top)
  return top === current.top && bottom === current.bottom ? current : { top, bottom }
}

const ordinalsOf = (rows: ReadonlyArray<Row>): ReadonlyArray<number | null> => {
  const streaks = new Map<BlockId | null, number>()
  return rows.map((row) => {
    const listed = row.block.props[orderListKey] === "number" || numbered.test(row.block.text)
    const streak = listed ? (streaks.get(row.block.parentId) ?? 0) + 1 : 0
    streaks.set(row.block.parentId, streak)
    return streak === 0 ? null : streak
  })
}

const labelOf = (nodes: ReadonlyArray<Inline>): string =>
  nodes
    .map((node) =>
      node._tag === "PageRef"
        ? node.name
        : node._tag === "Bold" ||
            node._tag === "Italic" ||
            node._tag === "Strike" ||
            node._tag === "Highlight"
          ? labelOf(node.children)
          : plainText([node]),
    )
    .join("")

const markdownOf = (view: Outline, blockId: BlockId, level: number): string => {
  const block = view.rows.find((row) => row.block.id === blockId)?.block
  if (block === undefined) return ""
  const pad = "\t".repeat(level)
  const own = `${pad}- ${block.text.replaceAll("\n", `\n${pad}  `)}`
  return [own, ...view.children(blockId).map((child) => markdownOf(view, child.id, level + 1))]
    .filter((line) => line !== "")
    .join("\n")
}

const Breadcrumbs = ({
  title,
  trail,
  onNavigate,
  pageId,
}: {
  readonly title: string
  readonly trail: ReadonlyArray<Block>
  readonly onNavigate: Navigate
  readonly pageId: PageId
}) => {
  const go = (blockId: BlockId | null) => (event: MouseEvent) => {
    event.preventDefault()
    onNavigate(
      event.shiftKey && blockId !== null
        ? { _tag: "SidebarBlock", blockId }
        : { _tag: "Zoom", pageId, blockId },
    )
  }
  return (
    <nav className="seqno-crumbs" aria-label="Breadcrumbs">
      <a role="link" tabIndex={0} onKeyDown={clickOnEnter} onClick={go(null)}>
        {title}
      </a>
      {trail.map((block) => (
        <span key={block.id} className="seqno-crumb">
          <span className="seqno-crumb-sep" aria-hidden>
            /
          </span>
          <a role="link" tabIndex={0} onKeyDown={clickOnEnter} onClick={go(block.id)}>
            {labelOf(contentOf(block.text).title ?? [])}
          </a>
        </span>
      ))}
    </nav>
  )
}

const stopEvent = (event: { stopPropagation: () => void }) => event.stopPropagation()

const Embed = ({ children }: { readonly children: ReactNode }) => (
  <div
    className="seqno-embed"
    onClick={stopEvent}
    onDragOver={stopEvent}
    onDrop={stopEvent}
    onKeyDown={stopEvent}
  >
    {children}
  </div>
)

const useEmbedProps = () => {
  const renderer = use(RenderContext)
  return {
    onNavigate: renderer.navigate,
    editor: renderer.editor,
    resolveAsset: renderer.resolveAsset,
  }
}

const BlockEmbed = ({ blockId, bare }: { readonly blockId: BlockId; readonly bare: boolean }) => {
  const props = useEmbedProps()
  return AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => (bare ? null : <Embed>{null}</Embed>),
    onFailure: () => <span className="seqno-blockref is-missing">(({blockId}))</span>,
    onSuccess: ({ value }) => {
      const embedded = <Outliner {...props} pageId={value.pageId} zoom={value.id} embedded />
      return bare ? embedded : <Embed>{embedded}</Embed>
    },
  })
}

const PageEmbed = ({ name, bare }: { readonly name: string; readonly bare: boolean }) => {
  const props = useEmbedProps()
  return AsyncResult.match(useAtomValue(pageNamedAtom(name)), {
    onInitial: () => (bare ? null : <Embed>{null}</Embed>),
    onFailure: () => <span className="seqno-macro">{`{{embed [[${name}]]}}`}</span>,
    onSuccess: ({ value }) =>
      value === undefined ? (
        <span className="seqno-macro">{`{{embed [[${name}]]}}`}</span>
      ) : bare ? (
        <Outliner {...props} pageId={value.id} zoom={null} embedded />
      ) : (
        <Embed>
          <a
            role="link"
            tabIndex={0}
            onKeyDown={clickOnEnter}
            className="seqno-embed-title"
            onClick={(event) => {
              event.preventDefault()
              props.onNavigate(
                event.shiftKey
                  ? { _tag: "SidebarPage", name: value.name }
                  : { _tag: "Page", name: value.name },
              )
            }}
          >
            {value.title}
          </a>
          <Outliner {...props} pageId={value.id} zoom={null} embedded />
        </Embed>
      ),
  })
}

const EmbedView = ({
  target,
  bare = false,
}: {
  readonly target: EmbedTarget
  readonly bare?: boolean
}) =>
  target._tag === "Block" ? (
    <BlockEmbed blockId={target.blockId} bare={bare} />
  ) : (
    <PageEmbed name={target.name} bare={bare} />
  )

const dropZone = (event: DragEvent<HTMLDivElement>, row: Row): DropTarget => {
  const box = event.currentTarget.getBoundingClientRect()
  const lower = event.clientY - box.top >= box.height / 2
  const step = Number.parseFloat(
    getComputedStyle(event.currentTarget).getPropertyValue("--block-indent"),
  )
  const nested = event.clientX - box.left >= (row.depth + 2) * (Number.isNaN(step) ? 30 : step)
  return { blockId: row.block.id, zone: !lower ? "before" : nested ? "child" : "after" }
}

const OutlineView = ({
  tree,
  pageId,
  zoom,
  onNavigate,
  editor: Editor = PlainTextEditor,
  embedded = false,
  resolveAsset,
  onBlockMenu,
}: OutlinerProps & { readonly tree: PageTree }) => {
  const parent = use(RenderContext)
  const counts = AsyncResult.getOrElse(useAtomValue(blockRefCountsAtom), () => noCounts)
  const view = outline(tree, zoom, embedded)
  const rows = view.rows
  const registry = useContext(RegistryContext)
  const run = useAtomSet(dispatchAtom, { mode: "promiseExit" })
  const container = useRef<HTMLDivElement>(null)
  const pressed = useRef<BlockId | null>(null)
  const swept = useRef(false)
  const [localEditing, setLocalEditing] = useState<Editing | null>(null)
  const [request, setRequest] = useAtom(editRequest)
  const requested =
    request !== null && !embedded && rows.some((row) => row.block.id === request.blockId)
      ? request
      : null
  const editing = requested ?? localEditing
  const setEditing = (next: Editing | null) => {
    setLocalEditing(next)
    if (request !== null) setRequest(null)
  }
  const [selection, setSelection] = useState<Selection | null>(null)
  const [dragged, setDragged] = useState<ReadonlyArray<BlockId>>([])
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [hoveredGuide, setHoveredGuide] = useState<BlockId | null>(null)
  const [viewport, setViewport] = useState<Viewport>(() => ({
    top: 0,
    bottom: window.innerHeight,
  }))
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const [rowObserver] = useState(
    () =>
      new ResizeObserver((entries) => {
        const measured = entries.flatMap((entry) => {
          const id =
            entry.target instanceof HTMLElement ? entry.target.dataset["blockId"] : undefined
          const size = entry.borderBoxSize[0]?.blockSize
          return id === undefined || size === undefined ? [] : [[id, size] as const]
        })
        setHeights((previous) =>
          measured.every(([id, size]) => previous.get(id) === size)
            ? previous
            : new Map([...previous, ...measured]),
        )
      }),
  )
  const [edgeObserver] = useState(
    () =>
      new IntersectionObserver(
        () => setViewport((current) => viewportOf(container.current, current)),
        { rootMargin: edgeMargin, scrollMargin: edgeMargin },
      ),
  )

  const measure = (element: HTMLDivElement | null) => {
    if (element === null) return
    rowObserver.observe(element)
    return () => rowObserver.unobserve(element)
  }

  const watchEdge = (element: HTMLDivElement | null) => {
    if (element === null) return
    edgeObserver.observe(element)
    return () => edgeObserver.unobserve(element)
  }

  const dispatch = (command: Command) => {
    void run(command)
  }
  const after = (command: Command, then: (events: ReadonlyArray<GraphEvent>) => void) => {
    void run(command).then(Exit.match({ onFailure: () => undefined, onSuccess: then }))
  }

  const indexOf = (blockId: BlockId) => rows.findIndex((row) => row.block.id === blockId)
  const range = selectedRange(rows, selection)
  const selected = range === null ? [] : rows.slice(range[0], range[1]).map((row) => row.block.id)
  const selectedSet = new Set(selected)
  const highlighted = highlights(rows, range)
  const ordinals = ordinalsOf(rows)
  const tops = offsets(rows, heights)
  const [from, to] = windowOf(tops, viewport, overscan)
  const editingIndex = editing === null ? -1 : indexOf(editing.blockId)
  const shown = [
    ...Array.from({ length: to - from }, (_, offset) => from + offset),
    editingIndex,
    ...dragged.map(indexOf),
  ]
  const parts = segments(tops, shown)

  const reveal = (blockId: BlockId) => {
    container.current
      ?.querySelector(`[data-block-id="${blockId}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }

  const edit = (block: Block, caret: number) => {
    setSelection(null)
    setEditing({ blockId: block.id, caret })
  }

  const focusTree = () => container.current?.focus({ preventScroll: true })

  const select = (blockId: BlockId, anchor: BlockId = blockId) => {
    setEditing(null)
    setSelection({ anchor, head: blockId })
    focusTree()
    reveal(blockId)
  }

  const latest = (): Outline =>
    Option.match(AsyncResult.value(registry.get(pageTreeAtom(pageId))), {
      onNone: () => view,
      onSome: (current) => outline(current, zoom, embedded),
    })

  const setTask = (block: Block, marker: Marker | null) => {
    const change = setMarker(block.text, marker)
    if (change !== null) dispatch({ _tag: "EditText", blockId: block.id, ...change })
  }

  const moveBy = (now: Outline, blockIds: ReadonlyArray<BlockId>, direction: -1 | 1) => {
    const [first] = blockIds
    const last = blockIds.at(-1)
    const chosen = nonEmpty(blockIds)
    if (first === undefined || last === undefined || chosen === null) return
    const parentId = now.parentOf(first)
    if (blockIds.some((id) => now.parentOf(id) !== parentId)) return
    const siblings = now.children(parentId)
    const start = siblings.findIndex((block) => block.id === first)
    const end = siblings.findIndex((block) => block.id === last)
    if (direction === -1 && start > 0) {
      const before = siblings[start - 2]
      dispatch({
        _tag: "MoveBlocks",
        blockIds: chosen,
        parentId,
        ...(before === undefined ? {} : { after: before.id }),
      })
    } else if (direction === 1 && end !== -1 && end < siblings.length - 1) {
      const next = siblings[end + 1]
      if (next !== undefined)
        dispatch({ _tag: "MoveBlocks", blockIds: chosen, parentId, after: next.id })
    }
  }

  const onIntent = (blockId: BlockId) => (intent: EditorIntent) => {
    const now = latest()
    const index = now.rows.findIndex((row) => row.block.id === blockId)
    const row = now.rows[index]
    if (row === undefined) return
    const block = row.block
    const previous = now.rows[index - 1]?.block
    const next = now.rows[index + 1]?.block
    const siblings = now.children(block.parentId)
    const isLastChild = siblings[siblings.length - 1]?.id === block.id
    EditorIntent.match(intent, {
      Split: ({ at }) => {
        if (block.text === "" && block.parentId !== null && block.id !== zoom && isLastChild) {
          dispatch({ _tag: "Outdent", blockIds: [block.id] })
          return
        }
        after({ _tag: "SplitBlock", blockId: block.id, at }, (events) => {
          const created = createdBlock(events, block.id)
          if (created !== undefined) setEditing({ blockId: created, caret: 0 })
        })
      },
      MergeWithPrevious: () => {
        if (previous === undefined) return
        dispatch({ _tag: "MergeWithPrevious", blockId: block.id })
        edit(previous, previous.text.length)
      },
      Indent: () => dispatch({ _tag: "Indent", blockIds: [block.id] }),
      Outdent: () => dispatch({ _tag: "Outdent", blockIds: [block.id] }),
      FocusPrevious: () => {
        if (previous !== undefined) edit(previous, previous.text.length)
      },
      FocusNext: () => {
        if (next !== undefined) edit(next, 0)
      },
      Exit: () => select(block.id),
      SelectUp: () => select(previous?.id ?? block.id, block.id),
      SelectDown: () => select(next?.id ?? block.id, block.id),
      MoveUp: () => moveBy(now, [block.id], -1),
      MoveDown: () => moveBy(now, [block.id], 1),
      Collapse: () => {
        if (row.hasChildren) dispatch({ _tag: "SetCollapsed", blockId: block.id, collapsed: true })
      },
      Expand: () => {
        if (row.hasChildren) dispatch({ _tag: "SetCollapsed", blockId: block.id, collapsed: false })
      },
    })
  }

  const copy = (blockIds: ReadonlyArray<BlockId>) =>
    navigator.clipboard
      .writeText(blockIds.map((id) => markdownOf(view, id, 0)).join("\n"))
      .catch(() => undefined)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const head = selection === null ? -1 : indexOf(selection.head)
    const anchor = selection === null ? -1 : indexOf(selection.anchor)
    const chosen = nonEmpty(topLevel(view, selected))
    const vertical = key === "ArrowUp" || key === "ArrowDown"
    const down = key === "ArrowDown"
    if (mod && key === "z" && !event.shiftKey) dispatch({ _tag: "Undo" })
    else if (mod && ((key === "z" && event.shiftKey) || key === "y")) dispatch({ _tag: "Redo" })
    else if (vertical && event.altKey && event.shiftKey && chosen !== null) {
      moveBy(view, chosen, down ? 1 : -1)
    } else if (vertical && mod) {
      for (const id of selected) {
        if (rows[indexOf(id)]?.hasChildren === true) {
          dispatch({ _tag: "SetCollapsed", blockId: id, collapsed: !down })
        }
      }
    } else if (vertical && event.shiftKey && selection !== null) {
      const target = down ? (head >= anchor ? (rows[head]?.end ?? head + 1) : head + 1) : head - 1
      const row = rows[Math.max(0, Math.min(rows.length - 1, target))]
      if (row !== undefined) select(row.block.id, selection.anchor)
    } else if (vertical) {
      const target = head === -1 ? (down ? 0 : rows.length - 1) : head + (down ? 1 : -1)
      const row = rows[Math.max(0, Math.min(rows.length - 1, target))]
      if (row !== undefined) select(row.block.id)
    } else if (key === "Escape") setSelection(null)
    else if (key === "Enter" && mod && chosen !== null) {
      for (const id of chosen) {
        const block = rows[indexOf(id)]?.block
        if (block !== undefined) setTask(block, nextMarker(contentOf(block.text).marker))
      }
    } else if (key === "Enter" && event.shiftKey && selection !== null) {
      onNavigate({ _tag: "SidebarBlock", blockId: selection.head })
    } else if (key === "Enter" && head !== -1) {
      const block = rows[head]?.block
      if (block !== undefined) edit(block, block.text.length)
    } else if (key === "Tab" && chosen !== null) {
      dispatch({ _tag: event.shiftKey ? "Outdent" : "Indent", blockIds: chosen })
    } else if ((key === "Backspace" || key === "Delete") && chosen !== null) {
      dispatch({ _tag: "DeleteBlocks", blockIds: chosen })
      setSelection(null)
    } else if (mod && key === "a" && event.shiftKey) {
      const first = rows[0]
      const last = rows.at(-1)
      if (first !== undefined && last !== undefined) select(last.block.id, first.block.id)
    } else if (mod && key === "a" && selection !== null) {
      const up = view.parentOf(selection.head)
      if (up !== null && indexOf(up) !== -1) select(up)
    } else if (mod && key === "c" && chosen !== null) void copy(chosen)
    else if (mod && key === "x" && chosen !== null) {
      void copy(chosen)
      dispatch({ _tag: "DeleteBlocks", blockIds: chosen })
      setSelection(null)
    } else return
    event.preventDefault()
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const last = topLevel(view, selected).at(-1)
    if (event.target !== event.currentTarget || last === undefined) return
    const text = event.clipboardData.getData("text/plain")
    const blocks = nonEmpty(
      pastedBlocks(text) ?? (text.trim() === "" ? [] : [{ text, props: {}, children: [] }]),
    )
    if (blocks === null) return
    event.preventDefault()
    dispatch({ _tag: "InsertBlocks", pageId, parentId: view.parentOf(last), after: last, blocks })
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    if (next instanceof Element && next.closest("[data-keeps-selection]") !== null) return
    if (event.target === event.currentTarget) setSelection(null)
  }

  const actionsFor = (row: Row): RowActions => {
    const block = row.block
    return {
      toggle: () => dispatch({ _tag: "SetCollapsed", blockId: block.id, collapsed: row.expanded }),
      bullet: (event) =>
        onNavigate(
          event.shiftKey
            ? { _tag: "SidebarBlock", blockId: block.id }
            : { _tag: "Zoom", pageId, blockId: block.id },
        ),
      content: (event) => {
        if (event.shiftKey) {
          event.preventDefault()
          window.getSelection()?.removeAllRanges()
          select(block.id, selection?.anchor ?? editing?.blockId ?? block.id)
          return
        }
        if (editing?.blockId === block.id || hasTextSelection() || swept.current) return
        edit(block, caretFromPoint(event.clientX, event.clientY) ?? block.text.length)
      },
      dragStart: (event) => {
        const ids = selectedSet.has(block.id) ? selected : [block.id]
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", ids.join("\n"))
        setEditing(null)
        setDragged(ids)
      },
      dragEnd: () => {
        setDragged([])
        setDrop(null)
      },
      dragOver: (event) => {
        const target = dropZone(event, row)
        if (moveCommand(view, dragged, target) === null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        if (drop?.blockId !== target.blockId || drop.zone !== target.zone) setDrop(target)
      },
      drop: (event) => {
        event.preventDefault()
        const command = moveCommand(view, dragged, dropZone(event, row))
        if (command !== null) dispatch(command)
        setDragged([])
        setDrop(null)
      },
      press: (event) => {
        if (event.button !== 0 || event.shiftKey) return
        pressed.current = block.id
        swept.current = false
        window.addEventListener(
          "pointerup",
          () => {
            pressed.current = null
          },
          { once: true },
        )
      },
      sweep: (event) => {
        const origin = pressed.current
        if (origin === null || (event.buttons & 1) === 0) return
        if (origin === block.id && selection?.anchor !== origin) return
        swept.current = true
        window.getSelection()?.removeAllRanges()
        select(block.id, origin)
      },
      guide: setHoveredGuide,
      menu: (event) => {
        const open = onBlockMenu ?? parent.openMenu
        if (open === undefined) return
        event.preventDefault()
        const chosen = selectedSet.has(block.id) ? nonEmpty(topLevel(view, selected)) : null
        if (chosen === null) select(block.id)
        open({ pageId, blockIds: chosen ?? [block.id], x: event.clientX, y: event.clientY })
      },
      fold: (ancestor) => {
        setHoveredGuide(null)
        dispatch({ _tag: "SetCollapsed", blockId: ancestor, collapsed: true })
      },
    }
  }

  const renderer: Renderer = {
    navigate: onNavigate,
    depth: parent.depth + (embedded ? 1 : 0),
    localBlock: (blockId) => tree.blocks.find((block) => block.id === blockId),
    Embed: EmbedView,
    editor: Editor,
    resolveAsset: resolveAsset ?? parent.resolveAsset,
    openMenu: onBlockMenu ?? parent.openMenu,
  }

  const renderRow = (row: Row, index: number) => {
    const block = row.block
    const isEditing = editing?.blockId === block.id
    const parsed = contentOf(block.text)
    const content =
      parsed.heading === null && parsed.title !== null && block.props["heading"] === "true"
        ? { ...parsed, heading: Math.min(row.depth + 1, 6) }
        : parsed
    return (
      <RowView
        key={block.id}
        row={row}
        content={content}
        ordinal={ordinals[index] ?? null}
        firstChild={index > 0 && rows[index - 1]?.block.id === block.parentId}
        nextPath={rows[index + 1]?.path ?? []}
        selected={selectedSet.has(block.id)}
        highlight={highlighted.get(index)}
        dropZone={drop?.blockId === block.id ? drop.zone : null}
        hoveredGuide={hoveredGuide}
        canToggle={row.hasChildren && !(block.id === zoom && !embedded)}
        references={counts[block.id] ?? counts[(block.props["id"] ?? "").toLowerCase()] ?? 0}
        measure={measure}
        actions={actionsFor(row)}
      >
        {isEditing ? (
          <Editor
            block={block}
            caret={Math.min(editing.caret, block.text.length)}
            dispatch={dispatch}
            onIntent={onIntent(block.id)}
          />
        ) : (
          <BlockView
            content={content}
            props={block.props}
            onMarker={(marker) => setTask(block, marker)}
          />
        )}
      </RowView>
    )
  }

  const gapKey = (part: { readonly from: number; readonly to: number }) =>
    part.from === 0 ? "gap-start" : part.to === rows.length ? "gap-end" : `gap-${part.from}`
  const body = parts.flatMap((part) =>
    part._tag === "Gap"
      ? [
          <div
            key={gapKey(part)}
            ref={watchEdge}
            className="seqno-gap"
            aria-hidden
            style={{ height: part.height }}
          />,
        ]
      : rows.slice(part.from, part.to).map((row, offset) => renderRow(row, part.from + offset)),
  )

  return (
    <RenderContext value={renderer}>
      <div className="seqno-outliner" data-embedded={embedded ? true : undefined}>
        <style href="@seqno/outliner" precedence="default">
          {styles}
        </style>
        {zoom !== null && !embedded && view.trail.length > 0 ? (
          <Breadcrumbs
            title={tree.page.title}
            trail={view.trail.slice(0, -1)}
            onNavigate={onNavigate}
            pageId={pageId}
          />
        ) : null}
        <div
          ref={container}
          className="seqno-outline"
          role="tree"
          aria-label="Outline"
          aria-multiselectable
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={onBlur}
        >
          {body}
          {rows.length === 0 && !embedded ? (
            <button
              type="button"
              className="seqno-add-first"
              aria-label="Click here to start writing"
              onClick={() =>
                after({ _tag: "InsertBlock", pageId, parentId: null, text: "" }, (events) => {
                  const created = events.find((event) => event._tag === "BlockUpserted")
                  if (created?._tag === "BlockUpserted") {
                    setEditing({ blockId: created.block.id, caret: 0 })
                  }
                })
              }
            >
              <span className="seqno-control">
                <span className="seqno-toggle-space" />
                <span className="seqno-bullet">
                  <span className="seqno-dot" />
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </RenderContext>
  )
}

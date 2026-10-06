import {
  useContext,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type KeyboardEvent,
} from "react"
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Block, BlockId, Command, GraphEvent, PageId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { dispatchAtom, pageTreeAtom } from "./core.ts"
import { moveCommand, type DropTarget } from "./drop.ts"
import { PlainTextEditor } from "./PlainTextEditor.tsx"
import { EditorIntent, type EditorSlotProps } from "./slot.ts"
import { StaticBlock, type Navigate } from "./StaticBlock.tsx"
import { outline, topLevel, type Outline, type Row } from "./tree.ts"
import styles from "./outliner.css?inline"

export interface OutlinerProps {
  readonly pageId: PageId
  readonly zoom: BlockId | null
  readonly onNavigate: Navigate
  readonly editor?: ComponentType<EditorSlotProps>
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
        This page could not be loaded
      </div>
    ),
    onSuccess: ({ value }) => <OutlineView tree={value} {...props} />,
  })

const indent = 24
const estimatedRowHeight = 30
const overscan = 600

interface Editing {
  readonly blockId: BlockId
  readonly caret: number
}

interface Selection {
  readonly anchor: BlockId
  readonly head: BlockId
}

interface Window {
  readonly top: number
  readonly height: number
}

const createdBlock = (events: ReadonlyArray<GraphEvent>, except: BlockId) =>
  events.flatMap((event) =>
    event._tag === "BlockUpserted" && event.block.id !== except ? [event.block.id] : [],
  )[0]

const selectedIds = (view: Outline, selection: Selection | null): ReadonlyArray<BlockId> => {
  if (selection === null) return []
  const ids = view.rows.map((row) => row.block.id)
  const anchor = ids.indexOf(selection.anchor)
  const head = ids.indexOf(selection.head)
  if (anchor === -1 || head === -1) return []
  return ids.slice(Math.min(anchor, head), Math.max(anchor, head) + 1)
}

const nonEmpty = <A,>(items: ReadonlyArray<A>): readonly [A, ...Array<A>] | null => {
  const [first, ...rest] = items
  return first === undefined ? null : [first, ...rest]
}

const OutlineView = ({
  tree,
  pageId,
  zoom,
  onNavigate,
  editor: Editor = PlainTextEditor,
}: OutlinerProps & { readonly tree: PageTree }) => {
  const view = outline(tree, zoom)
  const registry = useContext(RegistryContext)
  const run = useAtomSet(dispatchAtom, { mode: "promiseExit" })
  const container = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [dragged, setDragged] = useState<ReadonlyArray<BlockId>>([])
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [scroll, setScroll] = useState<Window>({ top: 0, height: window.innerHeight })
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

  const measure = (element: HTMLDivElement | null) => {
    if (element === null) return
    rowObserver.observe(element)
    return () => rowObserver.unobserve(element)
  }

  const dispatch = (command: Command) => {
    void run(command)
  }
  const after = (command: Command, then: (events: ReadonlyArray<GraphEvent>) => void) => {
    void run(command).then(Exit.match({ onFailure: () => undefined, onSuccess: then }))
  }

  const rows = view.rows
  const indexOf = (blockId: BlockId) => rows.findIndex((row) => row.block.id === blockId)
  const selected = selectedIds(view, selection)
  const selectedSet = new Set(selected)

  const tops: Array<number> = []
  let total = 0
  for (const row of rows) {
    tops.push(total)
    total += heights.get(row.block.id) ?? estimatedRowHeight
  }
  const heightAt = (index: number) => heights.get(rows[index]?.block.id ?? "") ?? estimatedRowHeight
  const editingIndex = editing === null ? -1 : indexOf(editing.blockId)
  const visible = rows.flatMap((row, index) => {
    const top = tops[index] ?? 0
    const inWindow =
      top + heightAt(index) >= scroll.top - overscan && top <= scroll.top + scroll.height + overscan
    return inWindow || index === editingIndex ? [{ row, index, top }] : []
  })

  const reveal = (blockId: BlockId) => {
    const index = indexOf(blockId)
    const box = container.current
    const top = tops[index]
    if (box === null || top === undefined) return
    const bottom = top + heightAt(index)
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }

  const edit = (block: Block, caret: number) => {
    reveal(block.id)
    setSelection(null)
    setEditing({ blockId: block.id, caret })
  }

  const select = (blockId: BlockId, extend: boolean) => {
    reveal(blockId)
    setEditing(null)
    setSelection((current) => ({
      anchor: extend && current !== null ? current.anchor : blockId,
      head: blockId,
    }))
    container.current?.focus()
  }

  const latest = (): Outline =>
    Option.match(AsyncResult.value(registry.get(pageTreeAtom(pageId))), {
      onNone: () => view,
      onSome: (current) => outline(current, zoom),
    })

  const onIntent = (blockId: BlockId) => (intent: EditorIntent) => {
    const now = latest()
    const index = now.rows.findIndex((row) => row.block.id === blockId)
    const block = now.rows[index]?.block
    if (block === undefined) return
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
      Exit: () => select(block.id, false),
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const mod = event.metaKey || event.ctrlKey
    const head = selection === null ? -1 : indexOf(selection.head)
    const chosen = nonEmpty(topLevel(view, selected))
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))]
      if (target !== undefined) select(target.block.id, event.shiftKey)
    }
    if (event.key === "ArrowDown" && !mod) move(head === -1 ? 0 : head + 1)
    else if (event.key === "ArrowUp" && !mod) move(head === -1 ? rows.length - 1 : head - 1)
    else if (event.key === "Escape") setSelection(null)
    else if (event.key === "Enter" && head !== -1) {
      const block = rows[head]?.block
      if (block !== undefined) edit(block, block.text.length)
    } else if (event.key === "Tab" && chosen !== null) {
      dispatch({ _tag: event.shiftKey ? "Outdent" : "Indent", blockIds: chosen })
    } else if ((event.key === "Backspace" || event.key === "Delete") && chosen !== null) {
      dispatch({ _tag: "DeleteBlocks", blockIds: chosen })
      setSelection(null)
    } else if (mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      for (const id of selected) {
        if (rows[indexOf(id)]?.hasChildren === true) {
          dispatch({ _tag: "SetCollapsed", blockId: id, collapsed: event.key === "ArrowUp" })
        }
      }
    } else return
    event.preventDefault()
  }

  const dropZone = (event: DragEvent<HTMLDivElement>, row: Row): DropTarget => {
    const box = event.currentTarget.getBoundingClientRect()
    const lower = event.clientY - box.top >= box.height / 2
    const nested = event.clientX - box.left >= (row.depth + 2) * indent
    return { blockId: row.block.id, zone: !lower ? "before" : nested ? "child" : "after" }
  }

  const onDragOver = (row: Row) => (event: DragEvent<HTMLDivElement>) => {
    const target = dropZone(event, row)
    if (moveCommand(view, dragged, target) === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    if (drop?.blockId !== target.blockId || drop.zone !== target.zone) setDrop(target)
  }

  const onDrop = (row: Row) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const command = moveCommand(view, dragged, dropZone(event, row))
    if (command !== null) dispatch(command)
    setDragged([])
    setDrop(null)
  }

  const dropIndex = drop === null ? -1 : indexOf(drop.blockId)
  const dropRow = rows[dropIndex]
  const indicator =
    drop === null || dropRow === undefined
      ? null
      : {
          top: (tops[dropIndex] ?? 0) + (drop.zone === "before" ? 0 : heightAt(dropIndex)),
          left: (dropRow.depth + (drop.zone === "child" || dropRow.expanded ? 1 : 0)) * indent,
        }

  return (
    <div className="seqno-outliner">
      <style href="@seqno/outliner" precedence="default">
        {styles}
      </style>
      {view.trail.length > 0 ? (
        <nav className="seqno-breadcrumbs" aria-label="Breadcrumbs">
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault()
              onNavigate({ _tag: "Zoom", pageId, blockId: null })
            }}
          >
            {tree.page.title}
          </a>
          {view.trail.map((block, index) => (
            <a
              key={block.id}
              href="#"
              aria-current={index === view.trail.length - 1 ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault()
                onNavigate({ _tag: "Zoom", pageId, blockId: block.id })
              }}
            >
              {(block.text.split("\n")[0] ?? "").replaceAll("[[", "").replaceAll("]]", "")}
            </a>
          ))}
        </nav>
      ) : null}
      {rows.length === 0 ? (
        <button
          type="button"
          className="seqno-add-first"
          onClick={() =>
            after({ _tag: "InsertBlock", pageId, parentId: null, text: "" }, (events) => {
              const created = events.find((event) => event._tag === "BlockUpserted")
              if (created?._tag === "BlockUpserted")
                setEditing({ blockId: created.block.id, caret: 0 })
            })
          }
        >
          Click here to start writing
        </button>
      ) : null}
      <div
        ref={(element) => {
          container.current = element
          if (element === null) return
          const viewport = new ResizeObserver(([entry]) =>
            setScroll((current) => ({
              ...current,
              height: entry?.contentRect.height ?? current.height,
            })),
          )
          viewport.observe(element)
          return () => viewport.disconnect()
        }}
        className="seqno-outline"
        role="tree"
        aria-label="Outline"
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop
          setScroll((current) => ({ ...current, top }))
        }}
      >
        <div className="seqno-outline-canvas" style={{ height: total }}>
          {visible.map(({ row, top }) => {
            const { block, depth } = row
            const isEditing = editing?.blockId === block.id
            return (
              <div
                key={block.id}
                ref={measure}
                data-block-id={block.id}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selectedSet.has(block.id)}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                className="seqno-row"
                style={{ top, paddingLeft: depth * indent }}
                onDragOver={onDragOver(row)}
                onDrop={onDrop(row)}
              >
                {Array.from({ length: depth }, (_, level) => (
                  <span key={level} className="seqno-guide" style={{ left: level * indent }} />
                ))}
                {row.hasChildren && block.id !== zoom ? (
                  <button
                    type="button"
                    className="seqno-toggle"
                    aria-label={row.expanded ? "Collapse" : "Expand"}
                    onClick={() =>
                      dispatch({ _tag: "SetCollapsed", blockId: block.id, collapsed: row.expanded })
                    }
                  />
                ) : null}
                <button
                  type="button"
                  className={
                    row.hasChildren && !row.expanded ? "seqno-bullet seqno-folded" : "seqno-bullet"
                  }
                  aria-label="Zoom into block"
                  draggable
                  onClick={() => onNavigate({ _tag: "Zoom", pageId, blockId: block.id })}
                  onDragStart={(event) => {
                    const ids = selectedSet.has(block.id) ? selected : [block.id]
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", ids.join("\n"))
                    setEditing(null)
                    setDragged(ids)
                  }}
                  onDragEnd={() => {
                    setDragged([])
                    setDrop(null)
                  }}
                />
                <div
                  className="seqno-content"
                  onClick={(event) => {
                    if (event.shiftKey) select(block.id, true)
                    else if (!isEditing) edit(block, block.text.length)
                  }}
                >
                  {isEditing ? (
                    <Editor
                      block={block}
                      caret={Math.min(editing.caret, block.text.length)}
                      dispatch={dispatch}
                      onIntent={onIntent(block.id)}
                    />
                  ) : (
                    <StaticBlock text={block.text} navigate={onNavigate} />
                  )}
                </div>
              </div>
            )
          })}
          {indicator === null ? null : <div className="seqno-drop-indicator" style={indicator} />}
        </div>
      </div>
    </div>
  )
}

import { useState } from "react"
import type { DragEvent, MouseEvent, PointerEvent, ReactNode, Ref } from "react"
import { IconCaretRightFilled } from "@tabler/icons-react"
import { logseq } from "@seqno/dom"
import type { BlockId } from "@seqno/domain"
import type { BlockContent } from "@seqno/syntax"
import type { DropZone } from "./drop.ts"
import type { Highlight } from "./selection.ts"
import type { Row } from "./tree.ts"

export interface RowActions {
  readonly toggle: () => void
  readonly bullet: (event: MouseEvent) => void
  readonly content: (event: MouseEvent) => void
  readonly press: (event: PointerEvent) => void
  readonly sweep: (event: PointerEvent) => void
  readonly dragStart: (event: DragEvent) => void
  readonly dragEnd: () => void
  readonly dragOver: (event: DragEvent<HTMLDivElement>) => void
  readonly drop: (event: DragEvent<HTMLDivElement>) => void
  readonly guide: (ancestor: BlockId | null) => void
  readonly fold: (ancestor: BlockId) => void
  readonly references: () => void
  readonly menu: (event: MouseEvent) => void
}

export interface RowProps {
  readonly row: Row
  readonly content: BlockContent
  readonly ordinal: number | null
  readonly firstChild: boolean
  readonly nextPath: readonly BlockId[]
  readonly selected: boolean
  readonly dragged: boolean
  readonly highlight: Highlight | undefined
  readonly dropZone: DropZone | null
  readonly hoveredGuide: BlockId | null
  readonly documentMode: boolean
  readonly canToggle: boolean
  readonly references: number
  readonly referencesOpen: boolean
  readonly childRefs: string
  readonly below: ReactNode
  readonly index: number
  readonly measure: Ref<HTMLDivElement>
  readonly actions: RowActions
  readonly children: ReactNode
}

const indent = (levels: number, plus = "0px") => `calc(${levels} * var(--block-indent) + ${plus})`

const firstLineOffset: ReadonlyMap<number, string> = new Map([
  [1, "16px"],
  [2, "9px"],
  [3, "2.4px"],
])

const selectionEdge = (highlight: Highlight) =>
  highlight.first && highlight.last
    ? "single"
    : highlight.first
      ? "first"
      : highlight.last
        ? "last"
        : "middle"

export const RowView = ({
  row,
  content,
  ordinal,
  firstChild,
  nextPath,
  selected,
  dragged,
  highlight,
  dropZone,
  hoveredGuide,
  documentMode,
  canToggle,
  references,
  referencesOpen,
  childRefs,
  below,
  index,
  measure,
  actions,
  children,
}: RowProps) => {
  const { block, depth } = row
  const folded = row.hasChildren && !row.expanded
  const numbered = ordinal !== null
  const [hovered, setHovered] = useState(false)
  const hidden = documentMode && !folded && !hovered

  const offset =
    content.title === null || content.heading === null
      ? undefined
      : firstLineOffset.get(content.heading)

  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- focus stays on the tree, which handles the keys for its rows
    <div
      ref={measure}
      {...logseq("seqno-row", {
        block,
        level: depth + 1,
        hasChildren: row.hasChildren,
        childRefs,
        folded,
        selected,
        dragged,
      })}
      data-index={index}
      data-block-id={block.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      style={{ paddingLeft: indent(depth) }}
      onPointerEnter={(event) => {
        if (documentMode) {
          setHovered(true)
        }

        actions.sweep(event)
      }}
      onPointerLeave={() => {
        if (documentMode) {
          setHovered(false)
        }
      }}
      onDragOver={actions.dragOver}
      onDrop={actions.drop}
    >
      {highlight === undefined ? null : (
        <span
          className="seqno-selection"
          data-edge={selectionEdge(highlight)}
          style={{ left: indent(highlight.level) }}
        />
      )}
      {dropZone === null ? null : (
        <span
          className="seqno-drop"
          data-zone={dropZone}
          style={{
            left: indent(
              depth + (dropZone === "child" || (dropZone === "after" && row.expanded) ? 1 : 0),
              "var(--block-control-size)",
            ),
          }}
        />
      )}
      {row.path.map((ancestor, level) => (
        <span
          key={ancestor}
          {...logseq("seqno-guide")}
          aria-hidden
          data-first={level === depth - 1 && firstChild ? true : undefined}
          data-last={nextPath[level] === ancestor ? undefined : true}
          data-hovered={hoveredGuide === ancestor ? true : undefined}
          style={{
            left: indent(level, "var(--block-control-size) + var(--bullet-box) / 2 - 2px"),
          }}
          onPointerEnter={() => {
            actions.guide(ancestor)
          }}
          onPointerLeave={() => {
            actions.guide(null)
          }}
          onClick={(event) => {
            event.stopPropagation()
            actions.fold(ancestor)
          }}
        />
      ))}
      <div {...logseq("seqno-row-main")}>
        <div
          {...logseq("seqno-control", { folded, numbered })}
          style={offset === undefined ? undefined : { marginTop: offset }}
        >
          {canToggle ? (
            <button
              type="button"
              {...logseq("seqno-toggle", block.id)}
              aria-label={row.expanded ? "Collapse" : "Expand"}
              data-expanded={row.expanded}
              onClick={actions.toggle}
            >
              <span {...logseq("seqno-arrow", !row.expanded)}>
                <IconCaretRightFilled size={16} aria-hidden />
              </span>
            </button>
          ) : (
            <span className="seqno-toggle-space" />
          )}
          <span {...logseq("seqno-bullet-wrap")}>
            <button
              type="button"
              {...logseq("seqno-bullet", { blockId: block.id, folded, numbered, hidden })}
              aria-label="Zoom into block"
              data-numbered={numbered || undefined}
              data-folded={folded || undefined}
              data-hidden={hidden || undefined}
              draggable
              onClick={actions.bullet}
              onContextMenu={actions.menu}
              onDragStart={actions.dragStart}
              onDragEnd={actions.dragEnd}
            >
              {ordinal === null ? (
                <span {...logseq("seqno-dot", { blockId: block.id, selected })} />
              ) : (
                `${ordinal}.`
              )}
            </button>
          </span>
        </div>
        <div
          {...logseq("seqno-content")}
          role="presentation"
          onClick={actions.content}
          onPointerDown={actions.press}
          onContextMenu={(event) => {
            if (selected) {
              actions.menu(event)
            }
          }}
        >
          {children}
        </div>
        {references === 0 ? null : (
          <button
            type="button"
            {...logseq("seqno-refs-count")}
            title="Open block references"
            aria-label={references === 1 ? "1 reference" : `${references} references`}
            aria-expanded={referencesOpen}
            onClick={actions.references}
          >
            {references}
          </button>
        )}
      </div>
      {below}
    </div>
  )
}

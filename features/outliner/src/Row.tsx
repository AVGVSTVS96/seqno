import type { DragEvent, MouseEvent, ReactNode, Ref } from "react"
import { IconCaretRightFilled } from "@tabler/icons-react"
import type { BlockId } from "@seqno/domain"
import type { BlockContent } from "@seqno/syntax"
import type { DropZone } from "./drop.ts"
import type { Highlight } from "./selection.ts"
import type { Row } from "./tree.ts"

export interface RowActions {
  readonly toggle: () => void
  readonly bullet: (event: MouseEvent) => void
  readonly content: (event: MouseEvent) => void
  readonly dragStart: (event: DragEvent) => void
  readonly dragEnd: () => void
  readonly dragOver: (event: DragEvent<HTMLDivElement>) => void
  readonly drop: (event: DragEvent<HTMLDivElement>) => void
  readonly guide: (ancestor: BlockId | null) => void
  readonly fold: (ancestor: BlockId) => void
}

export interface RowProps {
  readonly row: Row
  readonly content: BlockContent
  readonly ordinal: number | null
  readonly firstChild: boolean
  readonly selected: boolean
  readonly highlight: Highlight | undefined
  readonly dropZone: DropZone | null
  readonly hoveredGuide: BlockId | null
  readonly canToggle: boolean
  readonly measure: Ref<HTMLDivElement>
  readonly actions: RowActions
  readonly children: ReactNode
}

const indent = (levels: number, plus = "0px") => `calc(${levels} * var(--block-indent) + ${plus})`

const firstLineOffset: Readonly<Record<number, string>> = { 1: "16px", 2: "9px", 3: "2.4px" }

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
  selected,
  highlight,
  dropZone,
  hoveredGuide,
  canToggle,
  measure,
  actions,
  children,
}: RowProps) => {
  const { block, depth } = row
  const offset =
    content.title === null || content.heading === null
      ? undefined
      : firstLineOffset[content.heading]
  return (
    <div
      ref={measure}
      data-block-id={block.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      className="seqno-row"
      style={{ paddingLeft: indent(depth) }}
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
          className="seqno-guide"
          aria-hidden
          data-first={level === depth - 1 && firstChild ? true : undefined}
          data-hovered={hoveredGuide === ancestor ? true : undefined}
          style={{
            left: indent(level, "var(--block-control-size) + var(--bullet-box) / 2 - 2px"),
          }}
          onPointerEnter={() => actions.guide(ancestor)}
          onPointerLeave={() => actions.guide(null)}
          onClick={(event) => {
            event.stopPropagation()
            actions.fold(ancestor)
          }}
        />
      ))}
      <div
        className="seqno-control"
        style={offset === undefined ? undefined : { marginTop: offset }}
      >
        {canToggle ? (
          <button
            type="button"
            className="seqno-toggle"
            aria-label={row.expanded ? "Collapse" : "Expand"}
            data-expanded={row.expanded}
            onClick={actions.toggle}
          >
            <IconCaretRightFilled size={16} aria-hidden />
          </button>
        ) : (
          <span className="seqno-toggle-space" />
        )}
        <button
          type="button"
          className={ordinal === null ? "seqno-bullet" : "seqno-bullet is-numbered"}
          aria-label="Zoom into block"
          data-folded={row.hasChildren && !row.expanded ? true : undefined}
          draggable
          onClick={actions.bullet}
          onDragStart={actions.dragStart}
          onDragEnd={actions.dragEnd}
        >
          {ordinal === null ? <span className="seqno-dot" /> : `${ordinal}.`}
        </button>
      </div>
      <div className="seqno-content" onClick={actions.content}>
        {children}
      </div>
    </div>
  )
}

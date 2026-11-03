import { logseq } from "@seqno/dom"
import { createPortal } from "react-dom"
import type { DragEvent, MouseEvent, PointerEvent } from "react"
import type { Highlight } from "./highlights.ts"
import { scaledToViewport, type Box } from "./model.ts"
import type { Session, Snapshot } from "./session.ts"

const px = (box: Box) => ({ left: box.left, top: box.top, width: box.width, height: box.height })

const TextRegion = ({ session, highlight }: { session: Session; highlight: Highlight }) => {
  const viewport = session.viewportOf(highlight.page)
  if (viewport === undefined) return null
  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    session.openMenu(highlight, { x: event.clientX, y: event.clientY }, false, null)
  }
  const drag = (event: DragEvent) => {
    void session.ensureBlock(highlight)
    event.dataTransfer.setData("text/plain", `((${highlight.id}))`)
  }
  return (
    <div
      {...logseq("seqno-pdf-text-region", highlight.id)}
      data-highlight-id={highlight.id}
      onClick={open}
      onContextMenu={open}
    >
      {highlight.position.rects.map((rect, index) => (
        <div
          key={index}
          {...logseq("seqno-pdf-text-region-item", highlight.properties.color)}
          style={px(scaledToViewport(rect, viewport))}
          draggable
          onDragStart={drag}
          data-highlight-color={highlight.properties.color}
        />
      ))}
    </div>
  )
}

type Edge = "left" | "right" | "top" | "bottom"

const edges: ReadonlyArray<Edge> = ["left", "right", "top", "bottom"]

const resized = (start: Box, edge: Edge, dx: number, dy: number, page: Box): Box => {
  const right = start.left + start.width
  const bottom = start.top + start.height
  const clampX = (x: number) => Math.min(Math.max(x, 0), page.width)
  const clampY = (y: number) => Math.min(Math.max(y, 0), page.height)
  switch (edge) {
    case "left": {
      const left = Math.min(clampX(start.left + dx), right - 1)
      return { ...start, left, width: right - left }
    }
    case "right":
      return { ...start, width: Math.max(1, clampX(right + dx) - start.left) }
    case "top": {
      const top = Math.min(clampY(start.top + dy), bottom - 1)
      return { ...start, top, height: bottom - top }
    }
    case "bottom":
      return { ...start, height: Math.max(1, clampY(bottom + dy) - start.top) }
  }
}

const AreaRegion = ({
  session,
  highlight,
  draft,
}: {
  session: Session
  highlight: Highlight
  draft: Box | null
}) => {
  const viewport = session.viewportOf(highlight.page)
  if (viewport === undefined) return null
  const box = draft ?? scaledToViewport(highlight.position.bounding, viewport)
  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (draft !== null) return
    session.openMenu(highlight, { x: event.clientX, y: event.clientY }, false, null)
  }
  const startResize = (edge: Edge) => (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const origin = { x: event.clientX, y: event.clientY }
    session.resize(highlight, box)
    const page = { left: 0, top: 0, width: viewport.width, height: viewport.height }
    let latest = box
    const move = (moved: globalThis.PointerEvent) => {
      latest = resized(box, edge, moved.clientX - origin.x, moved.clientY - origin.y, page)
      session.resize(highlight, latest)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      if (latest === box) session.resize(highlight, null)
      else session.finishResize(highlight, latest)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up, { once: true })
    handle.addEventListener("pointercancel", up, { once: true })
  }
  return (
    <div
      {...logseq("seqno-pdf-area-region", highlight.id, highlight.properties.color)}
      data-highlight-id={highlight.id}
      data-highlight-color={highlight.properties.color}
      style={px(box)}
      draggable
      onDragStart={(event) => {
        if (session.snapshot().resizing !== null) {
          event.preventDefault()
          return
        }
        void session.ensureBlock(highlight)
        event.dataTransfer.setData("text/plain", `((${highlight.id}))`)
      }}
      onClick={open}
      onContextMenu={open}
    >
      {edges.map((edge) => (
        <span
          key={edge}
          className="seqno-pdf-resize-edge"
          data-edge={edge}
          onPointerDown={startResize(edge)}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
    </div>
  )
}

export const Regions = ({ session, snapshot }: { session: Session; snapshot: Snapshot }) => {
  const byPage = Map.groupBy(snapshot.highlights, (highlight) => highlight.page)
  return [...snapshot.layers].map(([page, layer]) =>
    createPortal(
      <div {...logseq("seqno-pdf-regions")} data-scale={snapshot.scale}>
        {(byPage.get(page) ?? []).map((highlight) =>
          highlight.content.image === undefined ? (
            <TextRegion key={highlight.id} session={session} highlight={highlight} />
          ) : (
            <AreaRegion
              key={highlight.id}
              session={session}
              highlight={highlight}
              draft={snapshot.resizing?.id === highlight.id ? snapshot.resizing.box : null}
            />
          ),
        )}
      </div>,
      layer,
      `page-${page}`,
    ),
  )
}

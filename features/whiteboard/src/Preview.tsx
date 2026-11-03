import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import type { BlockId, PageId } from "@seqno/domain"
import { pageTreeAtom } from "@seqno/outliner"
import type { PageTree } from "@seqno/rpc"
import { fitBounds, union, type Viewport } from "./geometry.ts"
import { selectionBounds } from "./gestures.ts"
import { itemsOf, sceneOf, withMembers } from "./model.ts"
import { ShapeView, type ShapeSlots } from "./ShapeView.tsx"

const noMeasure = () => () => undefined

const stillSlots = (resolveAsset: (path: string) => string | undefined): ShapeSlots => ({
  asset: resolveAsset,
  measure: noMeasure,
  editing: null,
  portals: null,
  active: null,
  selected: [],
  reloads: new Map(),
})

const Drawing = ({
  tree,
  resolveAsset,
}: {
  readonly tree: PageTree
  readonly resolveAsset: (path: string) => string | undefined
}) => {
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })
  const scene = sceneOf(itemsOf(tree.blocks), new Map())
  const drawing = union([...scene.bounds.values()])
  const camera =
    drawing === null || viewport.width === 0 ? null : fitBounds(drawing, viewport, 1, 16)
  const slots = stillSlots(resolveAsset)
  const attach = (node: HTMLDivElement | null) => {
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }
  return (
    <div ref={attach} className="wb-root" aria-hidden>
      {camera === null ? null : (
        <div
          className="wb-world"
          style={{
            transform: `scale(${camera.zoom}) translate(${camera.x}px, ${camera.y}px)`,
          }}
        >
          {scene.items.map((item) => (
            <ShapeView
              key={item.block.id}
              item={item}
              scene={scene}
              slots={slots}
              erasing={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const BoardPreview = ({
  pageId,
  resolveAsset,
}: {
  readonly pageId: PageId
  readonly resolveAsset: (path: string) => string | undefined
}) => {
  const tree = useAtomValue(pageTreeAtom(pageId))
  return AsyncResult.isSuccess(tree) ? (
    <Drawing tree={tree.value} resolveAsset={resolveAsset} />
  ) : null
}

export const EXPORT_PADDING = 8

const Shot = ({
  tree,
  ids,
  resolveAsset,
}: {
  readonly tree: PageTree
  readonly ids: ReadonlyArray<BlockId>
  readonly resolveAsset: (path: string) => string | undefined
}) => {
  const scene = sceneOf(itemsOf(tree.blocks), new Map())
  const chosen = new Set(withMembers(scene, ids))
  const box = selectionBounds(scene, ids)
  if (box === null) return null
  const slots = stillSlots(resolveAsset)
  return (
    <div
      className="wb-root wb-shot"
      style={{
        width: box.maxX - box.minX + EXPORT_PADDING * 2,
        height: box.maxY - box.minY + EXPORT_PADDING * 2,
      }}
    >
      <div
        className="wb-world"
        style={{
          transform: `translate(${EXPORT_PADDING - box.minX}px, ${EXPORT_PADDING - box.minY}px)`,
        }}
      >
        {scene.items
          .filter((item) => chosen.has(item.block.id))
          .map((item) => (
            <ShapeView
              key={item.block.id}
              item={item}
              scene={scene}
              slots={slots}
              erasing={false}
            />
          ))}
      </div>
    </div>
  )
}

export const BoardShot = ({
  pageId,
  ids,
  resolveAsset,
}: {
  readonly pageId: PageId
  readonly ids: ReadonlyArray<BlockId>
  readonly resolveAsset: (path: string) => string | undefined
}) => {
  const tree = useAtomValue(pageTreeAtom(pageId))
  return AsyncResult.isSuccess(tree) ? (
    <Shot tree={tree.value} ids={ids} resolveAsset={resolveAsset} />
  ) : null
}

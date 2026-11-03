import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import type { PageId } from "@seqno/domain"
import { pageTreeAtom } from "@seqno/outliner"
import type { PageTree } from "@seqno/rpc"
import { fitBounds, union, type Viewport } from "./geometry.ts"
import { itemsOf, sceneOf } from "./model.ts"
import { ShapeView, type ShapeSlots } from "./ShapeView.tsx"

const noMeasure = () => () => undefined

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
    drawing === null || viewport.width === 0 ? null : fitBounds(drawing, viewport, 1, 8)
  const slots: ShapeSlots = {
    asset: resolveAsset,
    measure: noMeasure,
    editing: null,
    portals: null,
    active: null,
  }
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

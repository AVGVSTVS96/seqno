import { Schema } from "effect"
import { KeyValueStore } from "effect/persistence"
import { Atom } from "effect/reactivity"
import type { RefObject } from "react"
import type { PageId } from "@seqno/domain"
import type { Camera, Viewport } from "./geometry.ts"

export const CAMERA_MS = 100

const sessionRuntime = Atom.runtime(KeyValueStore.layerStorage(() => sessionStorage))

const SavedCamera = Schema.NullOr(
  Schema.Struct({ x: Schema.Finite, y: Schema.Finite, zoom: Schema.Finite }),
)

export const savedCamera = Atom.family((pageId: PageId) =>
  Atom.kvs({
    runtime: sessionRuntime,
    key: `seqno.whiteboard.camera:${pageId}`,
    schema: SavedCamera,
    defaultValue: (): Camera | null => null,
  }),
)

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

export const cameraBetween = (
  from: Camera,
  to: Camera,
  viewport: Viewport,
  progress: number,
): Camera => {
  const p = easeInOutSine(Math.min(1, Math.max(0, progress)))
  const span = (zoom: number) => viewport.width / zoom
  const width = span(from.zoom) + (span(to.zoom) - span(from.zoom)) * p
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    zoom: viewport.width / width,
  }
}

export const glide = (
  flight: RefObject<number>,
  set: (camera: Camera) => void,
  from: Camera,
  to: Camera,
  viewport: Viewport,
) => {
  cancelAnimationFrame(flight.current)
  const start = performance.now()
  const step = () => {
    const progress = (performance.now() - start) / CAMERA_MS
    set(progress >= 1 ? to : cameraBetween(from, to, viewport, progress))
    if (progress < 1) flight.current = requestAnimationFrame(step)
  }
  step()
}

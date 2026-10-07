import { use, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { BlockId } from "@seqno/domain"
import { blockAtom, pageNamedAtom } from "./core.ts"
import { maxDepth, RenderContext } from "./render.ts"

export type PreviewTarget =
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "Block"; readonly blockId: BlockId }

const openAfter = 1000
const closeAfter = 800
const gap = 4
const edge = 8
const tallest = 536

interface Anchor {
  readonly box: DOMRect
}

const place = (popup: HTMLElement, box: DOMRect) => {
  const below = window.innerHeight - box.bottom - gap - edge
  const above = box.top - gap - edge
  const down = below >= Math.min(tallest, 320) || below >= above
  const width = popup.offsetWidth
  const left = Math.min(
    Math.max(edge, box.left + box.width / 2 - width / 2),
    window.innerWidth - edge - width,
  )
  popup.style.left = `${left}px`
  popup.style.maxHeight = `${Math.min(tallest, down ? below : above)}px`
  popup.style.top = down ? `${box.bottom + gap}px` : ""
  popup.style.bottom = down ? "" : `${window.innerHeight - box.top + gap}px`
  popup.dataset["side"] = down ? "bottom" : "top"
}

const PagePreview = ({ name }: { readonly name: string }) => {
  const renderer = use(RenderContext)
  const Embed = renderer.Embed
  return AsyncResult.match(useAtomValue(pageNamedAtom(name)), {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: ({ value }) => (
      <div className="seqno-preview-page">
        <div className="seqno-preview-title">{value?.title ?? name}</div>
        {value === undefined ? null : (
          <div className="seqno-preview-blocks">
            <Embed target={{ _tag: "Page", name: value.name }} bare />
          </div>
        )}
      </div>
    ),
  })
}

const BlockPreview = ({ blockId }: { readonly blockId: BlockId }) => {
  const renderer = use(RenderContext)
  const Embed = renderer.Embed
  return AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: () => (
      <div className="seqno-preview-page">
        <div className="seqno-preview-blocks">
          <Embed target={{ _tag: "Block", blockId }} bare />
        </div>
      </div>
    ),
  })
}

export const usePreview = (target: PreviewTarget) => {
  const renderer = use(RenderContext)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const timers = useRef<{ open?: number; close?: number }>({})
  const clear = () => {
    window.clearTimeout(timers.current.open)
    window.clearTimeout(timers.current.close)
  }
  const keep = () => window.clearTimeout(timers.current.close)
  const leave = () => {
    window.clearTimeout(timers.current.open)
    timers.current.close = window.setTimeout(() => setAnchor(null), closeAfter)
  }
  const enabled = renderer.depth < maxDepth
  const trigger = {
    onPointerEnter: (event: { readonly currentTarget: HTMLElement; readonly buttons: number }) => {
      if (!enabled || event.buttons !== 0) return
      keep()
      const element = event.currentTarget
      window.clearTimeout(timers.current.open)
      timers.current.open = window.setTimeout(
        () => setAnchor({ box: element.getBoundingClientRect() }),
        openAfter,
      )
    },
    onPointerLeave: leave,
    onPointerDown: () => {
      clear()
      setAnchor(null)
    },
  }
  const popup: ReactNode =
    anchor === null
      ? null
      : createPortal(
          <div
            popover="manual"
            className="seqno-preview"
            role="dialog"
            aria-label="Preview"
            onPointerEnter={keep}
            onPointerLeave={leave}
            ref={(element) => {
              if (element === null) return
              element.showPopover()
              place(element, anchor.box)
            }}
          >
            <RenderContext value={{ ...renderer, depth: renderer.depth + 1 }}>
              {target._tag === "Page" ? (
                <PagePreview name={target.name} />
              ) : (
                <BlockPreview blockId={target.blockId} />
              )}
            </RenderContext>
          </div>,
          document.body,
        )
  return { trigger, popup }
}

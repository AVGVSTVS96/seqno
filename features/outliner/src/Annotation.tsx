import { useAtomValue } from "@effect/atom-react"
import { IconCopy, IconMaximize } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { use, useRef, useState, type MouseEvent } from "react"
import { logseq } from "@seqno/dom"
import type { Block, Props } from "@seqno/domain"
import { pageTreeAtom } from "./core.ts"
import { copyImage, ImageViewer } from "./ImageViewer.tsx"
import { AssetActions, RenderContext } from "./render.ts"

export const isAnnotation = (props: Props) => props["ls-type"] === "annotation"

export const isAreaAnnotation = (props: Props) => isAnnotation(props) && props["hl-type"] === "area"

const colorOf = (props: Props) => {
  const color = props["hl-color"]?.trim()
  return color === undefined || color === "" ? undefined : color
}

export const annotationMarks = (props: Props) => ({
  "data-annotation": isAreaAnnotation(props) ? "area" : "text",
  "data-highlight-color": colorOf(props),
})

export const annotationNames = (props: Props) => {
  const { className, ...attributes } = logseq("seqno-annotation", { color: colorOf(props) })
  return { className, attributes: { ...attributes, ...annotationMarks(props) } }
}

const stop = (event: MouseEvent) => event.stopPropagation()

const AreaImage = ({ block, stamp }: { readonly block: Block; readonly stamp: string }) => {
  const renderer = use(RenderContext)
  const picture = useRef<HTMLImageElement>(null)
  const [full, setFull] = useState(false)
  const title = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(pageTreeAtom(block.pageId)), (tree) => tree.page.title),
    () => null,
  )
  if (title === null || !title.startsWith("hls__")) return null
  const id = block.props["id"] ?? block.id
  const source = renderer.resolveAsset(
    `assets/${title.slice(5)}/${block.props["hl-page"] ?? ""}_${id}_${stamp}.png`,
  )
  return (
    <span {...logseq("seqno-annotation-area")}>
      <span {...logseq("seqno-annotation-area-actions")}>
        <button
          type="button"
          {...logseq("seqno-annotation-area-button")}
          title="Copy image"
          tabIndex={-1}
          onMouseDown={stop}
          onClick={(event) => {
            event.stopPropagation()
            if (picture.current !== null) void copyImage(picture.current).catch(() => undefined)
          }}
        >
          <IconCopy size={16} stroke={2} aria-hidden />
        </button>
        <button
          type="button"
          {...logseq("seqno-annotation-area-button")}
          title="Maximize image"
          tabIndex={-1}
          onMouseDown={stop}
          onClick={(event) => {
            event.stopPropagation()
            setFull(true)
          }}
        >
          <IconMaximize size={16} stroke={2} aria-hidden />
        </button>
      </span>
      {source === undefined ? null : <img ref={picture} src={source} alt="" />}
      {full && source !== undefined ? (
        <ImageViewer source={source} alt="" onClose={() => setFull(false)} />
      ) : null}
    </span>
  )
}

export const AnnotationPrefix = ({ block }: { readonly block: Block }) => {
  const { openAnnotation } = use(AssetActions)
  const area = isAreaAnnotation(block.props)
  const stamp = block.props["hl-stamp"]
  const onBlank = (event: MouseEvent) =>
    area &&
    event.target instanceof Element &&
    event.target.classList.contains("seqno-annotation-blank")
  return (
    <span
      {...logseq("seqno-annotation-prefix")}
      onMouseDown={(event) => {
        if (onBlank(event) || event.shiftKey) return
        event.preventDefault()
        event.stopPropagation()
        openAnnotation(block)
      }}
      onClick={(event) => {
        if (!onBlank(event) && !event.shiftKey) event.stopPropagation()
      }}
    >
      <span {...logseq("seqno-annotation-page")}>
        <strong
          {...logseq("seqno-annotation-page-number")}
        >{`P${block.props["hl-page"] ?? "?"}`}</strong>
        <label {...logseq("seqno-annotation-blank")}> </label>
      </span>
      {area && stamp !== undefined ? <AreaImage block={block} stamp={stamp} /> : null}
    </span>
  )
}

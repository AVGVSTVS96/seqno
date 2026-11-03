import { getStroke } from "perfect-freehand"
import type { BlockId, Vec } from "@seqno/domain"
import { sub } from "./geometry.ts"
import { HtmlView, IFrameView, PdfView, TweetView, YouTubeView } from "./Embeds.tsx"
import { PortalPreview, PortalView, type PortalEnv } from "./Portal.tsx"
import { absolutePoints, type Item, type Scene } from "./model.ts"
import { colorVar, fontSize, portalScale, strokeScale } from "./tools.ts"

export interface Editing {
  readonly id: BlockId
  readonly draft: string
  readonly onDraft: (text: string) => void
  readonly onFinish: (next: EventTarget | null) => void
}

export interface Portals {
  readonly env: PortalEnv
  readonly selected: ReadonlyArray<BlockId>
  readonly dimmed: ReadonlySet<string>
  readonly binding: BlockId | null
}

export interface ShapeSlots {
  readonly asset: (src: string) => string | undefined
  readonly measure: (blockId: BlockId) => (node: HTMLElement | null) => (() => void) | undefined
  readonly editing: Editing | null
  readonly portals: Portals | null
  readonly active: BlockId | null
  readonly selected: ReadonlyArray<BlockId>
  readonly reloads: ReadonlyMap<BlockId, number>
}

const ShapeEditor = ({ item, editing }: { readonly item: Item; readonly editing: Editing }) => (
  <textarea
    className="wb-edit"
    data-kind={item.shape.type === "text" ? "text" : "label"}
    aria-label={item.shape.type === "text" ? "Text" : "Label"}
    placeholder={item.shape.type === "text" ? "" : "Enter text"}
    autoFocus
    value={editing.draft}
    rows={1}
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => editing.onDraft(event.currentTarget.value)}
    onBlur={(event) => editing.onFinish(event.relatedTarget)}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === "Escape") {
        event.preventDefault()
        event.currentTarget.blur()
      }
      if (event.key === "Tab") {
        event.preventDefault()
        const { selectionStart, selectionEnd } = event.currentTarget
        editing.onDraft(
          `${editing.draft.slice(0, selectionStart)}\t${editing.draft.slice(selectionEnd)}`,
        )
      }
    }}
  />
)

const editorOf = (item: Item, slots: ShapeSlots) =>
  slots.editing?.id === item.block.id ? <ShapeEditor item={item} editing={slots.editing} /> : null

const portalOf = (item: Item, slots: ShapeSlots, scale: number) => {
  const { portals } = slots
  if (portals === null) return <PortalPreview item={item} scale={scale} />
  const selected = portals.selected.includes(item.block.id)
  const target = item.block.text.trim().toLowerCase()
  return (
    <PortalView
      item={item}
      scale={scale}
      live={portals.selected.length === 1 && selected}
      dim={!selected && portals.dimmed.has(target)}
      binding={portals.binding === item.block.id}
      env={portals.env}
    />
  )
}

const scaleOf = (item: Item) =>
  "scaleLevel" in item.shape && item.shape.scaleLevel !== undefined ? item.shape.scaleLevel : "md"

const lettering = (item: Item) => {
  const { shape } = item
  return {
    fontSize: fontSize[scaleOf(item)],
    fontWeight: "fontWeight" in shape && shape.fontWeight !== undefined ? shape.fontWeight : 400,
    fontStyle: "italic" in shape && shape.italic === true ? "italic" : "normal",
  }
}

const opacityOf = (item: Item) =>
  "opacity" in item.shape && item.shape.opacity !== undefined ? item.shape.opacity : 1

const rotated = (item: Item) =>
  item.shape.rotation === undefined || item.shape.rotation === 0
    ? undefined
    : `rotate(${item.shape.rotation}rad)`

const strokeOf = (item: Item) => ("stroke" in item.shape ? item.shape.stroke : undefined)

const fillOf = (item: Item) => ("fill" in item.shape ? item.shape.fill : undefined)

const svgPath = (outline: ReadonlyArray<ReadonlyArray<number>>) => {
  const [first, ...rest] = outline
  if (first === undefined) return ""
  return `M${first[0] ?? 0},${first[1] ?? 0}${rest.map(([x = 0, y = 0]) => `L${x},${y}`).join("")}Z`
}

const arrowHead = (from: Vec, to: Vec, length: number) => {
  const [dx, dy] = sub(to, from)
  const angle = Math.atan2(dy, dx)
  const arm = (turn: number): Vec => [
    to[0] - length * Math.cos(angle + turn),
    to[1] - length * Math.sin(angle + turn),
  ]
  const [ax, ay] = arm(Math.PI / 6)
  const [bx, by] = arm(-Math.PI / 6)
  return `M${ax},${ay}L${to[0]},${to[1]}L${bx},${by}`
}

const Label = ({ item, slots }: { readonly item: Item; readonly slots: ShapeSlots }) => {
  const editor = editorOf(item, slots)
  return (
    <div
      className="wb-label"
      style={{ ...lettering(item), color: colorVar("text", strokeOf(item)) }}
    >
      {editor ?? item.block.text}
    </div>
  )
}

const Geometry = ({
  item,
  size,
  slots,
}: {
  readonly item: Item
  readonly size: Vec
  readonly slots: ShapeSlots
}) => {
  const { shape } = item
  const [width, height] = size
  const font = fontSize[scaleOf(item)]
  const sw = font / 10
  const paint = {
    fill:
      "noFill" in shape && shape.noFill === true ? "none" : colorVar("background", fillOf(item)),
    stroke: colorVar("stroke", strokeOf(item)),
    strokeWidth: sw,
    strokeDasharray: "strokeType" in shape && shape.strokeType === "dashed" ? "8 2" : undefined,
  }
  const inner = (() => {
    switch (shape.type) {
      case "box":
        return (
          <rect
            x={sw / 2}
            y={sw / 2}
            width={Math.max(0, width - sw)}
            height={Math.max(0, height - sw)}
            rx={shape.borderRadius ?? 2}
            {...paint}
          />
        )
      case "ellipse":
        return (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={Math.max(0, width / 2 - sw / 2)}
            ry={Math.max(0, height / 2 - sw / 2)}
            {...paint}
          />
        )
      default: {
        const flipped = shape.type === "polygon" && shape.isFlippedY === true
        const top = flipped ? height - sw / 2 : sw / 2
        const base = flipped ? sw / 2 : height - sw / 2
        return (
          <polygon
            points={`${width / 2},${top} ${width - sw / 2},${base} ${sw / 2},${base}`}
            strokeLinejoin="round"
            {...paint}
          />
        )
      }
    }
  })()
  return (
    <>
      <svg className="wb-svg" width={width} height={height}>
        {inner}
      </svg>
      <Label item={item} slots={slots} />
    </>
  )
}

const LineView = ({
  item,
  scene,
  slots,
  erasing,
}: {
  readonly item: Item
  readonly scene: Scene
  readonly slots: ShapeSlots
  readonly erasing: boolean
}) => {
  const { shape } = item
  const ends = scene.ends.get(item.block.id)
  if (shape.type !== "line" || ends === undefined) return null
  const [start, end] = ends
  const font = fontSize[scaleOf(item)]
  const width = 1 + ((shape.strokeWidth ?? 1) * font) / 10
  const span = Math.hypot(end[0] - start[0], end[1] - start[1])
  const head = Math.min(span / 3, (shape.strokeWidth ?? 1) * font)
  const color = colorVar("text", shape.stroke)
  const decorations = shape.decorations ?? { end: "arrow" }
  const mid: Vec = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const editor = editorOf(item, slots)
  return (
    <div
      className="wb-shape"
      data-type="line"
      data-erasing={erasing}
      style={{ left: 0, top: 0, opacity: opacityOf(item) }}
    >
      <svg className="wb-svg" width={1} height={1}>
        <g
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={shape.strokeType === "dashed" ? "8 4" : undefined}
        >
          <path d={`M${start[0]},${start[1]}L${end[0]},${end[1]}`} />
          {decorations.end === "arrow" && span > 0 ? (
            <path d={arrowHead(start, end, head)} strokeDasharray="none" />
          ) : null}
          {decorations.start === "arrow" && span > 0 ? (
            <path d={arrowHead(end, start, head)} strokeDasharray="none" />
          ) : null}
        </g>
      </svg>
      {item.block.text === "" && editor === null ? null : (
        <div
          className="wb-line-label"
          style={{ left: mid[0], top: mid[1], ...lettering(item), color }}
        >
          {editor ?? item.block.text}
        </div>
      )}
    </div>
  )
}

const StrokeView = ({ item, erasing }: { readonly item: Item; readonly erasing: boolean }) => {
  const { shape } = item
  if (shape.type !== "pencil" && shape.type !== "highlighter") return null
  const width = strokeScale[scaleOf(item)]
  const points = absolutePoints(shape)
  if (shape.type === "highlighter") {
    return (
      <div
        className="wb-shape"
        data-erasing={erasing}
        style={{ left: 0, top: 0, opacity: shape.opacity ?? 0.5 }}
      >
        <svg className="wb-svg" width={1} height={1}>
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke={colorVar("stroke", shape.stroke)}
            strokeWidth={width * 16}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }
  const outline = getStroke(
    points.map(([x, y], index) => [x, y, shape.points[index]?.[2] ?? 0.5]),
    {
      size: 1 + width * 1.5,
      thinning: 0.65,
      streamline: 0.65,
      smoothing: 0.65,
      simulatePressure: true,
      last: true,
    },
  )
  return (
    <div
      className="wb-shape"
      data-erasing={erasing}
      style={{ left: 0, top: 0, opacity: shape.opacity ?? 1 }}
    >
      <svg className="wb-svg" width={1} height={1}>
        <path d={svgPath(outline)} fill={colorVar("text", shape.stroke)} />
      </svg>
    </div>
  )
}

export const ShapeView = ({
  item,
  scene,
  slots,
  erasing,
}: {
  readonly item: Item
  readonly scene: Scene
  readonly slots: ShapeSlots
  readonly erasing: boolean
}) => {
  const { shape } = item
  const box = scene.bounds.get(item.block.id)
  if (box === undefined) return null
  if (shape.type === "line")
    return <LineView item={item} scene={scene} slots={slots} erasing={erasing} />
  if (shape.type === "pencil" || shape.type === "highlighter") {
    return <StrokeView item={item} erasing={erasing} />
  }
  const size: Vec = [box.maxX - box.minX, box.maxY - box.minY]
  const place = {
    left: shape.point[0],
    top: shape.point[1],
    transform: rotated(item),
    opacity: opacityOf(item),
  }
  switch (shape.type) {
    case "box":
    case "ellipse":
    case "polygon":
      return (
        <div
          className="wb-shape"
          data-type={shape.type}
          data-erasing={erasing}
          style={{ ...place, width: size[0], height: size[1] }}
        >
          <Geometry item={item} size={size} slots={slots} />
        </div>
      )
    case "text": {
      const auto = shape.isSizeLocked !== false
      const editor = editorOf(item, slots)
      return (
        <div
          className="wb-shape"
          data-type="text"
          data-erasing={erasing}
          style={{ ...place, ...(auto ? {} : { width: size[0], height: size[1] }) }}
        >
          <div
            ref={slots.measure(item.block.id)}
            className="wb-text"
            data-auto={auto}
            style={{
              ...lettering(item),
              color: colorVar("text", shape.stroke),
              ...(auto ? {} : { width: size[0] }),
            }}
          >
            {editor ?? (item.block.text === "" ? "​" : item.block.text)}
          </div>
        </div>
      )
    }
    case "logseq-portal":
      return (
        <div
          ref={slots.measure(item.block.id)}
          className="wb-shape"
          data-type="portal"
          data-erasing={erasing}
          style={{ ...place, width: size[0] }}
        >
          {portalOf(item, slots, portalScale[scaleOf(item)])}
        </div>
      )
    case "image": {
      const src = shape.src === undefined ? undefined : slots.asset(shape.src)
      return (
        <div
          className="wb-shape"
          data-type="image"
          data-erasing={erasing}
          style={{ ...place, width: size[0], height: size[1] }}
        >
          <div className="wb-media" data-asset-loaded={src !== undefined}>
            {src === undefined ? (
              "Asset is missing"
            ) : (
              <img
                className="wb-image"
                src={src}
                alt=""
                draggable={false}
                style={{ objectFit: shape.objectFit === "contain" ? "contain" : "fill" }}
              />
            )}
          </div>
        </div>
      )
    }
    case "video": {
      const src = shape.src === undefined ? undefined : slots.asset(shape.src)
      const active = slots.active === item.block.id
      return (
        <div
          className="wb-shape"
          data-type="video"
          data-erasing={erasing}
          data-active={active}
          data-selected={slots.selected.includes(item.block.id)}
          style={{ ...place, width: size[0], height: size[1] }}
        >
          <div className="wb-media" data-asset-loaded={src !== undefined}>
            {src === undefined ? null : (
              <video className="wb-video" src={src} controls aria-label="Video" />
            )}
          </div>
        </div>
      )
    }
    case "youtube":
    case "tweet":
    case "iframe":
    case "html":
    case "pdf": {
      const active = slots.active === item.block.id
      const still = slots.portals === null
      const view = (() => {
        if (still && shape.type !== "youtube" && shape.type !== "html") {
          return <div className="wb-iframe" />
        }
        switch (shape.type) {
          case "youtube":
            return <YouTubeView url={shape.url ?? ""} still={still} />
          case "tweet":
            return (
              <TweetView
                url={shape.url ?? ""}
                dark={document.documentElement.dataset["theme"] === "dark"}
                measure={slots.measure(item.block.id)}
              />
            )
          case "iframe":
            return (
              <IFrameView url={shape.url ?? ""} frameKey={slots.reloads.get(item.block.id) ?? 0} />
            )
          case "html":
            return (
              <HtmlView
                html={shape.html ?? ""}
                scale={portalScale[scaleOf(item)]}
                measure={slots.measure(item.block.id)}
              />
            )
          case "pdf":
            return <PdfView src={shape.src === undefined ? undefined : slots.asset(shape.src)} />
        }
      })()
      return (
        <div
          className="wb-shape wb-embed"
          data-type={shape.type}
          data-erasing={erasing}
          data-active={active}
          data-selected={slots.selected.includes(item.block.id)}
          style={{ ...place, width: size[0], height: size[1] }}
        >
          {view}
        </div>
      )
    }
    case "group":
      return null
    case "unsupported":
      return shape.kind === "group" ? null : (
        <div
          className="wb-shape"
          data-type={shape.kind}
          data-erasing={erasing}
          style={{ ...place, width: size[0], height: size[1] }}
        >
          <div className="wb-other">
            <span>{shape.kind}</span>
            {shape.url === undefined ? null : (
              <a href={shape.url} target="_blank" rel="noreferrer">
                {shape.url}
              </a>
            )}
          </div>
        </div>
      )
  }
}

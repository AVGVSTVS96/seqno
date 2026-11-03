import { Option, Schema } from "effect"
import { BlockId } from "./ids.ts"
import type { Block, Page, Props } from "./model.ts"

export const TYPE_KEY = "ls-type"
export const SHAPE_KEY = "logseq.tldraw.shape"
export const WHITEBOARD_PAGE = "whiteboard-page"
export const WHITEBOARD_SHAPE = "whiteboard-shape"

export const whiteboardProps: Props = { [TYPE_KEY]: WHITEBOARD_PAGE }

export const isWhiteboard = (page: Page): boolean => page.props[TYPE_KEY] === WHITEBOARD_PAGE

export const isShapeBlock = (block: Block): boolean => block.props[TYPE_KEY] === WHITEBOARD_SHAPE

const Vec = Schema.Tuple([Schema.Finite, Schema.Finite])
export type Vec = typeof Vec.Type

export const ScaleLevel = Schema.Literals(["xs", "sm", "md", "lg", "xl", "xxl"])
export type ScaleLevel = typeof ScaleLevel.Type

const placed = {
  point: Vec,
  rotation: Schema.optionalKey(Schema.Finite),
  isLocked: Schema.optionalKey(Schema.Boolean),
  fill: Schema.optionalKey(Schema.String),
  stroke: Schema.optionalKey(Schema.String),
  noFill: Schema.optionalKey(Schema.Boolean),
  strokeWidth: Schema.optionalKey(Schema.Finite),
  strokeType: Schema.optionalKey(Schema.Literals(["line", "dashed"])),
  opacity: Schema.optionalKey(Schema.Finite),
  scaleLevel: Schema.optionalKey(ScaleLevel),
}

const sized = { ...placed, size: Vec }

const lettered = {
  fontWeight: Schema.optionalKey(Schema.Finite),
  italic: Schema.optionalKey(Schema.Boolean),
}

const Handle = Schema.Struct({ point: Vec, bindTo: Schema.optionalKey(BlockId) })
export type Handle = typeof Handle.Type

const Arrowhead = Schema.optionalKey(Schema.Literals(["arrow", ""]))

export const BoxShape = Schema.Struct({
  type: Schema.Literal("box"),
  ...sized,
  ...lettered,
  borderRadius: Schema.optionalKey(Schema.Finite),
})

export const EllipseShape = Schema.Struct({
  type: Schema.Literal("ellipse"),
  ...sized,
  ...lettered,
})

export const PolygonShape = Schema.Struct({
  type: Schema.Literal("polygon"),
  ...sized,
  ...lettered,
  sides: Schema.optionalKey(Schema.Int),
  isFlippedY: Schema.optionalKey(Schema.Boolean),
})

export const TextShape = Schema.Struct({
  type: Schema.Literal("text"),
  ...sized,
  ...lettered,
  isSizeLocked: Schema.optionalKey(Schema.Boolean),
})

export const LineShape = Schema.Struct({
  type: Schema.Literal("line"),
  ...placed,
  ...lettered,
  handles: Schema.Struct({ start: Handle, end: Handle }),
  decorations: Schema.optionalKey(Schema.Struct({ start: Arrowhead, end: Arrowhead })),
})

export const StrokeShape = Schema.Struct({
  type: Schema.Literals(["pencil", "highlighter"]),
  ...placed,
  points: Schema.Array(Schema.Array(Schema.Finite)),
})

export const PortalShape = Schema.Struct({
  type: Schema.Literal("logseq-portal"),
  ...sized,
  blockType: Schema.optionalKey(Schema.Literals(["P", "B"])),
  collapsed: Schema.optionalKey(Schema.Boolean),
  compact: Schema.optionalKey(Schema.Boolean),
  collapsedHeight: Schema.optionalKey(Schema.Finite),
  isAutoResizing: Schema.optionalKey(Schema.Boolean),
})

export const ImageShape = Schema.Struct({
  type: Schema.Literal("image"),
  ...sized,
  src: Schema.optionalKey(Schema.String),
  assetId: Schema.optionalKey(Schema.String),
  objectFit: Schema.optionalKey(Schema.String),
  isAspectRatioLocked: Schema.optionalKey(Schema.Boolean),
})

export const VideoShape = Schema.Struct({
  type: Schema.Literal("video"),
  ...sized,
  src: Schema.optionalKey(Schema.String),
  assetId: Schema.optionalKey(Schema.String),
  isAspectRatioLocked: Schema.optionalKey(Schema.Boolean),
})

export const GroupShape = Schema.Struct({
  type: Schema.Literal("group"),
  point: Vec,
  size: Schema.optionalKey(Vec),
  rotation: Schema.optionalKey(Schema.Finite),
  isLocked: Schema.optionalKey(Schema.Boolean),
  children: Schema.Array(Schema.String),
})

export const OtherShape = Schema.Struct({
  type: Schema.String,
  point: Vec,
  size: Schema.optionalKey(Vec),
  rotation: Schema.optionalKey(Schema.Finite),
  isLocked: Schema.optionalKey(Schema.Boolean),
  url: Schema.optionalKey(Schema.String),
})

export const Shape = Schema.Union([
  BoxShape,
  EllipseShape,
  PolygonShape,
  TextShape,
  LineShape,
  StrokeShape,
  PortalShape,
  ImageShape,
  VideoShape,
  GroupShape,
])
export type Shape = typeof Shape.Type

export type OtherShape = typeof OtherShape.Type

export const assetTypeOf = (shapeType: unknown): "image" | "video" | "pdf" =>
  shapeType === "video" || shapeType === "pdf" ? shapeType : "image"

const RawJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

const decodeShape = Schema.decodeUnknownOption(Schema.fromJsonString(Shape))
const decodeOther = Schema.decodeUnknownOption(Schema.fromJsonString(OtherShape))
const decodeRaw = Schema.decodeUnknownOption(RawJson)
const encodeRaw = Schema.encodeSync(RawJson)

export const shapeOf = (block: Block): Option.Option<Shape> =>
  isShapeBlock(block) ? decodeShape(block.props[SHAPE_KEY]) : Option.none()

export const otherShapeOf = (block: Block): Option.Option<OtherShape> =>
  isShapeBlock(block) && Option.isNone(shapeOf(block))
    ? decodeOther(block.props[SHAPE_KEY])
    : Option.none()

export const shapeRaw = (block: Block): Readonly<Record<string, unknown>> =>
  Option.getOrElse(decodeRaw(block.props[SHAPE_KEY]), () => ({}))

export const shapeValue = (raw: Readonly<Record<string, unknown>>): string => encodeRaw(raw)

export const patchShape = (block: Block, patch: Readonly<Record<string, unknown>>): string =>
  shapeValue({ ...shapeRaw(block), ...patch })

export const shapeProps = (raw: Readonly<Record<string, unknown>>): Props => ({
  [TYPE_KEY]: WHITEBOARD_SHAPE,
  [SHAPE_KEY]: shapeValue(raw),
})

export const PortalTarget = Schema.TaggedUnion({
  PagePortal: { name: Schema.String },
  BlockPortal: { uuid: Schema.String },
})
export type PortalTarget = typeof PortalTarget.Type

const PAGE_PORTAL = /^\[\[([^\]\n]+)\]\]$/
const BLOCK_PORTAL = /^\(\(([0-9a-fA-F-]{36})\)\)$/

export const portalTarget = (text: string): Option.Option<PortalTarget> => {
  const page = PAGE_PORTAL.exec(text.trim())?.[1]
  if (page !== undefined) return Option.some({ _tag: "PagePortal", name: page })
  const uuid = BLOCK_PORTAL.exec(text.trim())?.[1]
  return uuid === undefined
    ? Option.none()
    : Option.some({ _tag: "BlockPortal", uuid: uuid.toLowerCase() })
}

export const portalText = (target: PortalTarget): string =>
  PortalTarget.match(target, {
    PagePortal: ({ name }) => `[[${name}]]`,
    BlockPortal: ({ uuid }) => `((${uuid}))`,
  })

export const wordsField = (type: unknown): string | null => {
  switch (type) {
    case "text":
      return "text"
    case "box":
    case "ellipse":
    case "polygon":
    case "line":
      return "label"
    case "logseq-portal":
      return "pageId"
    default:
      return null
  }
}

export const wordsIn = (shape: Readonly<Record<string, unknown>>): string => {
  const field = wordsField(shape["type"])
  const value = field === null ? undefined : shape[field]
  if (typeof value !== "string") return ""
  if (field !== "pageId" || value === "") return value
  return portalText(
    shape["blockType"] === "P"
      ? { _tag: "PagePortal", name: value }
      : { _tag: "BlockPortal", uuid: value },
  )
}

export const wordsFields = (type: unknown, text: string): Readonly<Record<string, unknown>> => {
  const field = wordsField(type)
  if (field === null) return {}
  if (field !== "pageId") return { [field]: text }
  return Option.match(portalTarget(text), {
    onNone: () => ({ pageId: text }),
    onSome: (target) =>
      target._tag === "PagePortal"
        ? { blockType: "P", pageId: target.name }
        : { blockType: "B", pageId: target.uuid },
  })
}

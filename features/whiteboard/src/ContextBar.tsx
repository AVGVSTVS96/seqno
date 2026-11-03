import {
  IconArrowNarrowLeft,
  IconArrowNarrowRight,
  IconBold,
  IconCircle,
  IconCircleDashed,
  IconDimensions,
  IconDroplet,
  IconDropletOff,
  IconEdit,
  IconExternalLink,
  IconRefresh,
  IconItalic,
  IconLayoutNavbarCollapse,
  IconLayoutNavbarExpand,
  IconSquare,
  IconTriangle,
  IconTriangleSquareCircle,
} from "@tabler/icons-react"
import { Fragment, type ComponentType, type ReactNode } from "react"
import type { BlockId, ScaleLevel } from "@seqno/domain"
import type { Raw } from "./commands.ts"
import { EMBED_SIZE, htmlBounds } from "./Embeds.tsx"
import { LinksAction, type LinkEnv } from "./links.tsx"
import type { Item, Measured } from "./model.ts"
import { colorVar, portalScale, type ShapeTool } from "./tools.ts"
import {
  SCALE_LABELS,
  SCALES,
  Swatches,
  ToolButton,
  closePopover,
  usePopoverIds,
} from "./Toolbar.tsx"

type Action =
  | "EditPdf"
  | "PortalViewMode"
  | "Geometry"
  | "AutoResizing"
  | "Swatch"
  | "NoFill"
  | "StrokeType"
  | "ScaleLevel"
  | "TextStyle"
  | "YoutubeLink"
  | "TwitterLink"
  | "IFrameSource"
  | "ArrowMode"
  | "Links"

const ORDER: ReadonlyArray<Action> = [
  "EditPdf",
  "PortalViewMode",
  "Geometry",
  "AutoResizing",
  "Swatch",
  "NoFill",
  "StrokeType",
  "ScaleLevel",
  "TextStyle",
  "YoutubeLink",
  "TwitterLink",
  "IFrameSource",
  "ArrowMode",
  "Links",
]

const actionsOf = (item: Item): ReadonlyArray<Action> => {
  switch (item.shape.type) {
    case "box":
    case "ellipse":
    case "polygon":
      return ["Geometry", "Swatch", "NoFill", "StrokeType", "ScaleLevel", "TextStyle", "Links"]
    case "line":
      return ["Swatch", "ScaleLevel", "TextStyle", "ArrowMode", "Links"]
    case "text":
      return ["AutoResizing", "Swatch", "ScaleLevel", "TextStyle", "Links"]
    case "logseq-portal":
      return ["PortalViewMode", "AutoResizing", "Swatch", "ScaleLevel", "Links"]
    case "pencil":
    case "highlighter":
      return ["Swatch", "ScaleLevel", "Links"]
    case "youtube":
      return ["YoutubeLink", "Links"]
    case "tweet":
      return ["TwitterLink", "Links"]
    case "iframe":
      return ["IFrameSource", "Links"]
    case "pdf":
      return ["EditPdf", "Links"]
    case "html":
      return ["AutoResizing", "ScaleLevel", "Links"]
    case "group":
      return []
    default:
      return ["Links"]
  }
}

const SINGLE_ONLY: ReadonlyArray<Action> = [
  "Links",
  "EditPdf",
  "YoutubeLink",
  "TwitterLink",
  "IFrameSource",
]

export interface EmbedActions {
  readonly reload: (blockId: BlockId) => void
  readonly openPdf: (src: string) => void
  readonly measured: Measured
}

const openExternal = (url: string) => {
  if (/https?:\/\//.test(url)) window.open(url, "_blank", "noopener")
}

const UrlField = ({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) => (
  <span className="wb-url-field">
    <span className="wb-url-sizer" aria-hidden>
      {value}
    </span>
    <input
      className="wb-url-input"
      title={label}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => event.stopPropagation()}
    />
  </span>
)

export const contextActions = (items: ReadonlyArray<Item>): ReadonlyArray<Action> =>
  items.length === 0
    ? []
    : ORDER.filter(
        (action) =>
          (items.length === 1 || !SINGLE_ONLY.includes(action)) &&
          items.every((item) => actionsOf(item).includes(action)),
      )

const field = <K extends string>(item: Item, key: K): unknown =>
  key in item.shape ? Object.entries(item.shape).find(([name]) => name === key)?.[1] : undefined

const all = (items: ReadonlyArray<Item>, test: (item: Item) => boolean) => items.every(test)

const GEOMETRY: ReadonlyArray<
  readonly [ShapeTool, string, ComponentType<{ readonly size: number }>]
> = [
  ["box", "Rectangle", IconSquare],
  ["ellipse", "Circle", IconCircle],
  ["polygon", "Triangle", IconTriangle],
]

const Popover = ({
  label,
  icon,
  children,
}: {
  readonly label: string
  readonly icon: ReactNode
  readonly children: ReactNode
}) => {
  const ids = usePopoverIds()
  return (
    <>
      <button
        type="button"
        className="wb-button"
        aria-label={label}
        title={label}
        popoverTarget={ids.id}
        style={ids.trigger}
      >
        {icon}
      </button>
      <div id={ids.id} popover="auto" className="wb-popover" style={ids.popover}>
        {children}
      </div>
    </>
  )
}

export const ContextBar = ({
  items,
  left,
  top,
  onPatch,
  links,
  embeds,
}: {
  readonly items: ReadonlyArray<Item>
  readonly left: number
  readonly top: number
  readonly onPatch: (change: (item: Item) => Raw) => void
  readonly links: LinkEnv
  readonly embeds: EmbedActions
}) => {
  const actions = contextActions(items)
  if (actions.length === 0) return null
  const first = items[0]
  if (first === undefined) return null
  const color = field(first, "stroke")
  const scale = field(first, "scaleLevel")
  const bold = all(items, (item) => field(item, "fontWeight") === 700)
  const italic = all(items, (item) => field(item, "italic") === true)
  const noFill = all(items, (item) => field(item, "noFill") === true)
  const dashed = all(items, (item) => field(item, "strokeType") === "dashed")
  const auto = all(items, (item) =>
    item.shape.type === "text"
      ? item.shape.isSizeLocked !== false
      : field(item, "isAutoResizing") !== false,
  )
  const collapsed = all(items, (item) =>
    item.shape.type === "logseq-portal"
      ? item.shape.blockType === "B"
        ? item.shape.compact === true
        : item.shape.collapsed === true
      : false,
  )
  const ends = (end: "start" | "end") =>
    all(items, (item) =>
      item.shape.type === "line"
        ? (item.shape.decorations ?? { end: "arrow" })[end] === "arrow"
        : false,
    )
  const toggleEnd = (end: "start" | "end") => {
    const on = !ends(end)
    onPatch((item) => {
      const now = item.shape.type === "line" ? (item.shape.decorations ?? { end: "arrow" }) : {}
      return { decorations: { ...now, [end]: on ? "arrow" : "" } }
    })
  }
  const control = (action: Action): ReactNode => {
    switch (action) {
      case "PortalViewMode":
        return (
          <ToolButton
            label={collapsed ? "Expand" : "Collapse"}
            keys={collapsed ? "Mod+Down" : "Mod+Up"}
            onClick={() =>
              onPatch((item) =>
                item.shape.type === "logseq-portal" && item.shape.blockType === "B"
                  ? { compact: !collapsed }
                  : { collapsed: !collapsed },
              )
            }
          >
            {collapsed ? (
              <IconLayoutNavbarExpand size={16} />
            ) : (
              <IconLayoutNavbarCollapse size={16} />
            )}
          </ToolButton>
        )
      case "Geometry":
        return (
          <Popover label="Shape" icon={<IconTriangleSquareCircle size={16} />}>
            <div className="wb-panel" style={{ boxShadow: "none", padding: 0 }}>
              {GEOMETRY.map(([type, label, Icon]) => (
                <button
                  key={type}
                  type="button"
                  className="wb-button"
                  aria-label={label}
                  title={label}
                  aria-pressed={all(items, (item) => item.shape.type === type)}
                  onClick={(event) => {
                    onPatch(() => (type === "polygon" ? { type, sides: 3 } : { type }))
                    closePopover(event.currentTarget)
                  }}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </Popover>
        )
      case "AutoResizing":
        return (
          <ToolButton
            label="Auto resize"
            pressed={first.shape.type === "html" ? false : auto}
            onClick={() =>
              onPatch((item) => {
                if (item.shape.type === "html") {
                  const seen = embeds.measured.get(item.block.id)
                  return seen === undefined
                    ? {}
                    : { size: htmlBounds(seen, portalScale[item.shape.scaleLevel ?? "md"]) }
                }
                return item.shape.type === "text"
                  ? { isSizeLocked: true }
                  : { isAutoResizing: !auto }
              })
            }
          >
            <IconDimensions size={16} />
          </ToolButton>
        )
      case "Swatch":
        return (
          <Popover
            label="Color"
            icon={
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: "1px solid var(--wb-separator)",
                  background: colorVar("background", typeof color === "string" ? color : ""),
                }}
              />
            }
          >
            <Swatches
              current={typeof color === "string" ? color : ""}
              onPick={(picked) => onPatch(() => ({ fill: picked, stroke: picked }))}
            />
            <div className="wb-color-extra">
              <label>
                Custom color
                <input
                  type="color"
                  aria-label="Select custom color"
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    onPatch(() => ({ fill: value, stroke: value }))
                  }}
                />
              </label>
              <label>
                Opacity
                <input
                  type="range"
                  aria-label="Opacity"
                  min={0}
                  max={1}
                  step={0.1}
                  defaultValue={
                    typeof field(first, "opacity") === "number"
                      ? String(field(first, "opacity"))
                      : "1"
                  }
                  onPointerUp={(event) => {
                    const value = Number(event.currentTarget.value)
                    onPatch(() => ({ opacity: value }))
                  }}
                  onKeyUp={(event) => {
                    const value = Number(event.currentTarget.value)
                    onPatch(() => ({ opacity: value }))
                  }}
                />
              </label>
            </div>
          </Popover>
        )
      case "NoFill":
        return (
          <ToolButton
            label={noFill ? "Fill" : "No fill"}
            pressed={!noFill}
            onClick={() => onPatch(() => ({ noFill: !noFill }))}
          >
            {noFill ? <IconDropletOff size={16} /> : <IconDroplet size={16} />}
          </ToolButton>
        )
      case "StrokeType":
        return (
          <>
            <ToolButton
              label="Solid"
              pressed={!dashed}
              onClick={() => onPatch(() => ({ strokeType: "line" }))}
            >
              <IconCircle size={16} />
            </ToolButton>
            <ToolButton
              label="Dashed"
              pressed={dashed}
              onClick={() => onPatch(() => ({ strokeType: "dashed" }))}
            >
              <IconCircleDashed size={16} />
            </ToolButton>
          </>
        )
      case "ScaleLevel":
        return (
          <select
            aria-label="Scale"
            value={typeof scale === "string" ? scale : "md"}
            onChange={(event) => {
              const picked: ScaleLevel | undefined = SCALES.find(
                (level) => level === event.currentTarget.value,
              )
              if (picked !== undefined)
                onPatch((item) => {
                  if (item.shape.type !== "html") return { scaleLevel: picked }
                  const ratio = portalScale[picked] / portalScale[item.shape.scaleLevel ?? "md"]
                  const [w, h] = item.shape.size
                  return { scaleLevel: picked, size: [w * ratio, h * ratio] }
                })
            }}
          >
            {SCALES.map((level) => (
              <option key={level} value={level}>
                {SCALE_LABELS[level][1]}
              </option>
            ))}
          </select>
        )
      case "TextStyle":
        return (
          <>
            <ToolButton
              label="Bold"
              pressed={bold}
              onClick={() => onPatch(() => ({ fontWeight: bold ? 400 : 700 }))}
            >
              <IconBold size={16} />
            </ToolButton>
            <ToolButton
              label="Italic"
              pressed={italic}
              onClick={() => onPatch(() => ({ italic: !italic }))}
            >
              <IconItalic size={16} />
            </ToolButton>
          </>
        )
      case "ArrowMode":
        return (
          <>
            <ToolButton
              label="Start arrow head"
              pressed={ends("start")}
              onClick={() => toggleEnd("start")}
            >
              <IconArrowNarrowLeft size={16} />
            </ToolButton>
            <ToolButton
              label="End arrow head"
              pressed={ends("end")}
              onClick={() => toggleEnd("end")}
            >
              <IconArrowNarrowRight size={16} />
            </ToolButton>
          </>
        )
      case "EditPdf":
        return (
          <ToolButton
            label="Edit PDF"
            onClick={() => {
              const src = first.shape.type === "pdf" ? first.shape.src : undefined
              if (src !== undefined) embeds.openPdf(src)
            }}
          >
            <IconEdit size={16} />
          </ToolButton>
        )
      case "YoutubeLink":
      case "TwitterLink": {
        const url = String(field(first, "url") ?? "")
        const youtube = action === "YoutubeLink"
        return (
          <span className="wb-url-row">
            <UrlField
              label={youtube ? "YouTube url" : "Twitter url"}
              value={url}
              onChange={(next) =>
                onPatch(() => ({
                  url: next,
                  size: youtube ? EMBED_SIZE.youtube : EMBED_SIZE.tweet,
                }))
              }
            />
            <ToolButton
              label={youtube ? "Open YouTube url" : "Open Twitter url"}
              onClick={() => openExternal(url)}
            >
              <IconExternalLink size={16} />
            </ToolButton>
          </span>
        )
      }
      case "IFrameSource": {
        const url = String(field(first, "url") ?? "")
        return (
          <span className="wb-url-row">
            <ToolButton label="Reload" onClick={() => embeds.reload(first.block.id)}>
              <IconRefresh size={16} />
            </ToolButton>
            <UrlField
              label="Website url"
              value={url}
              onChange={(next) => onPatch(() => ({ url: next.trim().toLowerCase() }))}
            />
            <ToolButton
              label="Open website url"
              onClick={() => window.open(url, "_blank", "noopener")}
            >
              <IconExternalLink size={16} />
            </ToolButton>
          </span>
        )
      }
      case "Links":
        return (
          <LinksAction item={first} env={links} onLinks={(refs) => onPatch(() => ({ refs }))} />
        )
    }
  }
  return (
    <div
      className="wb-panel wb-context"
      role="toolbar"
      aria-label="Shape style"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {actions.map((action, index) => (
        <Fragment key={action}>
          {index === 0 ? null : <span className="wb-separator" />}
          {control(action)}
        </Fragment>
      ))}
    </div>
  )
}

import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBallpen,
  IconChevronDownLeft,
  IconCircle,
  IconCirclePlus,
  IconColorSwatch,
  IconEraser,
  IconGridDots,
  IconHandStop,
  IconHighlight,
  IconLetterT,
  IconLine,
  IconMagnet,
  IconMagnetOff,
  IconMinus,
  IconPlus,
  IconPointer,
  IconSquare,
  IconTriangle,
} from "@tabler/icons-react"
import { useId, type ComponentType, type CSSProperties, type ReactNode } from "react"
import type { ScaleLevel } from "@seqno/domain"
import { COLORS, colorVar, type Color, type ShapeTool, type Tool } from "./tools.ts"

export const anchorOf = (id: string) => `--wb-${id.replace(/[^a-zA-Z0-9]/g, "")}`

export const closePopover = (target: EventTarget) => {
  const popover = target instanceof Element ? target.closest("[popover]") : null
  if (popover instanceof HTMLElement) popover.hidePopover()
}

export const usePopoverIds = () => {
  const id = useId()
  const anchor = anchorOf(id)
  return {
    id: `wb-popover-${anchor.slice(5)}`,
    trigger: { anchorName: anchor } satisfies CSSProperties,
    popover: { positionAnchor: anchor } satisfies CSSProperties,
  }
}

export const ToolButton = ({
  label,
  keys,
  pressed,
  disabled,
  onClick,
  children,
}: {
  readonly label: string
  readonly keys?: string
  readonly pressed?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) => (
  <button
    type="button"
    className="wb-button"
    aria-label={label}
    title={keys === undefined ? label : `${label} (${keys})`}
    {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
)

export const SCALE_LABELS: Record<ScaleLevel, readonly [string, string]> = {
  xs: ["XS", "Extra Small"],
  sm: ["SM", "Small"],
  md: ["MD", "Medium"],
  lg: ["LG", "Large"],
  xl: ["XL", "Extra Large"],
  xxl: ["XXL", "Huge"],
}

export const SCALES: ReadonlyArray<ScaleLevel> = ["xs", "sm", "md", "lg", "xl", "xxl"]

const geometryIcon = (shape: ShapeTool) =>
  shape === "box" ? (
    <IconSquare size={16} />
  ) : shape === "ellipse" ? (
    <IconCircle size={16} />
  ) : (
    <IconTriangle size={16} />
  )

const GEOMETRY: ReadonlyArray<readonly [ShapeTool, string, string | undefined]> = [
  ["box", "Rectangle", "9"],
  ["ellipse", "Circle", "o"],
  ["polygon", "Triangle", undefined],
]

export const Swatches = ({
  current,
  onPick,
}: {
  readonly current: string | undefined
  readonly onPick: (color: Color) => void
}) => (
  <div className="wb-swatches" role="radiogroup" aria-label="Color">
    {COLORS.map((color) => (
      <button
        key={color}
        type="button"
        role="radio"
        className="wb-swatch"
        aria-label={color === "" ? "Default" : color}
        aria-checked={(current ?? "") === color}
        onClick={(event) => {
          onPick(color)
          closePopover(event.currentTarget)
        }}
      >
        <span style={{ background: colorVar("background", color) }} />
      </button>
    ))}
  </div>
)

export const PrimaryTools = ({
  tool,
  geometry,
  color,
  scale,
  onTool,
  onColor,
  onScale,
}: {
  readonly tool: Tool
  readonly geometry: ShapeTool
  readonly color: Color
  readonly scale: ScaleLevel
  readonly onTool: (tool: Tool) => void
  readonly onColor: (color: Color) => void
  readonly onScale: (scale: ScaleLevel) => void
}) => {
  const shapes = usePopoverIds()
  const colors = usePopoverIds()
  const button = ([value, label, keys, Icon]: ToolEntry) => (
    <ToolButton
      key={value}
      label={label}
      keys={keys}
      pressed={tool === value}
      onClick={() => onTool(value)}
    >
      <Icon size={16} />
    </ToolButton>
  )
  const shapePressed = tool === "box" || tool === "ellipse" || tool === "polygon"
  return (
    <div className="wb-primary">
      <div
        className="wb-panel"
        role="toolbar"
        aria-label="Whiteboard tools"
        aria-orientation="vertical"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {NAVIGATION_TOOLS.map(button)}
        <span className="wb-separator" />
        {DRAWING_TOOLS.map(button)}
        <button
          type="button"
          className="wb-button"
          aria-label="Shape"
          aria-pressed={shapePressed}
          popoverTarget={shapes.id}
          style={shapes.trigger}
        >
          {geometryIcon(geometry)}
          <IconChevronDownLeft className="wb-corner-mark" size={8} aria-hidden />
        </button>
        <div
          id={shapes.id}
          popover="auto"
          className="wb-popover wb-panel"
          data-side="left"
          style={{ ...shapes.popover, flexDirection: "column", padding: 4 }}
        >
          {GEOMETRY.map(([value, label, keys]) => (
            <ToolButton
              key={value}
              label={label}
              {...(keys === undefined ? {} : { keys })}
              pressed={tool === value}
              onClick={() => onTool(value)}
            >
              {geometryIcon(value)}
            </ToolButton>
          ))}
        </div>
        <span className="wb-separator" />
        <button
          type="button"
          className="wb-button"
          aria-label="Color"
          title="Color"
          popoverTarget={colors.id}
          style={colors.trigger}
        >
          {color === "" ? (
            <IconColorSwatch size={16} />
          ) : (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: colorVar("background", color),
              }}
            />
          )}
        </button>
        <div
          id={colors.id}
          popover="auto"
          className="wb-popover"
          data-side="left"
          style={colors.popover}
        >
          <Swatches current={color} onPick={onColor} />
        </div>
        <select
          className="wb-button wb-scale"
          aria-label="Scale"
          value={scale}
          onChange={(event) => {
            const picked = SCALES.find((level) => level === event.currentTarget.value)
            if (picked !== undefined) onScale(picked)
          }}
        >
          {SCALES.map((level) => (
            <option key={level} value={level}>
              {SCALE_LABELS[level][0]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

type ToolEntry = readonly [Tool, string, string, ComponentType<{ readonly size: number }>]

const NAVIGATION_TOOLS: ReadonlyArray<ToolEntry> = [
  ["select", "Select", "1", IconPointer],
  ["move", "Pan", "2", IconHandStop],
]

const DRAWING_TOOLS: ReadonlyArray<ToolEntry> = [
  ["portal", "Add block or page", "3", IconCirclePlus],
  ["pencil", "Draw", "4", IconBallpen],
  ["highlighter", "Highlight", "5", IconHighlight],
  ["eraser", "Eraser", "6", IconEraser],
  ["line", "Connector", "7", IconLine],
  ["text", "Text", "8", IconLetterT],
]

export type ZoomAction = "in" | "out" | "reset" | "drawing" | "selection"

export const ActionBar = ({
  zoom,
  grid,
  snap,
  hasSelection,
  onUndo,
  onRedo,
  onZoom,
  onGrid,
  onSnap,
}: {
  readonly zoom: number
  readonly grid: boolean
  readonly snap: boolean
  readonly hasSelection: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onZoom: (action: ZoomAction) => void
  readonly onGrid: () => void
  readonly onSnap: () => void
}) => {
  const menu = usePopoverIds()
  const item = (action: ZoomAction, label: string, keys: string, disabled = false) => (
    <button
      type="button"
      className="wb-menu-item"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        onZoom(action)
        closePopover(event.currentTarget)
      }}
    >
      {label}
      <span className="wb-menu-keys">{keys}</span>
    </button>
  )
  return (
    <div className="wb-action-bar" onPointerDown={(event) => event.stopPropagation()}>
      <div className="wb-panel" role="toolbar" aria-label="History">
        <ToolButton label="Undo" keys="Mod+Z" onClick={onUndo}>
          <IconArrowBackUp size={16} />
        </ToolButton>
        <ToolButton label="Redo" keys="Mod+Shift+Z" onClick={onRedo}>
          <IconArrowForwardUp size={16} />
        </ToolButton>
      </div>
      <div className="wb-panel" role="toolbar" aria-label="Zoom">
        <ToolButton label="Zoom in" keys="Shift+=" onClick={() => onZoom("in")}>
          <IconPlus size={16} />
        </ToolButton>
        <ToolButton label="Zoom out" keys="Shift+-" onClick={() => onZoom("out")}>
          <IconMinus size={16} />
        </ToolButton>
        <span className="wb-separator" />
        <button
          type="button"
          className="wb-button wb-button-text wb-zoom-label"
          aria-label="Zoom menu"
          popoverTarget={menu.id}
          style={menu.trigger}
        >
          {Math.round(zoom * 100)}%
        </button>
        <div
          id={menu.id}
          popover="auto"
          role="menu"
          className="wb-popover wb-menu"
          data-side="above-right"
          style={menu.popover}
        >
          {item("drawing", "Zoom to drawing", "Shift+1")}
          {item("selection", "Zoom to fit selection", "Shift+2", !hasSelection)}
          {item("in", "Zoom in", "Shift+=")}
          {item("out", "Zoom out", "Shift+-")}
          {item("reset", "Reset zoom", "Shift+0")}
        </div>
      </div>
      <div className="wb-panel" role="toolbar" aria-label="Grid">
        <ToolButton label="Toggle grid" keys="t g" pressed={grid} onClick={onGrid}>
          <IconGridDots size={16} />
        </ToolButton>
        <ToolButton label="Snap to grid" pressed={snap} onClick={onSnap}>
          {snap ? <IconMagnet size={16} /> : <IconMagnetOff size={16} />}
        </ToolButton>
      </div>
    </div>
  )
}

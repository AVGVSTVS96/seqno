import type { ScaleLevel, Vec } from "@seqno/domain"
import type { Raw } from "./commands.ts"

export type ShapeTool = "box" | "ellipse" | "polygon"

export type Tool =
  | "select"
  | "move"
  | "portal"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "line"
  | "text"
  | ShapeTool

export const COLORS = ["yellow", "red", "pink", "green", "blue", "purple", "gray", ""] as const

export type Color = (typeof COLORS)[number]

export interface Styles {
  readonly color: Color
  readonly scaleLevel: ScaleLevel
}

export const defaultStyles: Styles = { color: "", scaleLevel: "md" }

const isBuiltIn = (color: string): boolean => COLORS.some((name) => name === color)

const LOGSEQ_TEXT = /var\(--ls-primary-text-color(?:,[^)]*)?\)/gu

export const colorVar = (kind: "stroke" | "background" | "text", color: string | undefined) =>
  color === undefined || isBuiltIn(color)
    ? `var(--wb-${kind}-${color === undefined || color === "" ? "default" : color})`
    : color.replaceAll(LOGSEQ_TEXT, "var(--wb-text-default)")

const styled = (styles: Styles) => ({
  stroke: styles.color,
  fill: styles.color,
  strokeType: "line",
  opacity: 1,
  scaleLevel: styles.scaleLevel,
})

const lettered = { fontWeight: 400, italic: false }

export const newShape = (
  type: ShapeTool | "line" | "text" | "pencil" | "highlighter" | "logseq-portal",
  point: Vec,
  size: Vec,
  styles: Styles,
  extra: Raw = {},
): Raw => {
  const base = { type, point, ...styled(styles) }

  switch (type) {
    case "box": {
      return {
        ...base,
        size,
        borderRadius: 2,
        noFill: false,
        strokeWidth: 2,
        ...lettered,
        ...extra,
      }
    }

    case "ellipse": {
      return { ...base, size, noFill: false, strokeWidth: 2, ...lettered, ...extra }
    }

    case "polygon": {
      return {
        ...base,
        size,
        sides: 3,
        ratio: 1,
        isFlippedY: false,
        noFill: false,
        strokeWidth: 2,
        ...lettered,
        ...extra,
      }
    }

    case "text": {
      return {
        ...base,
        size,
        noFill: true,
        strokeWidth: 2,
        isSizeLocked: true,
        lineHeight: 1.2,
        padding: 4,
        ...lettered,
        ...extra,
      }
    }

    case "line": {
      return {
        ...base,
        noFill: true,
        strokeWidth: 1,
        decorations: { end: "arrow" },
        ...lettered,
        ...extra,
      }
    }

    case "pencil": {
      return { ...base, noFill: true, strokeWidth: 2, ...extra }
    }

    case "highlighter": {
      return { ...base, noFill: true, strokeWidth: 2, opacity: 0.5, ...extra }
    }

    case "logseq-portal": {
      return { type, point, size, compact: false, ...extra }
    }
  }
}

export const DEFAULT_SIZE: Vec = [100, 100]

export const PORTAL_WIDTH = 400

export const fontSize: Record<ScaleLevel, number> = {
  xs: 10,
  sm: 16,
  md: 20,
  lg: 32,
  xl: 48,
  xxl: 60,
}

export const strokeScale: Record<ScaleLevel, number> = {
  xs: 1,
  sm: 1.6,
  md: 2,
  lg: 3.2,
  xl: 4.8,
  xxl: 6,
}

export const portalScale: Record<ScaleLevel, number> = {
  xs: 0.5,
  sm: 0.8,
  md: 1,
  lg: 1.5,
  xl: 2,
  xxl: 3,
}

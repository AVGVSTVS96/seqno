import { logseq } from "@seqno/dom"
import { assetPageName, cljsStringHash, hlsPagePrefix } from "@seqno/syntax"
import type { Highlight } from "./highlights.ts"

export const colors = ["yellow", "red", "green", "blue", "purple"] as const

export type Color = (typeof colors)[number]

export const isColor = (value: string): value is Color => colors.some((color) => color === value)

export interface PdfAsset {
  readonly key: string
  readonly identity: string
  readonly filename: string
  readonly hlsFile: string
  readonly originalPath: string
}

const illegal = /[/?<>\\:*|"]/g
const reserved = /^\.+$/
const windowsReserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const windowsTrailing = /[. ]+$/

const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0

  return code <= 0x1f || (code >= 0x80 && code <= 0x9f)
}

const withoutControls = (text: string) => [...text].filter((char) => !isControl(char)).join("")

const truncateUtf8 = (text: string, limit: number) => {
  const encoder = new TextEncoder()
  let out = ""
  let used = 0

  for (const char of text) {
    const size = encoder.encode(char).length

    if (used + size > limit) {
      break
    }

    out += char
    used += size
  }

  return out
}

export const sanitizeFilename = (input: string): string =>
  truncateUtf8(
    withoutControls(input.replaceAll(illegal, ""))
      .replace(reserved, "")
      .replace(windowsReserved, "")
      .replace(windowsTrailing, ""),
    255,
  )

const basename = (path: string) => {
  const trimmed = path.replace(/\/+$/, "")

  return trimmed.slice(trimmed.lastIndexOf("/") + 1)
}

const extensionLength = (filename: string) => {
  const dot = filename.lastIndexOf(".")

  return dot === -1 ? -1 : filename.length - dot - 1
}

export const inflateAsset = (originalPath: string): PdfAsset | null => {
  const filename = basename(originalPath)
  const ext = extensionLength(filename)
  const stem = ext === -1 ? filename : filename.slice(0, filename.length - ext - 1)
  const filekey = sanitizeFilename(stem)

  if (filekey.trim() === "") {
    return null
  }

  const key = originalPath.startsWith("http")
    ? `${filekey}__${cljsStringHash(originalPath)}`
    : filekey

  return {
    key,
    identity: key.slice(Math.max(0, key.length - 15)),
    filename,
    hlsFile: `assets/${key}.edn`,
    originalPath,
  }
}

export const hlsPrefix = hlsPagePrefix

export const hlsPageTitle = (key: string) => `${hlsPrefix}${key.trim()}`

export const isHlsPage = (name: string) => name.startsWith(hlsPrefix)

export const keyOfHlsPage = (title: string) => title.slice(hlsPrefix.length)

export const displayName = assetPageName

export const hlsPageProps = (asset: PdfAsset, org: boolean): Readonly<Record<string, string>> => ({
  file: org
    ? `[[${asset.originalPath}][${asset.filename}]]`
    : `[${asset.filename}](${asset.originalPath})`,
  "file-path": asset.originalPath,
})

export const areaImagePath = (key: string, page: number, id: string, stamp: number) =>
  `assets/${key}/${page}_${id}_${stamp}.png`

export const fixSelectionText = (text: string): string => {
  const marker = "|#|"

  return text
    .replaceAll(/[\r\n]+/g, marker)
    .replaceAll(`-${marker}`, "")
    .replaceAll(/\|#\|([a-zA-Z_])/g, " $1")
    .replaceAll(marker, "")
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Scaled {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export const viewportToScaled = (rect: Box, viewport: Size): Scaled => ({
  x1: rect.left,
  y1: rect.top,
  x2: rect.left + rect.width,
  y2: rect.top + rect.height,
  width: viewport.width,
  height: viewport.height,
})

export const scaledToViewport = (scaled: Scaled, viewport: Size): Box => {
  const x1 = (viewport.width * scaled.x1) / scaled.width
  const y1 = (viewport.height * scaled.y1) / scaled.height
  const x2 = (viewport.width * scaled.x2) / scaled.width
  const y2 = (viewport.height * scaled.y2) / scaled.height

  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }
}

export const boundingRect = (rects: readonly Box[]): Box => {
  const [first, ...rest] = rects

  if (first === undefined) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  const edges = rest.reduce(
    (box, rect) => ({
      x0: Math.min(box.x0, rect.left),
      x1: Math.max(box.x1, rect.left + rect.width),
      y0: Math.min(box.y0, rect.top),
      y1: Math.max(box.y1, rect.top + rect.height),
    }),
    { x0: first.left, x1: first.left + first.width, y0: first.top, y1: first.top + first.height },
  )

  return { left: edges.x0, top: edges.y0, width: edges.x1 - edges.x0, height: edges.y1 - edges.y0 }
}

interface Mutable {
  left: number
  top: number
  width: number
  height: number
}

export const optimizeClientRects = (input: readonly Box[]): readonly Box[] => {
  const rects: Mutable[] = input
    .map((rect) => ({ ...rect }))
    .toSorted((a, b) => (a.top - b.top === 0 ? a.left - b.left : a.top - b.top))

  const overlaps = (a: Mutable, b: Mutable) => a.left <= b.left && b.left <= a.left + a.width

  const sameLine = (a: Mutable, b: Mutable) =>
    Math.abs(a.top - b.top) < 5 && Math.abs(a.height - b.height) < 5

  const inside = (a: Mutable, b: Mutable) =>
    a.top > b.top &&
    a.left > b.left &&
    a.top + a.height < b.top + b.height &&
    a.left + a.width < b.left + b.width

  const nextTo = (a: Mutable, b: Mutable) => {
    const aRight = a.left + a.width

    return a.left <= b.left && aRight <= b.left + b.width && b.left - aRight <= 10
  }

  const extendWidth = (a: Mutable, b: Mutable) => {
    a.width = Math.max(b.width - a.left + b.left, a.width)
  }

  const kept = rects.filter((rect) => rects.every((other) => !inside(rect, other)))
  const removed = new Set<Mutable>()

  for (let pass = 0; pass <= 2; pass += 1) {
    for (const a of kept) {
      for (const b of kept) {
        if (a === b || removed.has(a) || removed.has(b) || !sameLine(a, b)) {
          continue
        }

        if (overlaps(a, b)) {
          extendWidth(a, b)
          a.height = Math.max(a.height, b.height)
          removed.add(b)
        }

        if (nextTo(a, b)) {
          extendWidth(a, b)
          removed.add(b)
        }
      }
    }
  }

  return kept.filter((rect) => !removed.has(rect))
}

export const minScale = 0.25
export const maxScale = 5

export const zoomIn = (scale: number) =>
  Math.min(maxScale, Math.ceil(Number((scale * 1.05).toFixed(2)) * 10) / 10)

export const zoomOut = (scale: number) =>
  Math.max(minScale, Math.floor(Number((scale / 1.05).toFixed(2)) * 10) / 10)

export const annotationProps = (highlight: Highlight): Readonly<Record<string, string>> => ({
  "ls-type": "annotation",
  "hl-page": String(highlight.page),
  "hl-color": highlight.properties.color ?? "",
  id: highlight.id,
  ...(highlight.content.image === undefined
    ? {}
    : { "hl-type": "area", "hl-stamp": String(highlight.content.image) }),
})

type ToggledPart =
  | "seqno-pdf-open"
  | "seqno-pdf-resizing"
  | "seqno-pdf-picking"
  | "seqno-pdf-flash"
  | "seqno-pdf-highlights-layer"

export const classesOf = (part: ToggledPart) => logseq(part).className.split(" ")

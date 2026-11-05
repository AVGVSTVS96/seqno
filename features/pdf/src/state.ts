import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Schema } from "effect"
import { Atom } from "effect/reactivity"
import type { PDFDocumentProxy } from "pdfjs-dist"
import type { Highlight, Highlights } from "./highlights.ts"
import type { Color, PdfAsset } from "./model.ts"
import type { Pdfjs } from "./pdfjs.ts"

export type Loaded =
  | {
      readonly _tag: "Ready"
      readonly document: PDFDocumentProxy
      readonly highlights: Highlights | null
      readonly pdfjs: Pdfjs
    }
  | { readonly _tag: "Password" }
  | { readonly _tag: "Failed" }

export interface CurrentPdf {
  readonly asset: PdfAsset
  readonly url: string
  readonly attempt: number
  readonly loading: Promise<Loaded>
}

export const currentPdf = Atom.make<CurrentPdf | null>(null).pipe(Atom.keepAlive)

export interface RefHighlight {
  readonly page: number
  readonly highlight: Highlight | null
}

export const refHighlight = Atom.make<RefHighlight | null>(null).pipe(Atom.keepAlive)

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

const stored = <S extends Schema.ConstraintCodec<unknown, unknown>>(
  key: string,
  schema: S,
  defaultValue: S["Type"],
) =>
  Atom.kvs({ runtime: storage, key, schema, defaultValue: () => defaultValue }).pipe(Atom.keepAlive)

export const ViewerTheme = Schema.Literals(["light", "warm", "dark"])

export type ViewerTheme = typeof ViewerTheme.Type

export const viewerTheme = stored("ls-pdf-viewer-theme", ViewerTheme, "light")
export const areaDashed = stored("ls-pdf-area-is-dashed", Schema.Boolean, false)
export const blockColored = stored("ls-pdf-hl-block-is-colored", Schema.Boolean, true)
export const autoOpenMenu = stored("ls-pdf-auto-open-ctx-menu", Schema.Boolean, true)

export const areaMode = Atom.make(false).pipe(Atom.keepAlive)
export const highlightMode = Atom.make(false).pipe(Atom.keepAlive)
export const lastColor = Atom.make<Color>("yellow").pipe(Atom.keepAlive)

export interface LiveHighlights {
  readonly key: string
  readonly highlights: readonly Highlight[]
}

export const liveHighlights = Atom.make<LiveHighlights | null>(null).pipe(Atom.keepAlive)

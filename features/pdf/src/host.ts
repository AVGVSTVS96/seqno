import type { Navigate } from "@seqno/outliner"

export interface PdfFiles {
  readonly resolveAsset: (path: string) => string | undefined
  readonly writeAsset: (path: string, data: Blob) => Promise<void>
  readonly removeAsset: (path: string) => Promise<void>
  readonly notify: (message: string) => void
}

export interface HighlightPoint {
  readonly text: string
  readonly x: number
  readonly y: number
}

export interface HighlightMenuItem {
  readonly key: string
  readonly label: string
  readonly run: (point: HighlightPoint) => void
  readonly clearSelection: boolean
}

export interface PdfHost extends PdfFiles {
  readonly navigate: Navigate
  readonly menuItems: ReadonlyArray<HighlightMenuItem>
}

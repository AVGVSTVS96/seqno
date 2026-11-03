import { BrowserCrypto } from "@effect/platform-browser"
import { Effect, Option, Schema } from "effect"
import type { AtomRegistry } from "effect/reactivity"
import { newBlockId } from "@seqno/domain"
import type { CoreClient } from "@seqno/rpc"
import type { PDFDocumentProxy } from "pdfjs-dist"
import type {
  EventBus,
  PDFFindController,
  PDFPageView,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs"
import { deleteRefBlock, ensureRefBlock, runCore, updateRefBlock } from "./annotations.ts"
import { isArea, printHighlights, type Highlight, type Highlights } from "./highlights.ts"
import type { HighlightMenuItem, PdfFiles } from "./host.ts"
import type { Navigate } from "@seqno/outliner"
import {
  areaImagePath,
  boundingRect,
  fixSelectionText,
  hlsPageTitle,
  optimizeClientRects,
  scaledToViewport,
  viewportToScaled,
  zoomIn,
  zoomOut,
  type Box,
  type Color,
  type PdfAsset,
} from "./model.ts"
import { closePdf } from "./open.ts"
import type { Pdfjs } from "./pdfjs.ts"
import {
  areaMode,
  autoOpenMenu,
  highlightMode,
  lastColor,
  liveHighlights,
  refHighlight,
} from "./state.ts"

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Menu {
  readonly highlight: Highlight
  readonly fresh: boolean
  readonly point: Point
  readonly top: number
  readonly left: number
  readonly selection: string | null
  readonly hidden: boolean
}

export interface FindState {
  readonly status: "found" | "not-found" | "wrapped" | "pending" | null
  readonly current: number
  readonly total: number
  readonly query: string
}

export interface Snapshot {
  readonly ready: boolean
  readonly page: number
  readonly pages: number
  readonly scale: number
  readonly layers: ReadonlyMap<number, HTMLElement>
  readonly highlights: ReadonlyArray<Highlight>
  readonly menu: Menu | null
  readonly area: Box | null
  readonly resizing: { readonly id: string; readonly box: Box } | null
  readonly find: FindState
  readonly finder: boolean
  readonly broken: boolean
}

const PageEvent = Schema.Struct({ pageNumber: Schema.Number })
const ScaleEvent = Schema.Struct({ scale: Schema.Number })
const Matches = Schema.Struct({ current: Schema.Number, total: Schema.Number })
const MatchesEvent = Schema.Struct({ matchesCount: Matches })
const ControlEvent = Schema.Struct({
  state: Schema.Number,
  matchesCount: Matches,
  rawQuery: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

const statuses = ["found", "not-found", "wrapped", "pending"] as const

const noFind: FindState = { status: null, current: 0, total: 0, query: "" }

const saveDelay = 4000

const newHighlightId = () => Effect.runSync(Effect.provide(newBlockId, BrowserCrypto.layer))

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT")

const boxBetween = (a: Point, b: Point): Box => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
})

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export class Session {
  readonly registry: AtomRegistry.AtomRegistry
  readonly asset: PdfAsset
  readonly document: PDFDocumentProxy
  readonly pdfjs: Pdfjs
  readonly host: PdfFiles
  viewer: PDFViewer | null = null
  bus: EventBus | null = null
  container: HTMLDivElement | null = null
  private state: Snapshot
  private readonly listeners = new Set<() => void>()
  private readonly initialPage: number
  private written: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private closeMenuListener: (() => void) | null = null

  constructor(
    registry: AtomRegistry.AtomRegistry,
    host: PdfFiles,
    asset: PdfAsset,
    document: PDFDocumentProxy,
    pdfjs: Pdfjs,
    highlights: Highlights | null,
  ) {
    this.registry = registry
    this.host = host
    this.asset = asset
    this.document = document
    this.pdfjs = pdfjs
    this.initialPage = highlights?.page ?? 1
    this.state = {
      ready: false,
      page: 1,
      pages: document.numPages,
      scale: 1,
      layers: new Map(),
      highlights: highlights?.highlights ?? [],
      menu: null,
      area: null,
      resizing: null,
      find: noFind,
      finder: false,
      broken: highlights === null,
    }
    if (highlights !== null) this.written = printHighlights(highlights)
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly snapshot = () => this.state

  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  pageView(page: number): PDFPageView | undefined {
    const view: unknown = this.viewer?.getPageView(page - 1)
    return view instanceof this.pdfjs.viewer.PDFPageView ? view : undefined
  }

  viewportOf(page: number) {
    return this.pageView(page)?.viewport
  }

  readonly attach = (container: HTMLDivElement | null) => {
    if (container === null) return
    const { EventBus, PDFFindController, PDFLinkService, PDFViewer, LinkTarget } = this.pdfjs.viewer
    const bus = new EventBus()
    const linkService = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK })
    const findController: PDFFindController = new PDFFindController({ linkService, eventBus: bus })
    const viewer = new PDFViewer({
      container,
      eventBus: bus,
      linkService,
      findController,
      textLayerMode: 2,
      annotationMode: 2,
      removePageBorders: true,
    })
    linkService.setDocument(this.document)
    linkService.setViewer(viewer)
    this.viewer = viewer
    this.bus = bus
    this.container = container
    bus.on("pagesinit", () => {
      viewer.currentScaleValue = "auto"
      this.set({ ready: true, page: viewer.currentPageNumber, scale: viewer.currentScale })
      this.scheduleSave()
      this.findReference(500)
    })
    bus.on("textlayerrendered", (event: unknown) =>
      Option.map(Schema.decodeUnknownOption(PageEvent)(event), ({ pageNumber }) =>
        this.resolveLayer(pageNumber),
      ),
    )
    bus.on("pagechanging", (event: unknown) =>
      Option.map(Schema.decodeUnknownOption(PageEvent)(event), ({ pageNumber }) => {
        this.set({ page: pageNumber })
        this.scheduleSave()
      }),
    )
    bus.on("scalechanging", (event: unknown) =>
      Option.map(Schema.decodeUnknownOption(ScaleEvent)(event), ({ scale }) => this.set({ scale })),
    )
    bus.on("updatefindmatchescount", (event: unknown) =>
      Option.map(Schema.decodeUnknownOption(MatchesEvent)(event), ({ matchesCount }) =>
        this.set({ find: { ...this.state.find, ...matchesCount } }),
      ),
    )
    bus.on("updatefindcontrolstate", (event: unknown) =>
      Option.map(Schema.decodeUnknownOption(ControlEvent)(event), (control) =>
        this.set({
          find: {
            status: statuses[control.state] ?? null,
            query: control.rawQuery ?? "",
            ...control.matchesCount,
          },
        }),
      ),
    )
    viewer.setDocument(this.document)
    this.registry.set(liveHighlights, { key: this.asset.key, highlights: this.state.highlights })
    const stopRef = this.registry.subscribe(refHighlight, (wanted) => {
      if (wanted !== null && this.state.ready) this.findReference(50)
    })
    const onResize = () => this.fitSoon()
    const onKey = (event: KeyboardEvent) => this.onKey(event)
    const onCopy = (event: ClipboardEvent) => this.onCopy(event)
    window.addEventListener("resize", onResize)
    document.addEventListener("keydown", onKey)
    container.addEventListener("copy", onCopy)
    document.body.classList.add("seqno-pdf-open")
    return () => {
      stopRef()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("keydown", onKey)
      container.removeEventListener("copy", onCopy)
      document.body.classList.remove("seqno-pdf-open")
      this.closeMenu()
      this.flush()
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
      if (this.registry.get(liveHighlights)?.key === this.asset.key) {
        this.registry.set(liveHighlights, null)
      }
      viewer.cleanup()
      void this.document.loadingTask.destroy()
      this.viewer = null
      this.bus = null
      this.container = null
    }
  }

  private resolveLayer(page: number) {
    const host = this.pageView(page)?.textLayer?.div
    if (host === undefined) return
    const existing = host.querySelector(":scope > .seqno-pdf-highlights-layer")
    const layer = existing instanceof HTMLElement ? existing : document.createElement("div")
    if (existing === null) {
      layer.className = "seqno-pdf-highlights-layer"
      host.append(layer)
    }
    if (this.state.layers.get(page) === layer) return
    const layers = new Map(this.state.layers)
    layers.set(page, layer)
    this.set({ layers })
  }

  private findReference(delay: number) {
    const wanted = this.registry.get(refHighlight)
    if (wanted === null) {
      setTimeout(() => {
        if (this.viewer !== null && this.registry.get(refHighlight) === null) {
          this.viewer.currentPageNumber = Math.min(Math.max(1, this.initialPage), this.state.pages)
        }
      }, 16)
      return
    }
    setTimeout(() => {
      if (wanted.highlight !== null) this.scrollTo(wanted.highlight)
      else if (this.viewer !== null) this.viewer.currentPageNumber = wanted.page
    }, delay)
    setTimeout(() => {
      if (this.registry.get(refHighlight) === wanted) this.registry.set(refHighlight, null)
    }, 1000)
  }

  scrollTo(highlight: Highlight) {
    const viewer = this.viewer
    const viewport = this.viewportOf(highlight.position.page)
    if (viewer === null || viewport === undefined) return
    const top = scaledToViewport(highlight.position.bounding, viewport).top - 200
    viewer.scrollPageIntoView({
      pageNumber: highlight.position.page,
      destArray: [
        null,
        { name: "XYZ" },
        ...viewport.convertToPdfPoint(viewer.container.scrollLeft, top),
        viewer.currentScale,
      ],
      ignoreDestinationZoom: true,
    })
    setTimeout(() => {
      const region = this.container?.ownerDocument.getElementById(
        `seqno-pdf-highlight-${highlight.id}`,
      )
      if (region === null || region === undefined) return
      region.classList.add("is-flashing")
      setTimeout(() => region.classList.remove("is-flashing"), 1200)
    }, 200)
  }

  fitSoon() {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      if (this.viewer !== null) this.viewer.currentScaleValue = "auto"
    }, 200)
  }

  zoomIn() {
    const viewer = this.viewer
    if (viewer !== null && viewer.currentScale < 5)
      viewer.currentScale = zoomIn(viewer.currentScale)
  }

  zoomOut() {
    const viewer = this.viewer
    if (viewer !== null && viewer.currentScale > 0.25) {
      viewer.currentScale = zoomOut(viewer.currentScale)
    }
  }

  goToPage(page: number) {
    if (this.viewer !== null) this.viewer.currentPageNumber = Math.min(page, this.state.pages)
  }

  nextPage() {
    this.viewer?.nextPage()
  }

  previousPage() {
    this.viewer?.previousPage()
  }

  setFinder(open: boolean) {
    if (!open) this.bus?.dispatch("findbarclose", { source: null })
    this.set({ finder: open, find: open ? this.state.find : noFind })
  }

  find(query: string, caseSensitive: boolean, previous: boolean, type: string) {
    this.bus?.dispatch("find", {
      source: null,
      type,
      query,
      caseSensitive,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
  }

  resetFind() {
    this.bus?.dispatch("findbarclose", { source: null })
    this.set({ find: noFind })
  }

  private onKey(event: KeyboardEvent) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (isEditable(document.activeElement)) return
    const action =
      event.code === "KeyP"
        ? () => this.previousPage()
        : event.code === "KeyN"
          ? () => this.nextPage()
          : event.code === "KeyX"
            ? () => closePdf(this.registry)
            : event.code === "KeyF"
              ? () => this.setFinder(true)
              : null
    if (action === null) return
    event.preventDefault()
    action()
  }

  private onCopy(event: ClipboardEvent) {
    const selection = document.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
    const within = selection.getRangeAt(0).commonAncestorContainer
    const viewerElement = this.viewer?.viewer
    if (viewerElement === null || viewerElement === undefined || !viewerElement.contains(within)) {
      return
    }
    event.clipboardData?.setData("text/plain", fixSelectionText(selection.toString()))
    event.preventDefault()
  }

  private updateHighlights(highlights: ReadonlyArray<Highlight>) {
    this.set({ highlights })
    this.registry.set(liveHighlights, { key: this.asset.key, highlights })
    this.scheduleSave()
  }

  private scheduleSave() {
    if (this.state.broken || !this.state.ready) return
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), saveDelay)
  }

  flush() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.state.broken || !this.state.ready) return
    const text = printHighlights({ highlights: this.state.highlights, page: this.state.page })
    if (text === this.written) return
    this.written = text
    this.host
      .writeAsset(this.asset.hlsFile, new Blob([text]))
      .catch((cause: unknown) =>
        this.host.notify(`Couldn't save ${this.asset.hlsFile}: ${messageOf(cause)}`),
      )
  }

  private menuAt(point: Point) {
    const container = this.container
    if (container === null) return { top: point.y, left: point.x }
    const rect = container.getBoundingClientRect()
    return {
      top: point.y - rect.top + container.scrollTop,
      left: point.x - rect.left + container.scrollLeft,
    }
  }

  openMenu(highlight: Highlight, point: Point, fresh: boolean, selection: string | null) {
    this.closeMenu()
    const hidden =
      fresh &&
      (this.registry.get(highlightMode) || (selection !== null && !this.registry.get(autoOpenMenu)))
    this.set({
      menu: { highlight, fresh, point, ...this.menuAt(point), selection, hidden },
    })
    if (fresh && this.registry.get(highlightMode)) {
      setTimeout(() => this.applyColor(this.registry.get(lastColor)), 300)
      return
    }
    const close = () => this.closeMenu()
    setTimeout(() => {
      if (this.state.menu?.highlight !== highlight) return
      document.addEventListener("click", close)
      this.closeMenuListener = () => document.removeEventListener("click", close)
    })
  }

  closeMenu() {
    this.closeMenuListener?.()
    this.closeMenuListener = null
    if (this.state.menu !== null) this.set({ menu: null })
  }

  closeMenuSoon() {
    setTimeout(() => this.closeMenu(), 68)
  }

  applyColor(color: Color) {
    const menu = this.state.menu
    if (menu === null) return
    this.registry.set(lastColor, color)
    if (menu.fresh) {
      const highlight: Highlight = {
        ...menu.highlight,
        id: newHighlightId(),
        properties: { color },
      }
      this.updateHighlights([...this.state.highlights, highlight])
      if (isArea(highlight)) this.captureArea(highlight, null)
      document.getSelection()?.removeAllRanges()
      this.copyRef(highlight)
    } else {
      const highlight: Highlight = { ...menu.highlight, properties: { color } }
      this.replace(highlight)
      this.runCore(updateRefBlock(highlight, Date.now()))
    }
    this.closeMenuSoon()
  }

  private replace(highlight: Highlight) {
    this.updateHighlights(
      this.state.highlights.map((other) => (other.id === highlight.id ? highlight : other)),
    )
  }

  private runCore<A, E>(effect: Effect.Effect<A, E, CoreClient>) {
    return runCore(this.registry, effect).catch((cause: unknown) => {
      this.host.notify(`Couldn't update ${hlsPageTitle(this.asset.key)}: ${messageOf(cause)}`)
      return null
    })
  }

  ensureBlock(highlight: Highlight) {
    return this.runCore(ensureRefBlock(this.asset, highlight))
  }

  copyRef(highlight: Highlight) {
    void this.ensureBlock(highlight).then((block) => {
      if (block === null) return
      return navigator.clipboard.writeText(`((${highlight.id}))`).catch(() => undefined)
    })
  }

  copyText(menu: Menu) {
    const text = menu.highlight.content.text ?? menu.selection ?? ""
    void navigator.clipboard.writeText(text).catch(() => undefined)
    document.getSelection()?.removeAllRanges()
    this.closeMenuSoon()
  }

  linkedReferences(highlight: Highlight, navigate: Navigate) {
    void this.ensureBlock(highlight).then((block) => {
      if (block !== null) navigate({ _tag: "Zoom", pageId: block.pageId, blockId: block.id })
    })
    this.closeMenuSoon()
  }

  remove(highlight: Highlight) {
    this.updateHighlights(this.state.highlights.filter((other) => other.id !== highlight.id))
    this.runCore(deleteRefBlock(highlight))
    if (highlight.content.image !== undefined) {
      this.host
        .removeAsset(
          areaImagePath(this.asset.key, highlight.page, highlight.id, highlight.content.image),
        )
        .catch(() => undefined)
    }
    this.closeMenuSoon()
  }

  runItem(item: HighlightMenuItem, menu: Menu) {
    item.run({ text: menu.highlight.content.text ?? "", x: menu.point.x, y: menu.point.y })
    if (item.clearSelection) document.getSelection()?.removeAllRanges()
    this.closeMenuSoon()
  }

  selectionEnded(point: Point) {
    const selection = document.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const container = this.container
    if (container === null || !container.contains(range.commonAncestorContainer)) return
    const pageElement = range.startContainer.parentElement?.closest(".page")
    if (!(pageElement instanceof HTMLElement)) return
    const page = Number(pageElement.dataset["pageNumber"])
    const viewport = this.viewportOf(page)
    if (viewport === undefined) return
    const box = pageElement.getBoundingClientRect()
    const rects = optimizeClientRects(
      [...range.getClientRects()]
        .filter((rect) => rect.width !== 0 && rect.height !== 0)
        .map((rect) => ({
          top: rect.top + pageElement.scrollTop - box.top,
          left: rect.left + pageElement.scrollLeft - box.left,
          width: rect.width,
          height: rect.height,
        })),
    )
    if (rects.length === 0) return
    const text = fixSelectionText(selection.toString())
    const highlight: Highlight = {
      id: "",
      page,
      position: {
        bounding: viewportToScaled(boundingRect(rects), viewport),
        rects: rects.map((rect) => viewportToScaled(rect, viewport)),
        page,
      },
      content: { text },
      properties: {},
    }
    setTimeout(() => this.openMenu(highlight, point, true, text))
  }

  startArea(event: MouseEvent): boolean {
    const target = event.target
    if (!(target instanceof Element)) return false
    if (target.closest(".seqno-pdf-area-region") !== null) return false
    const pageElement = target.closest(".page")
    const container = this.container
    if (!(pageElement instanceof HTMLElement) || container === null) return false
    if (!(event.metaKey || event.shiftKey || this.registry.get(areaMode))) return false
    event.preventDefault()
    const page = Number(pageElement.dataset["pageNumber"])
    const start = { x: event.clientX, y: event.clientY }
    const clamp = (point: Point) => {
      const box = pageElement.getBoundingClientRect()
      return {
        x: Math.min(Math.max(point.x, box.left), box.right),
        y: Math.min(Math.max(point.y, box.top), box.bottom),
      }
    }
    const inContainer = (box: Box): Box => {
      const frame = container.getBoundingClientRect()
      return {
        ...box,
        left: box.left - frame.left + container.scrollLeft,
        top: box.top - frame.top + container.scrollTop,
      }
    }
    const viewerElement = this.viewer?.viewer
    viewerElement?.classList.add("is-picking-area")
    const move = (moved: MouseEvent) =>
      this.set({
        area: inContainer(boxBetween(start, clamp({ x: moved.clientX, y: moved.clientY }))),
      })
    const end = (ended: MouseEvent) => {
      container.removeEventListener("mousemove", move)
      viewerElement?.classList.remove("is-picking-area")
      this.set({ area: null })
      const box = boxBetween(start, clamp({ x: ended.clientX, y: ended.clientY }))
      const pageBox = pageElement.getBoundingClientRect()
      const viewport = this.viewportOf(page)
      if (box.width <= 10 || box.height <= 10 || viewport === undefined) return
      const local = { ...box, left: box.left - pageBox.left, top: box.top - pageBox.top }
      const highlight: Highlight = {
        id: "",
        page,
        position: { bounding: viewportToScaled(local, viewport), rects: [], page },
        content: { text: "[:span]", image: Date.now() },
        properties: {},
      }
      this.registry.set(areaMode, false)
      this.openMenu(highlight, { x: ended.clientX, y: ended.clientY }, true, null)
    }
    container.addEventListener("mousemove", move)
    document.addEventListener("mouseup", end, { once: true })
    return true
  }

  resize(highlight: Highlight, box: Box | null) {
    this.set({ resizing: box === null ? null : { id: highlight.id, box } })
  }

  finishResize(highlight: Highlight, box: Box) {
    const viewport = this.viewportOf(highlight.page)
    this.set({ resizing: null })
    if (viewport === undefined) return
    const resized: Highlight = {
      ...highlight,
      position: { ...highlight.position, bounding: viewportToScaled(box, viewport) },
      content: { ...highlight.content, image: Date.now() },
    }
    this.captureArea(resized, highlight)
    this.replace(resized)
    this.runCore(updateRefBlock(resized, Date.now()))
  }

  private captureArea(highlight: Highlight, previous: Highlight | null) {
    const view = this.pageView(highlight.page)
    const canvas = view?.div.querySelector("canvas")
    const stamp = highlight.content.image
    if (view === undefined || !(canvas instanceof HTMLCanvasElement) || stamp === undefined) return
    const box = scaledToViewport(highlight.position.bounding, view.viewport)
    const ratio = canvas.width / view.viewport.width
    const dpr = window.devicePixelRatio
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(box.width * dpr))
    out.height = Math.max(1, Math.round(box.height * dpr))
    const context = out.getContext("2d", { alpha: false })
    if (context === null) return
    context.imageSmoothingEnabled = false
    context.drawImage(
      canvas,
      box.left * ratio,
      box.top * ratio,
      box.width * ratio,
      box.height * ratio,
      0,
      0,
      out.width,
      out.height,
    )
    out.toBlob((png) => {
      if (png === null) return
      const path = areaImagePath(this.asset.key, highlight.page, highlight.id, stamp)
      const old =
        previous?.content.image === undefined
          ? null
          : areaImagePath(this.asset.key, previous.page, previous.id, previous.content.image)
      this.host
        .writeAsset(path, png)
        .then(() => (old !== null && old !== path ? this.host.removeAsset(old) : undefined))
        .catch((cause: unknown) => this.host.notify(`Couldn't save ${path}: ${messageOf(cause)}`))
    }, "image/png")
  }
}

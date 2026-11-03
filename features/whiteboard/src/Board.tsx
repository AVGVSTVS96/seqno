import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconChalkboard, IconPlus } from "@tabler/icons-react"
import { Exit, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  normalizePageName,
  portalTarget,
  portalText,
  shapeRaw,
  whiteboardProps,
  type BlockId,
  type Command,
  type GraphEvent,
  type Page,
  type Vec,
} from "@seqno/domain"
import { dispatchAllAtom, editRequest, historyAtom, pageTreeAtom } from "@seqno/outliner"
import type { PageTree } from "@seqno/rpc"
import boardCss from "./board.css?inline"
import { create, editText, patch, remove, reorder, type Raw } from "./commands.ts"
import { ContextBar } from "./ContextBar.tsx"
import {
  add,
  boundsOfPoints,
  center,
  clampZoom,
  fitBounds,
  origin,
  panBy,
  round,
  snapToGrid,
  sub,
  toScreen,
  toWorld,
  union,
  zoomAt,
  type Bounds,
  type Camera,
  type Viewport,
} from "./geometry.ts"
import {
  DRAG_THRESHOLD,
  bindTarget,
  brushOf,
  brushed,
  changesOf,
  erasedAt,
  idle,
  selectionBounds,
  type Gesture,
  type ResizeHandle,
} from "./gestures.ts"
import {
  isLocked,
  itemsOf,
  sceneOf,
  topHit,
  type Item,
  type Measured,
  type Scene,
} from "./model.ts"
import type { OutlinerEnv } from "./Portal.tsx"
import { applyLocally } from "./preview.ts"
import { QuickSearch, type Pick } from "./QuickSearch.tsx"
import { ShapeView, type ShapeSlots } from "./ShapeView.tsx"
import { ActionBar, PrimaryTools, type ZoomAction } from "./Toolbar.tsx"
import {
  DEFAULT_SIZE,
  PORTAL_WIDTH,
  defaultStyles,
  newShape,
  type ShapeTool,
  type Styles,
  type Tool,
} from "./tools.ts"

export const BoardStyle = () => (
  <style href="seqno/whiteboard" precedence="app">
    {boardCss}
  </style>
)

export interface BoardProps {
  readonly page: Page
  readonly focus: BlockId | null
  readonly outliner: OutlinerEnv
  readonly resolveAsset: (path: string) => string | undefined
  readonly openPage: (name: string, sidebar: boolean) => void
  readonly onRenamed: (name: string) => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUntitled = (page: Page) => UUID.test(page.title)

export const boardTitle = (page: Page) => (isUntitled(page) ? "Untitled" : page.title)

interface Pending {
  readonly base: PageTree
  readonly commands: ReadonlyArray<Command>
}

interface Press {
  readonly at: Vec
  readonly moved: boolean
  readonly hit: BlockId | null
  readonly shift: boolean
}

const SHAPE_KEYS: Record<string, Tool> = {
  "1": "select",
  "2": "move",
  "3": "portal",
  "4": "pencil",
  "5": "highlighter",
  "6": "eraser",
  "7": "line",
  "8": "text",
  "9": "box",
  o: "ellipse",
}

const CHORD_KEYS: Record<string, Tool> = {
  s: "select",
  p: "move",
  b: "portal",
  d: "pencil",
  h: "highlighter",
  e: "eraser",
  c: "line",
  t: "text",
  r: "box",
  o: "ellipse",
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]") !== null)

const insideLivePortal = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-live="true"] .wb-portal-body') !== null

const handleOf = (target: EventTarget | null) => {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-handle]") : null
  return element?.dataset["handle"] ?? null
}

const RESIZE_HANDLES: ReadonlyArray<ResizeHandle> = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
  "top",
  "right",
  "bottom",
  "left",
]

const resizeHandleOf = (name: string | null) => RESIZE_HANDLES.find((handle) => handle === name)

const createdIds = (events: ReadonlyArray<GraphEvent>) =>
  events.flatMap((event) => (event._tag === "BlockUpserted" ? [event.block.id] : []))

const initialCamera = (scene: Scene, viewport: Viewport, focus: BlockId | null): Camera => {
  const focused = focus === null ? undefined : scene.bounds.get(focus)
  if (focused !== undefined) return fitBounds(focused, viewport, 1)
  const drawing = union([...scene.bounds.values()])
  if (drawing === null) return origin
  const visible = toWorld(origin, [viewport.width, viewport.height])
  const onScreen =
    drawing.minX < visible[0] && drawing.minY < visible[1] && drawing.maxX > 0 && drawing.maxY > 0
  return onScreen ? origin : fitBounds(drawing, viewport, 1)
}

const isEditableShape = (item: Item) =>
  item.shape.type === "text" ||
  item.shape.type === "box" ||
  item.shape.type === "ellipse" ||
  item.shape.type === "polygon" ||
  item.shape.type === "line"

const TitleChip = ({
  page,
  onRename,
}: {
  readonly page: Page
  readonly onRename: (title: string) => void
}) => {
  const commit = (input: HTMLInputElement) => {
    const title = input.value.trim()
    if (title === "" || title === boardTitle(page) || (isUntitled(page) && title === "")) {
      input.value = isUntitled(page) ? "" : page.title
      return
    }
    onRename(title)
  }
  return (
    <div className="wb-title" onPointerDown={(event) => event.stopPropagation()}>
      <IconChalkboard size={20} aria-hidden />
      <input
        key={page.title}
        className="wb-title-input"
        aria-label="Whiteboard title"
        placeholder="Untitled"
        defaultValue={isUntitled(page) ? "" : page.title}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            event.currentTarget.value = isUntitled(page) ? "" : page.title
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

const Canvas = ({ tree, ...props }: BoardProps & { readonly tree: PageTree }) => {
  const { page, focus } = props
  const run = useAtomSet(dispatchAllAtom, { mode: "promiseExit" })
  const history = useAtomSet(historyAtom)
  const requestEdit = useAtomSet(editRequest)
  const root = useRef<HTMLDivElement | null>(null)
  const press = useRef<Press | null>(null)
  const [camera, setCamera] = useState<Camera | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })
  const [tool, setTool] = useState<Tool>("select")
  const [geometry, setGeometry] = useState<ShapeTool>("box")
  const [selected, setSelected] = useState<ReadonlyArray<BlockId>>(focus === null ? [] : [focus])
  const [gesture, setGesture] = useState<Gesture>(idle)
  const [editing, setEditing] = useState<BlockId | null>(null)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [styles, setStyles] = useState<Styles>(defaultStyles)
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [measured, setMeasured] = useState<Measured>(() => new Map())
  const [searchAt, setSearchAt] = useState<Vec | null>(null)
  const [spacePan, setSpacePan] = useState(false)
  const [chord, setChord] = useState<string | null>(null)
  const [hover, setHover] = useState<BlockId | null>(null)

  const blocks =
    pending !== null && pending.base === tree
      ? applyLocally(tree.blocks, pending.commands)
      : tree.blocks
  const scene = sceneOf(itemsOf(blocks), measured)
  const cam = camera ?? origin
  const live =
    gesture._tag === "Erasing" || gesture._tag === "Brushing"
      ? []
      : changesOf(page.id, scene, gesture, styles)
  const shown = live.length === 0 ? scene : sceneOf(itemsOf(applyLocally(blocks, live)), measured)
  const exists = (id: BlockId) => scene.byId.has(id)
  const selection = gesture._tag === "Brushing" ? brushed(scene, gesture) : selected.filter(exists)
  const selectedItems = selection.flatMap((id) => shown.byId.get(id) ?? [])
  const erasing = gesture._tag === "Erasing" ? new Set(gesture.ids) : new Set<BlockId>()

  const commit = (commands: ReadonlyArray<Command>) => {
    if (commands.length === 0) return Promise.resolve<ReadonlyArray<GraphEvent>>([])
    setPending({ base: tree, commands })
    return run(commands).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value
      setPending(null)
      return []
    })
  }

  const screenOf = (event: { readonly clientX: number; readonly clientY: number }): Vec => {
    const rect = root.current?.getBoundingClientRect()
    return rect === undefined ? [0, 0] : [event.clientX - rect.left, event.clientY - rect.top]
  }
  const snapped = (point: Vec): Vec => (snap ? [snapToGrid(point[0]), snapToGrid(point[1])] : point)

  const setZoom = (action: ZoomAction) => {
    const at = center(viewport)
    switch (action) {
      case "in":
        return setCamera(zoomAt(cam, at, cam.zoom * 1.25))
      case "out":
        return setCamera(zoomAt(cam, at, cam.zoom * 0.8))
      case "reset":
        return setCamera(zoomAt(cam, at, 1))
      case "drawing": {
        const drawing = union([...scene.bounds.values()])
        return setCamera(drawing === null ? origin : fitBounds(drawing, viewport, 1))
      }
      case "selection": {
        const box = selectionBounds(scene, selection)
        if (box !== null) setCamera(fitBounds(box, viewport, cam.zoom > 1 ? cam.zoom : 1))
      }
    }
  }

  const startEditing = (id: BlockId) => {
    const item = scene.byId.get(id)
    if (item === undefined || isLocked(item) || !isEditableShape(item)) return false
    setSelected([id])
    setEditing(id)
    setDraft(item.block.text)
    return true
  }

  const finishEditing = () => {
    const id = editing
    setEditing(null)
    root.current?.focus()
    if (id === null) return
    const item = scene.byId.get(id)
    if (item === undefined) return
    if (item.shape.type === "text" && draft.trim() === "") {
      void commit(remove(scene, [id]))
      return
    }
    const text = editText(id, item.block.text, draft)
    const seen = measured.get(id)
    const sized =
      item.shape.type === "text" && item.shape.isAutoResizing !== false && seen !== undefined
        ? [patch(item, { size: [round(seen[0]), round(seen[1])] })]
        : []
    void commit([...(text === null ? [] : [text]), ...sized])
  }

  const patchSelection = (change: (item: Item) => Raw) =>
    void commit(
      selectedItems
        .filter((item) => !isLocked(item))
        .flatMap((item) => {
          const original = scene.byId.get(item.block.id)
          return original === undefined ? [] : [patch(original, change(original))]
        }),
    )

  const deleteSelection = () => {
    const ids = selection.filter((id) => {
      const item = scene.byId.get(id)
      return item !== undefined && !isLocked(item)
    })
    setSelected([])
    void commit(remove(scene, ids))
  }

  const placeShape = (raw: Raw, text: string) => {
    const made = create(page.id, scene, [{ raw, text }])
    return made === null ? Promise.resolve([]) : commit([made])
  }

  const portalRaw = (point: Vec, blockType: "P" | "B") =>
    newShape("logseq-portal", snapped(point), [PORTAL_WIDTH, 320], styles, {
      blockType,
      compact: blockType === "B",
      isAutoResizing: true,
      scaleLevel: styles.scaleLevel,
      fill: styles.color,
      stroke: styles.color,
    })

  const selectCreated = (events: ReadonlyArray<GraphEvent>) => {
    const ids = createdIds(events)
    if (ids.length > 0) setSelected(ids.slice(-1))
    return ids
  }

  const newBlockPortal = (point: Vec, text: string) => {
    const after = scene.items.at(-1)?.block.id
    const made: Command = {
      _tag: "InsertBlocks",
      pageId: page.id,
      parentId: null,
      ...(after === undefined ? {} : { after }),
      blocks: [{ text, props: {}, children: [] }],
    }
    void commit([made]).then((events) => {
      const blockId = createdIds(events)[0]
      if (blockId === undefined) return
      void placeShape(portalRaw(point, "B"), portalText({ _tag: "BlockPortal", uuid: blockId }))
        .then(selectCreated)
        .then(() => requestEdit({ blockId, caret: text.length }))
    })
  }

  const pick = (point: Vec, choice: Pick) => {
    setSearchAt(null)
    root.current?.focus()
    const pagePortal = (title: string) => ({
      raw: portalRaw(point, "P"),
      text: portalText({ _tag: "PagePortal", name: title }),
    })
    switch (choice._tag) {
      case "NewBlock":
        return newBlockPortal(point, choice.text)
      case "Page": {
        const { raw, text } = pagePortal(choice.page.title)
        return void placeShape(raw, text).then(selectCreated)
      }
      case "Block":
        return void placeShape(
          portalRaw(point, "B"),
          portalText({ _tag: "BlockPortal", uuid: choice.block.id }),
        ).then(selectCreated)
      case "NewPage":
      case "NewWhiteboard": {
        const { raw, text } = pagePortal(choice.title)
        const made = create(page.id, scene, [{ raw, text }])
        const createPage: Command =
          choice._tag === "NewPage"
            ? { _tag: "CreatePage", title: choice.title }
            : { _tag: "CreatePage", title: choice.title, props: whiteboardProps }
        return void commit(made === null ? [createPage] : [createPage, made]).then(selectCreated)
      }
    }
  }

  const finishGesture = () => {
    const done = gesture
    setGesture(idle)
    const pressed = press.current
    press.current = null
    switch (done._tag) {
      case "Brushing":
        setSelected(brushed(scene, done))
        return
      case "Creating": {
        const box = boundsOfPoints([done.from, done.to])
        const tiny = box.maxX - box.minX < DRAG_THRESHOLD && box.maxY - box.minY < DRAG_THRESHOLD
        const commands = tiny
          ? [
              create(page.id, scene, [
                {
                  raw: newShape(
                    done.tool,
                    snapped(sub(done.from, [DEFAULT_SIZE[0] / 2, DEFAULT_SIZE[1] / 2])),
                    DEFAULT_SIZE,
                    styles,
                  ),
                  text: "",
                },
              ]),
            ].flatMap((command) => (command === null ? [] : [command]))
          : changesOf(page.id, scene, done, styles)
        setTool("select")
        void commit(commands).then(selectCreated)
        return
      }
      case "Connecting": {
        const span = Math.hypot(done.to[0] - done.from[0], done.to[1] - done.from[1])
        setTool("select")
        if (span < DRAG_THRESHOLD) return
        void commit(changesOf(page.id, scene, done, styles)).then(selectCreated)
        return
      }
      case "Translating":
        if (pressed !== null && !pressed.moved && !pressed.shift && pressed.hit !== null) {
          setSelected([pressed.hit])
        }
        void commit(changesOf(page.id, scene, done, styles))
        return
      case "Idle":
      case "Panning":
        return
      default:
        void commit(changesOf(page.id, scene, done, styles))
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2 || insideLivePortal(event.target)) return
    if (editing !== null) finishEditing()
    if (searchAt !== null) setSearchAt(null)
    const at = screenOf(event)
    const world = toWorld(cam, at)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    root.current?.focus()
    if (event.button === 1 || spacePan || tool === "move") {
      setGesture({ _tag: "Panning", last: at })
      return
    }
    const handle = handleOf(event.target)
    const resize = resizeHandleOf(handle)
    if (resize !== undefined) {
      const box = selectionBounds(scene, selection)
      if (box !== null) {
        setGesture({
          _tag: "Resizing",
          handle: resize,
          from: box,
          to: world,
          ids: selection,
          keepRatio: event.shiftKey,
        })
      }
      return
    }
    if (handle === "start" || handle === "end") {
      const line = selection[0]
      if (line !== undefined)
        setGesture({ _tag: "MovingEnd", line, end: handle, to: world, bind: null })
      return
    }
    switch (tool) {
      case "select": {
        const hit = event.ctrlKey ? null : topHit(scene, world, cam.zoom)
        press.current = { at, moved: false, hit: hit?.block.id ?? null, shift: event.shiftKey }
        if (hit === null) {
          if (!event.shiftKey) setSelected([])
          setGesture({
            _tag: "Brushing",
            from: world,
            to: world,
            keep: event.shiftKey ? selection : [],
          })
          return
        }
        const id = hit.block.id
        const already = selection.includes(id)
        const next = event.shiftKey
          ? already
            ? selection.filter((other) => other !== id)
            : [...selection, id]
          : already
            ? selection
            : [id]
        setSelected(next)
        setGesture({ _tag: "Translating", from: world, to: world, ids: next, snap })
        return
      }
      case "box":
      case "ellipse":
      case "polygon":
        setGesture({ _tag: "Creating", tool, from: snapped(world), to: snapped(world) })
        return
      case "line": {
        const start =
          event.metaKey || event.ctrlKey ? null : bindTarget(scene, world, cam.zoom, null)
        setGesture({
          _tag: "Connecting",
          from: world,
          to: world,
          start: start?.block.id ?? null,
          end: null,
        })
        return
      }
      case "pencil":
      case "highlighter":
        setGesture({ _tag: "Drawing", tool, points: [world] })
        return
      case "eraser":
        setGesture({ _tag: "Erasing", ids: erasedAt(scene, world, cam.zoom), last: world })
        return
      case "text": {
        setTool("select")
        void placeShape(newShape("text", snapped(world), [0, 0], styles, {}), "").then((events) => {
          const id = createdIds(events)[0]
          if (id === undefined) return
          setSelected([id])
          setEditing(id)
          setDraft("")
        })
        return
      }
      case "portal":
        setTool("select")
        setSearchAt(world)
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = screenOf(event)
    const world = toWorld(cam, at)
    if (gesture._tag === "Idle") {
      if (tool === "select" && !insideLivePortal(event.target)) {
        const hit = topHit(scene, world, cam.zoom)?.block.id ?? null
        if (hit !== hover) setHover(hit)
      }
      return
    }
    const pressed = press.current
    if (pressed !== null && !pressed.moved) {
      if (Math.hypot(at[0] - pressed.at[0], at[1] - pressed.at[1]) <= DRAG_THRESHOLD) return
      press.current = { ...pressed, moved: true }
    }
    switch (gesture._tag) {
      case "Panning":
        setCamera(panBy(cam, sub(at, gesture.last)))
        setGesture({ ...gesture, last: at })
        return
      case "Brushing":
        setGesture({ ...gesture, to: world })
        return
      case "Translating": {
        const box = selectionBounds(scene, gesture.ids)
        const raw = sub(world, gesture.from)
        const locked: Vec = event.shiftKey
          ? Math.abs(raw[0]) > Math.abs(raw[1])
            ? [raw[0], 0]
            : [0, raw[1]]
          : raw
        const delta =
          box === null || !snap
            ? locked
            : sub(snapped(add([box.minX, box.minY], locked)), [box.minX, box.minY])
        setGesture({ ...gesture, to: add(gesture.from, delta) })
        return
      }
      case "Resizing":
        setGesture({
          ...gesture,
          to: snap && !event.shiftKey ? snapped(world) : world,
          keepRatio: event.shiftKey,
        })
        return
      case "Creating":
        setGesture({ ...gesture, to: snapped(world) })
        return
      case "Connecting": {
        const end =
          event.metaKey || event.ctrlKey ? null : bindTarget(scene, world, cam.zoom, gesture.start)
        setGesture({ ...gesture, to: world, end: end?.block.id ?? null })
        return
      }
      case "MovingEnd": {
        const bind =
          event.metaKey || event.ctrlKey ? null : bindTarget(scene, world, cam.zoom, gesture.line)
        setGesture({ ...gesture, to: world, bind: bind?.block.id ?? null })
        return
      }
      case "Drawing":
        setGesture({ ...gesture, points: [...gesture.points, world] })
        return
      case "Erasing": {
        const hits = erasedAt(scene, world, cam.zoom)
        setGesture({ ...gesture, ids: [...new Set([...gesture.ids, ...hits])], last: world })
      }
    }
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (insideLivePortal(event.target) || tool !== "select") return
    const world = toWorld(cam, screenOf(event))
    const hit = topHit(scene, world, cam.zoom)
    if (hit === null) {
      setSelected([])
      setSearchAt(world)
      return
    }
    if (!startEditing(hit.block.id)) setSelected([hit.block.id])
  }

  const zoomKeys: Record<string, ZoomAction> = {
    ")": "reset",
    "0": "reset",
    "!": "drawing",
    "1": "drawing",
    "@": "selection",
    "2": "selection",
    "+": "in",
    "=": "in",
    _: "out",
    "-": "out",
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target)) return
    const mod = event.metaKey || event.ctrlKey
    const handled = () => event.preventDefault()
    const key = event.key
    if (key === " ") {
      handled()
      setSpacePan(true)
      return
    }
    if (key === "Escape") {
      handled()
      setChord(null)
      if (gesture._tag !== "Idle") {
        setGesture(idle)
        press.current = null
      } else if (tool !== "select") setTool("select")
      else setSelected([])
      return
    }
    if (key === "Backspace" || key === "Delete") {
      handled()
      deleteSelection()
      return
    }
    if (key === "Enter") {
      const only = selection.length === 1 ? selection[0] : undefined
      if (only !== undefined && startEditing(only)) handled()
      return
    }
    if (mod) {
      const lower = key.toLowerCase()
      if (lower === "a") {
        handled()
        setSelected(scene.items.map((item) => item.block.id))
      } else if (lower === "l") {
        handled()
        patchSelectionAll({ isLocked: !event.shiftKey })
      } else if (key === "ArrowUp" || key === "ArrowDown") {
        handled()
        const collapse = key === "ArrowUp"
        patchSelection((item) =>
          item.shape.type !== "logseq-portal"
            ? {}
            : item.shape.blockType === "B"
              ? { compact: collapse }
              : { collapsed: collapse },
        )
      }
      return
    }
    if (event.shiftKey) {
      const zoom = zoomKeys[key]
      if (zoom !== undefined) {
        handled()
        setZoom(zoom)
        return
      }
    }
    if (key === "[" || key === "]" || key === "{" || key === "}") {
      handled()
      const order =
        key === "{" ? "back" : key === "}" ? "front" : key === "[" ? "backward" : "forward"
      const command = reorder(scene, selection, order)
      if (command !== null) void commit([command])
      return
    }
    if (event.altKey || event.shiftKey) return
    const lower = key.toLowerCase()
    if (chord === "w") {
      setChord(null)
      const chosen = CHORD_KEYS[lower]
      if (chosen !== undefined) {
        handled()
        chooseTool(chosen)
      }
      return
    }
    if (chord === "t") {
      setChord(null)
      if (lower === "g") {
        handled()
        setGrid(!grid)
      }
      return
    }
    if (chord !== null) {
      setChord(null)
      return
    }
    if (lower === "g" || lower === "n") {
      setChord(lower)
      return
    }
    if (lower === "w" || lower === "t") {
      setChord(lower)
      if (lower === "w") handled()
      return
    }
    const chosen = SHAPE_KEYS[lower]
    if (chosen !== undefined) {
      handled()
      chooseTool(chosen)
    }
  }

  const patchSelectionAll = (change: Raw) =>
    void commit(
      selection.flatMap((id) => {
        const item = scene.byId.get(id)
        return item === undefined ? [] : [patch(item, change)]
      }),
    )

  const chooseTool = (next: Tool) => {
    if (next === "box" || next === "ellipse" || next === "polygon") setGeometry(next)
    setTool(next)
    setSearchAt(null)
    if (next !== "select") setSelected([])
  }

  const [attach] = useState(() => (node: HTMLDivElement | null) => {
    root.current = node
    if (node === null) return
    node.focus({ preventScroll: true })
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const next = { width: entry.contentRect.width, height: entry.contentRect.height }
      setViewport(next)
      setCamera((current) => current ?? initialCamera(scene, next, focus))
    })
    observer.observe(node)
    const onWheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".wb-search, .wb-popover") !== null
      )
        return
      if (insideLivePortal(event.target) && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const at: Vec = [event.clientX - rect.left, event.clientY - rect.top]
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const step = Math.max(-10, Math.min(10, event.deltaY)) / 100
        setCamera((current) => {
          const now = current ?? origin
          return zoomAt(now, at, clampZoom(now.zoom - step * now.zoom))
        })
        return
      }
      const dx =
        event.shiftKey && !navigator.userAgent.includes("Mac") ? event.deltaY : event.deltaX
      const dy = event.shiftKey && !navigator.userAgent.includes("Mac") ? 0 : event.deltaY
      setCamera((current) => panBy(current ?? origin, [-dx, -dy]))
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      observer.disconnect()
      node.removeEventListener("wheel", onWheel)
    }
  })

  const [measure] = useState(() => {
    const made = new Map<BlockId, (node: HTMLElement | null) => (() => void) | undefined>()
    const measuring = (blockId: BlockId) => (node: HTMLElement | null) => {
      if (node === null) return
      const observer = new ResizeObserver(() => {
        const size: Vec = [node.offsetWidth, node.offsetHeight]
        setMeasured((current) => {
          const now = current.get(blockId)
          if (now !== undefined && now[0] === size[0] && now[1] === size[1]) return current
          return new Map(current).set(blockId, size)
        })
      })
      observer.observe(node)
      return () => observer.disconnect()
    }
    return (blockId: BlockId) => {
      const known = made.get(blockId)
      if (known !== undefined) return known
      const next = measuring(blockId)
      made.set(blockId, next)
      return next
    }
  })

  const selectedTargets = new Set(
    selectedItems.flatMap((item) =>
      item.shape.type === "logseq-portal" ? [item.block.text.trim().toLowerCase()] : [],
    ),
  )
  const bindingTo =
    gesture._tag === "Connecting" ? gesture.end : gesture._tag === "MovingEnd" ? gesture.bind : null

  const slots: ShapeSlots = {
    asset: props.resolveAsset,
    measure,
    editing:
      editing === null ? null : { id: editing, draft, onDraft: setDraft, onFinish: finishEditing },
    portals: {
      env: { outliner: props.outliner, openPage: props.openPage },
      selected: selection,
      dimmed: selectedTargets,
      binding: bindingTo,
    },
  }

  const toBox = (box: Bounds) => {
    const [left, top] = toScreen(cam, [box.minX, box.minY])
    const [right, bottom] = toScreen(cam, [box.maxX, box.maxY])
    return { left, top, width: right - left, height: bottom - top }
  }

  const single = selectedItems.length === 1 ? selectedItems[0] : undefined
  const selectedBox = selectionBounds(shown, selection)
  const quiet = gesture._tag === "Idle" && editing === null
  const brush = brushOf(gesture)
  const bound = bindingTo === null ? undefined : shown.bounds.get(bindingTo)
  const cursor =
    gesture._tag === "Panning"
      ? "grabbing"
      : spacePan || tool === "move"
        ? "grab"
        : gesture._tag === "Translating" &&
            (gesture.to[0] !== gesture.from[0] || gesture.to[1] !== gesture.from[1])
          ? "move"
          : tool === "select"
            ? "default"
            : "crosshair"
  const fine = Math.max(0, Math.min(1, (cam.zoom - 0.5) / 1.5))
  const contextAt = (() => {
    if (selectedBox === null) return null
    const box = toBox(selectedBox)
    const above = box.top - 18 - 44
    const top = above < 16 + 100 - 18 ? box.top + box.height + 18 : above
    const left = Math.max(16 + 150, Math.min(viewport.width - 16 - 150, box.left + box.width / 2))
    return { left, top: Math.min(top, viewport.height - 140) }
  })()

  const overlay: ReactNode[] = []
  if (hover !== null && !selection.includes(hover) && quiet) {
    const box = shown.bounds.get(hover)
    if (box !== undefined) {
      overlay.push(<div key="hover" className="wb-outline" data-hover style={toBox(box)} />)
    }
  }
  for (const item of selectedItems) {
    const box = shown.bounds.get(item.block.id)
    if (box !== undefined && item.shape.type !== "line") {
      overlay.push(
        <div
          key={`outline-${item.block.id}`}
          className="wb-outline"
          data-locked={isLocked(item)}
          style={toBox(box)}
        />,
      )
    }
  }
  if (selectedBox !== null && selectedItems.length > 1) {
    overlay.push(
      <div key="selection" className="wb-outline wb-selection" style={toBox(selectedBox)} />,
    )
  }
  if (
    single !== undefined &&
    !isLocked(single) &&
    editing === null &&
    gesture._tag !== "Translating"
  ) {
    const box = shown.bounds.get(single.block.id)
    if (single.shape.type === "line") {
      const ends = shown.ends.get(single.block.id)
      if (ends !== undefined) {
        ends.forEach((end, index) => {
          const [left, top] = toScreen(cam, end)
          overlay.push(
            <div
              key={`end-${index}`}
              className="wb-handle"
              data-kind="end"
              data-handle={index === 0 ? "start" : "end"}
              style={{ left, top }}
            />,
          )
        })
      }
    } else if (box !== undefined) {
      const { left, top, width, height } = toBox(box)
      const corners: ReadonlyArray<readonly [ResizeHandle, number, number]> = [
        ["top-left", left, top],
        ["top-right", left + width, top],
        ["bottom-right", left + width, top + height],
        ["bottom-left", left, top + height],
      ]
      overlay.push(
        <div
          key="edge-top"
          className="wb-handle"
          data-kind="edge"
          data-handle="top"
          style={{ left, top: top - 6, width, height: 12 }}
        />,
        <div
          key="edge-bottom"
          className="wb-handle"
          data-kind="edge"
          data-handle="bottom"
          style={{ left, top: top + height - 6, width, height: 12 }}
        />,
        <div
          key="edge-left"
          className="wb-handle"
          data-kind="edge"
          data-handle="left"
          style={{ left: left - 6, top, width: 12, height }}
        />,
        <div
          key="edge-right"
          className="wb-handle"
          data-kind="edge"
          data-handle="right"
          style={{ left: left + width - 6, top, width: 12, height }}
        />,
        ...corners.map(([name, x, y]) => (
          <div
            key={name}
            className="wb-handle"
            data-kind="corner"
            data-handle={name}
            style={{ left: x, top: y }}
          />
        )),
      )
      if (
        single.shape.type === "box" ||
        single.shape.type === "ellipse" ||
        single.shape.type === "polygon"
      ) {
        const clones: ReadonlyArray<readonly [string, number, number, Vec]> = [
          ["left", left - 30 - 16, top + height / 2, [-1, 0]],
          ["right", left + width + 30 + 16, top + height / 2, [1, 0]],
          ["bottom", left + width / 2, top + height + 30 + 16, [0, 1]],
        ]
        overlay.push(
          ...clones.map(([name, x, y, direction]) => (
            <button
              key={`clone-${name}`}
              type="button"
              className="wb-handle"
              data-kind="clone"
              aria-label={`Clone ${name}`}
              style={{ left: x, top: y }}
              onPointerDown={(event) => {
                event.stopPropagation()
                cloneTo(single, direction)
              }}
            >
              <IconPlus size={16} aria-hidden />
            </button>
          )),
        )
      }
    }
  }
  if (brush !== null) overlay.push(<div key="brush" className="wb-brush" style={toBox(brush)} />)
  const boundItem = bindingTo === null ? undefined : scene.byId.get(bindingTo)
  if (bound !== undefined && boundItem?.shape.type !== "logseq-portal") {
    overlay.push(<div key="bind" className="wb-bind" style={toBox(bound)} />)
  }

  const cloneTo = (item: Item, [dx, dy]: Vec) => {
    if (item.shape.type !== "box" && item.shape.type !== "ellipse" && item.shape.type !== "polygon")
      return
    const [width, height] = item.shape.size
    const point: Vec = [
      item.shape.point[0] + dx * (width + 100),
      item.shape.point[1] + dy * (height + 100),
    ]
    const raw = Object.fromEntries(
      Object.entries({ ...shapeRaw(item.block), point }).filter(([key]) => key !== "refs"),
    )
    const made = create(page.id, scene, [{ raw, text: "" }])
    if (made === null) return
    void commit([made]).then((events) => {
      const id = createdIds(events)[0]
      if (id === undefined) return
      const line = create(page.id, sceneOf(itemsOf(blocks), measured), [
        {
          raw: newShape("line", [0, 0], [0, 0], styles, {
            handles: {
              start: { point: [0, 0], bindTo: item.block.id },
              end: { point: [1, 1], bindTo: id },
            },
          }),
          text: "",
        },
      ])
      void commit(line === null ? [] : [line]).then(() => {
        setSelected([id])
        setEditing(id)
        setDraft("")
      })
    })
  }

  const onCopy = (event: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target) || selection.length === 0)
      return
    event.preventDefault()
    event.clipboardData.setData(
      "text/plain",
      selection.map((id) => portalText({ _tag: "BlockPortal", uuid: id })).join(" "),
    )
    if (cut) deleteSelection()
  }

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target)) return
    const text = event.clipboardData.getData("text/plain").trim()
    if (text === "") return
    event.preventDefault()
    const at = toWorld(cam, center(viewport))
    const point: Vec = [at[0] - PORTAL_WIDTH / 2, at[1]]
    const refs = text.split(/\s+/).map(portalTarget)
    const copied = refs.every(Option.isSome)
      ? refs.flatMap((target) =>
          Option.isSome(target) && target.value._tag === "BlockPortal" ? [target.value.uuid] : [],
        )
      : []
    const shapes = copied.flatMap(
      (uuid) => scene.items.find((item) => item.block.id === uuid) ?? [],
    )
    if (shapes.length > 0 && shapes.length === refs.length) {
      const drafts = shapes.map((item) => ({
        raw: { ...shapeRaw(item.block), point: add(item.shape.point, [24, 24]) },
        text: item.block.text,
      }))
      const made = create(page.id, scene, drafts)
      if (made !== null) void commit([made]).then((events) => setSelected(createdIds(events)))
      return
    }
    const target = portalTarget(text)
    if (Option.isSome(target)) {
      void placeShape(portalRaw(point, target.value._tag === "PagePortal" ? "P" : "B"), text).then(
        selectCreated,
      )
      return
    }
    newBlockPortal(point, text)
  }

  const gridSize = 8 * cam.zoom
  const [gridX, gridY] = toScreen(cam, [0, 0])
  const searchScreen = searchAt === null ? null : toScreen(cam, searchAt)
  const gridVars: CSSProperties = {
    "--wb-fine-size": `${gridSize}px`,
    "--wb-coarse-size": `${gridSize * 4}px`,
    "--wb-fine": `${Math.round(fine * 100)}%`,
    "--wb-grid-x": `${gridX - gridSize / 2}px`,
    "--wb-grid-y": `${gridY - gridSize / 2}px`,
  }

  return (
    <div
      ref={attach}
      className="wb-root"
      role="application"
      aria-label={`Whiteboard ${boardTitle(page)}`}
      tabIndex={0}
      data-grid={grid}
      data-cursor={cursor}
      data-tool={tool}
      style={gridVars}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={() => {
        setGesture(idle)
        press.current = null
      }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") setSpacePan(false)
      }}
      onCopy={(event) => onCopy(event, false)}
      onCut={(event) => onCopy(event, true)}
      onPaste={onPaste}
      onContextMenu={(event) => {
        if (!insideLivePortal(event.target)) event.preventDefault()
      }}
    >
      <div
        className="wb-world"
        style={{ transform: `scale(${cam.zoom}) translate(${cam.x}px, ${cam.y}px)` }}
      >
        {shown.items.map((item) => (
          <ShapeView
            key={item.block.id}
            item={item}
            scene={shown}
            slots={slots}
            erasing={erasing.has(item.block.id)}
          />
        ))}
      </div>
      <div className="wb-overlay">{overlay}</div>
      {quiet && contextAt !== null ? (
        <ContextBar
          items={selectedItems.filter((item) => !isLocked(item))}
          left={contextAt.left}
          top={contextAt.top}
          onPatch={patchSelection}
        />
      ) : null}
      {searchAt === null || searchScreen === null ? null : (
        <QuickSearch
          left={searchScreen[0]}
          top={searchScreen[1]}
          onPick={(choice) => pick(searchAt, choice)}
          onCancel={() => setSearchAt(null)}
        />
      )}
      <TitleChip
        page={page}
        onRename={(title) =>
          void commit([{ _tag: "RenamePage", pageId: page.id, title }]).then((events) => {
            if (events.length > 0) props.onRenamed(normalizePageName(title))
          })
        }
      />
      <PrimaryTools
        tool={tool}
        geometry={geometry}
        color={styles.color}
        scale={styles.scaleLevel}
        onTool={chooseTool}
        onColor={(color) => {
          setStyles({ ...styles, color })
          patchSelection(() => ({ fill: color, stroke: color }))
        }}
        onScale={(scaleLevel) => {
          setStyles({ ...styles, scaleLevel })
          patchSelection(() => ({ scaleLevel }))
        }}
      />
      <ActionBar
        zoom={cam.zoom}
        grid={grid}
        snap={snap}
        hasSelection={selection.length > 0}
        onUndo={() => history("Undo")}
        onRedo={() => history("Redo")}
        onZoom={setZoom}
        onGrid={() => setGrid(!grid)}
        onSnap={() => setSnap(!snap)}
      />
    </div>
  )
}

const Loaded = (props: BoardProps) => {
  const tree = useAtomValue(pageTreeAtom(props.page.id))
  if (AsyncResult.isSuccess(tree)) {
    return <Canvas key={`${props.page.id} ${props.focus ?? ""}`} tree={tree.value} {...props} />
  }
  return (
    <div className="wb-root">
      {AsyncResult.isFailure(tree) ? (
        <div className="wb-status" role="alert">
          This whiteboard could not be loaded.
        </div>
      ) : (
        <div className="wb-status" role="status">
          Loading whiteboard
        </div>
      )}
    </div>
  )
}

export const Board = (props: BoardProps) => (
  <>
    <BoardStyle />
    <Loaded {...props} />
  </>
)

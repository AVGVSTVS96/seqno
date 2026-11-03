import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconChalkboard, IconLink, IconPlus } from "@tabler/icons-react"
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
import type { Asset, PageTree } from "@seqno/rpc"
import boardCss from "./board.css?inline"
import { clipboardHtml, copiedOf, readClipboard } from "./clipboard.ts"
import {
  clones,
  copiesAt,
  create,
  editText,
  group,
  patch,
  remove,
  reorder,
  ungroup,
  type Draft,
  type Raw,
} from "./commands.ts"
import { ContextBar } from "./ContextBar.tsx"
import { ContextMenu, type MenuGroup } from "./ContextMenu.tsx"
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
  lineRaw,
  selectionBounds,
  type Gesture,
  type ResizeHandle,
} from "./gestures.ts"
import {
  GROUP_PADDING,
  isInteractive,
  isLocked,
  itemsOf,
  outermost,
  ratioLocked,
  withMembers,
  sceneOf,
  topHit,
  type Item,
  type Measured,
  type Scene,
} from "./model.ts"
import type { OutlinerEnv } from "./Portal.tsx"
import { IconGroup, IconUngroup } from "./icons.tsx"
import { freshId } from "./ids.ts"
import { mediaDrafts, mediaOf, naturalSize, type Saved } from "./media.ts"
import { applyLocally, isGhost } from "./preview.ts"
import { QuickSearch, type Pick } from "./QuickSearch.tsx"
import { ShapeView, type ShapeSlots } from "./ShapeView.tsx"
import { ActionBar, PrimaryTools, usePopoverIds, type ZoomAction } from "./Toolbar.tsx"
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
  readonly saveFiles: (files: ReadonlyArray<File>) => Promise<ReadonlyArray<Asset>>
  readonly openPage: (name: string, sidebar: boolean) => void
  readonly onRenamed: (name: string) => void
  readonly references: number
  readonly referencesPanel: ReactNode
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

const CLONE_KEYS: Record<string, Vec> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]") !== null)

const insideLivePortal = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('[data-live="true"] .wb-portal-body, [data-active="true"]') !== null

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

const snapAngle = (from: Vec, to: Vec): Vec => {
  const [dx, dy] = sub(to, from)
  const step = Math.PI / 12
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  const span = Math.hypot(dx, dy)
  return [from[0] + Math.cos(angle) * span, from[1] + Math.sin(angle) * span]
}

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
  references,
  referencesPanel,
  onRename,
}: {
  readonly page: Page
  readonly references: number
  readonly referencesPanel: ReactNode
  readonly onRename: (title: string) => void
}) => {
  const panel = usePopoverIds()
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
      {references === 0 ? null : (
        <>
          <button
            type="button"
            className="wb-references"
            popoverTarget={panel.id}
            style={panel.trigger}
          >
            <IconLink size={16} aria-hidden />
            {references} {references === 1 ? "Reference" : "References"}
          </button>
          <div
            id={panel.id}
            popover="auto"
            className="wb-popover wb-references-panel"
            data-side="below"
            style={panel.popover}
            onKeyDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {referencesPanel}
          </div>
        </>
      )}
    </div>
  )
}

const readClipboardItems = async () => {
  const [item] = await navigator.clipboard.read()
  const read = (type: string) =>
    item?.types.includes(type) === true ? item.getType(type).then((blob) => blob.text()) : ""
  return { html: await read("text/html"), text: await read("text/plain") }
}

const Canvas = ({ tree, ...props }: BoardProps & { readonly tree: PageTree }) => {
  const { page, focus } = props
  const run = useAtomSet(dispatchAllAtom, { mode: "promiseExit" })
  const history = useAtomSet(historyAtom)
  const requestEdit = useAtomSet(editRequest)
  const root = useRef<HTMLDivElement | null>(null)
  const press = useRef<Press | null>(null)
  const pointer = useRef<Vec | null>(null)
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
  const [menuAt, setMenuAt] = useState<Vec | null>(null)
  const [penMode, setPenMode] = useState(false)
  const [active, setActive] = useState<BlockId | null>(null)

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
  const editingId = editing !== null && exists(editing) ? editing : null
  const selectedItems = selection.flatMap((id) => shown.byId.get(id) ?? [])
  const erasing = gesture._tag === "Erasing" ? new Set(gesture.ids) : new Set<BlockId>()

  const commit = (commands: ReadonlyArray<Command>) => {
    if (commands.length === 0) return Promise.resolve<ReadonlyArray<GraphEvent>>([])
    setPending((current) =>
      current !== null && current.base === tree
        ? { base: tree, commands: [...current.commands, ...commands] }
        : { base: tree, commands },
    )
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

  const finishEditing = (next: EventTarget | null) => {
    const id = editing
    setEditing(null)
    if (!isEditableTarget(next)) root.current?.focus()
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
      item.shape.type === "text" && item.shape.isSizeLocked !== false && seen !== undefined
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
          if (original === undefined || isGhost(original.block.id)) return []
          const next = change(original)
          return Object.keys(next).length === 0 ? [] : [patch(original, next)]
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
    const after = scene.items.findLast((item) => !isGhost(item.block.id))?.block.id
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
        void commit(changesOf(page.id, scene, done, styles)).then((events) => {
          const copies = done.copy
          if (copies === null) return
          const top = withMembers(scene, done.ids).flatMap((id, index) =>
            done.ids.includes(id) ? (copies[index] ?? []) : [],
          )
          if (createdIds(events).length > 0) setSelected(top)
        })
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
    if (searchAt !== null) setSearchAt(null)
    if (menuAt !== null) setMenuAt(null)
    if (active !== null) setActive(null)
    const at = screenOf(event)
    const world = toWorld(cam, at)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    root.current?.focus()
    if (
      event.button === 1 ||
      spacePan ||
      tool === "move" ||
      (penMode && event.pointerType === "touch")
    ) {
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
          keepRatio: event.shiftKey || ratioLocked(scene, selection),
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
        const parent = scene.groupOf.get(hit.block.id)
        const id = parent === undefined || selection.includes(hit.block.id) ? hit.block.id : parent
        const entering = parent !== undefined && id === parent && selection.includes(parent)
        if (entering) press.current = { ...press.current, hit: hit.block.id }
        else press.current = { ...press.current, hit: id }
        const already = selection.includes(id)
        const next = event.shiftKey
          ? already
            ? selection.filter((other) => other !== id)
            : [...selection, id]
          : already
            ? selection
            : [id]
        setSelected(next)
        setGesture({
          _tag: "Translating",
          from: world,
          to: world,
          ids: next,
          copy: event.altKey ? withMembers(scene, next).map(() => freshId()) : null,
        })
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
    pointer.current = world
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
        setGesture({
          ...gesture,
          to: add(gesture.from, delta),
          copy: event.altKey
            ? (gesture.copy ?? withMembers(scene, gesture.ids).map(() => freshId()))
            : null,
        })
        return
      }
      case "Resizing":
        setGesture({
          ...gesture,
          to: snap && !event.shiftKey ? snapped(world) : world,
          keepRatio: event.shiftKey || ratioLocked(scene, gesture.ids),
        })
        return
      case "Creating":
        setGesture({ ...gesture, to: snapped(world) })
        return
      case "Connecting": {
        const end =
          event.metaKey || event.ctrlKey ? null : bindTarget(scene, world, cam.zoom, gesture.start)
        const to = event.shiftKey ? snapAngle(gesture.from, world) : world
        setGesture({ ...gesture, to, end: end?.block.id ?? null })
        return
      }
      case "MovingEnd": {
        const bind =
          event.metaKey || event.ctrlKey ? null : bindTarget(scene, world, cam.zoom, gesture.line)
        setGesture({ ...gesture, to: world, bind: bind?.block.id ?? null })
        return
      }
      case "Drawing":
        setGesture((current) =>
          current._tag === "Drawing" ? { ...current, points: [...current.points, world] } : current,
        )
        return
      case "Erasing": {
        const hits = erasedAt(scene, world, cam.zoom)
        setGesture((current) =>
          current._tag === "Erasing"
            ? { ...current, ids: [...new Set([...current.ids, ...hits])], last: world }
            : current,
        )
      }
    }
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target) || tool !== "select") {
      return
    }
    const world = toWorld(cam, screenOf(event))
    const hit = topHit(scene, world, cam.zoom)
    if (hit === null) {
      setSelected([])
      setSearchAt(world)
      return
    }
    if (startEditing(hit.block.id)) return
    setSelected([hit.block.id])
    if (isInteractive(hit) && !isLocked(hit)) setActive(hit.block.id)
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
      } else if (active !== null) setActive(null)
      else if (tool !== "select") setTool("select")
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
    const direction = CLONE_KEYS[key]
    const cloneChord = navigator.userAgent.includes("Mac")
      ? event.ctrlKey && event.shiftKey && !event.metaKey
      : event.altKey && !event.ctrlKey && !event.metaKey
    if (direction !== undefined && cloneChord) {
      const only = selectedItems.length === 1 ? selectedItems[0] : undefined
      if (only !== undefined && !isLocked(only)) {
        handled()
        cloneTo(only, direction)
      }
      return
    }
    if (mod) {
      const lower = key.toLowerCase()
      if (lower === "a") {
        handled()
        selectAll()
      } else if (lower === "g") {
        handled()
        if (event.shiftKey) ungroupSelection()
        else groupSelection()
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
    if (lower === "g" || lower === "n" || lower === "c") {
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

  const selectAll = () =>
    setSelected(
      scene.items.flatMap((item) => (scene.groupOf.has(item.block.id) ? [] : [item.block.id])),
    )

  const groupSelection = () => {
    const id = freshId()
    const commands = group(page.id, scene, selection, id)
    if (commands.length === 0) return
    void commit(commands)
    if (commands.some((command) => command._tag === "InsertBlocks")) setSelected([id])
  }

  const ungroupSelection = () => {
    const { commands, members } = ungroup(scene, selection)
    if (commands.length === 0) return
    void commit(commands)
    setSelected(members)
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
    active,
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
  const quiet = gesture._tag === "Idle" && editingId === null
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
  const fine = Math.max(0, Math.min(1, (cam.zoom - 0.5) * 0.34))
  const contextAt = (() => {
    if (selectedBox === null) return null
    const box = toBox(selectedBox)
    const above = box.top - 18 - 44
    const top = above < 16 + 100 - 18 ? box.top + box.height + 18 : above
    const left = Math.max(16 + 150, Math.min(viewport.width - 16 - 150, box.left + box.width / 2))
    return { left, top: Math.min(top, viewport.height - 140) }
  })()

  const overlay: ReactNode[] = []
  const groupFrame = (id: BlockId, kind: "hover" | "selected" | "member") => {
    const box = shown.bounds.get(id)
    if (box === undefined) return
    const pad = GROUP_PADDING
    const frame = toBox({
      minX: box.minX - pad,
      minY: box.minY - pad,
      maxX: box.maxX + pad,
      maxY: box.maxY + pad,
    })
    overlay.push(
      <svg
        key={`group-${kind}-${id}`}
        className="wb-group-frame"
        data-kind={kind}
        style={frame}
        width={frame.width}
        height={frame.height}
      >
        <rect
          x={0.75}
          y={0.75}
          width={Math.max(0, frame.width - 1.5)}
          height={Math.max(0, frame.height - 1.5)}
          rx={4 * cam.zoom}
          strokeDasharray="8 2"
        />
      </svg>,
    )
  }
  if (hover !== null && !selection.includes(hover) && quiet) {
    const box = shown.bounds.get(hover)
    const hovered = shown.byId.get(hover)
    if (box !== undefined && hovered?.shape.type !== "group") {
      overlay.push(<div key="hover" className="wb-outline" data-hover style={toBox(box)} />)
    }
    const parent = hovered?.shape.type === "group" ? hover : shown.groupOf.get(hover)
    if (parent !== undefined && !selection.includes(parent)) groupFrame(parent, "hover")
  }
  for (const item of selectedItems) {
    if (item.shape.type === "group") groupFrame(item.block.id, "selected")
    const parent = shown.groupOf.get(item.block.id)
    if (parent !== undefined && !selection.includes(parent)) groupFrame(parent, "member")
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
    single.shape.type !== "group" &&
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
        const handles: ReadonlyArray<readonly [string, number, number, Vec]> = [
          ["left", left - 30 - 16, top + height / 2, [-1, 0]],
          ["right", left + width + 30 + 16, top + height / 2, [1, 0]],
          ["bottom", left + width / 2, top + height + 30 + 16, [0, 1]],
        ]
        overlay.push(
          ...handles.map(([name, x, y, direction]) => (
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

  const createLinked = (drafts: ReadonlyArray<Draft>, from: BlockId, to: BlockId) => {
    const lineId = freshId()
    const link = (start: Vec, end: Vec): Draft => ({
      id: lineId,
      raw: lineRaw(start, end, from, to, styles),
      text: "",
    })
    const sketch = create(page.id, scene, [...drafts, link([0, 0], [1, 1])])
    if (sketch === null) return null
    const ends = sceneOf(itemsOf(applyLocally(blocks, [sketch])), measured).ends.get(lineId)
    return ends === undefined ? sketch : create(page.id, scene, [...drafts, link(ends[0], ends[1])])
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
    const id = freshId()
    const made = createLinked([{ id, raw, text: "" }], item.block.id, id)
    if (made === null) return
    void commit([made])
    setSelected([id])
    setEditing(id)
    setDraft("")
  }

  const onCopy = (event: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target) || selection.length === 0)
      return
    event.preventDefault()
    event.clipboardData.setData("text/plain", copyText())
    event.clipboardData.setData("text/html", copyHtml())
    if (cut) deleteSelection()
  }

  const copyText = () =>
    selection.map((id) => portalText({ _tag: "BlockPortal", uuid: id })).join(" ")

  const copyHtml = () =>
    clipboardHtml(
      copiedOf(
        scene,
        withMembers(scene, selection).flatMap((id) => scene.byId.get(id) ?? []),
      ),
    )

  const writeClipboard = () =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([copyText()], { type: "text/plain" }),
        "text/html": new Blob([copyHtml()], { type: "text/html" }),
      }),
    ])

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || insideLivePortal(event.target)) return
    const files = [...event.clipboardData.files]
    if (files.some((file) => mediaOf(file.name) !== null)) {
      event.preventDefault()
      void placeFiles(files, pointer.current ?? toWorld(cam, center(viewport)), false)
      return
    }
    const html = event.clipboardData.getData("text/html")
    const text = event.clipboardData.getData("text/plain").trim()
    if (html === "" && text === "") return
    event.preventDefault()
    paste(html, text, pointer.current)
  }

  const placeFiles = async (files: ReadonlyArray<File>, at: Vec, fromDrop: boolean) => {
    const media = files.flatMap((file) => {
      const kind = mediaOf(file.name)
      return kind === null ? [] : [{ file, kind }]
    })
    if (media.length === 0) return false
    const linkFrom = fromDrop && selectedItems.length === 1 ? selectedItems[0] : undefined
    const assets = await props.saveFiles(media.map(({ file }) => file))
    const saved = await Promise.all(
      assets.flatMap((asset, index): ReadonlyArray<Promise<Saved>> => {
        const kind = media[index]?.kind
        if (kind === undefined) return []
        return [
          naturalSize(asset.url, kind).then((size) => ({ media: kind, path: asset.path, size })),
        ]
      }),
    )
    const drafts = mediaDrafts(saved, at).map((made) => ({ ...made, id: freshId() }))
    const ids = drafts.flatMap((made) => made.id ?? [])
    const [only] = ids
    const made =
      linkFrom === undefined || only === undefined || ids.length !== 1
        ? create(page.id, scene, drafts)
        : createLinked(drafts, linkFrom.block.id, only)
    if (made !== null) void commit([made])
    setSelected(ids)
    return true
  }

  const paste = (html: string, text: string, at: Vec | null) => {
    const copied = readClipboard(html)
    const where = at ?? toWorld(cam, center(viewport))
    if (copied.length > 0) {
      const drafts = clones(
        copied,
        copiesAt(copied, snapped(where)),
        copied.map(() => freshId()),
      )
      const made = create(page.id, scene, drafts)
      if (made !== null) void commit([made])
      const nested = new Set(
        drafts.flatMap(({ raw }) => (Array.isArray(raw["children"]) ? raw["children"] : [])),
      )
      setSelected(
        drafts.flatMap((copy) => (copy.id === undefined || nested.has(copy.id) ? [] : [copy.id])),
      )
      return
    }
    if (text === "") return
    const point: Vec = [where[0] - PORTAL_WIDTH / 2, where[1]]
    const target = portalTarget(text)
    if (Option.isSome(target)) {
      void placeShape(portalRaw(point, target.value._tag === "PagePortal" ? "P" : "B"), text).then(
        selectCreated,
      )
      return
    }
    newBlockPortal(point, text)
  }

  const menuGroups = (): ReadonlyArray<MenuGroup> => {
    const unlocked = selectedItems.filter((item) => !isLocked(item))
    const some = selection.length > 0
    const reorderTo = (order: "front" | "back") => {
      const command = reorder(scene, selection, order)
      if (command !== null) void commit([command])
    }
    return [
      some ? [{ label: "Zoom to fit", keys: "Shift+1", run: () => setZoom("selection") }] : [],
      unlocked.length > 0 &&
      (selection.length > 1 ||
        selectedItems.some(
          (item) => item.shape.type === "group" || scene.groupOf.has(item.block.id),
        ))
        ? [
            ...(selectedItems.some(
              (item) => item.shape.type === "group" || scene.groupOf.has(item.block.id),
            )
              ? [
                  {
                    label: "Ungroup",
                    keys: "Mod+Shift+G",
                    icon: IconUngroup,
                    run: ungroupSelection,
                  },
                ]
              : []),
            ...(selection.length > 1
              ? [{ label: "Group", keys: "Mod+G", icon: IconGroup, run: groupSelection }]
              : []),
          ]
        : [],
      [
        ...(unlocked.length > 0
          ? [
              {
                label: "Cut",
                keys: "Mod+X",
                run: () => void writeClipboard().then(deleteSelection),
              },
              { label: "Copy", keys: "Mod+C", run: () => void writeClipboard() },
            ]
          : []),
        {
          label: "Paste",
          keys: "Mod+V",
          run: () => {
            const at = menuAt === null ? null : toWorld(cam, menuAt)
            void readClipboardItems().then(({ html, text }) => paste(html, text.trim(), at))
          },
        },
      ],
      [
        {
          label: "Select all",
          keys: "Mod+A",
          run: selectAll,
        },
        ...(selection.length > 1 ? [{ label: "Deselect all", run: () => setSelected([]) }] : []),
      ],
      some
        ? [
            unlocked.length > 0
              ? { label: "Lock", keys: "Mod+L", run: () => patchSelectionAll({ isLocked: true }) }
              : {
                  label: "Unlock",
                  keys: "Mod+Shift+L",
                  run: () => patchSelectionAll({ isLocked: false }),
                },
            ...(unlocked.length > 0
              ? [{ label: "Delete", keys: "Del", run: deleteSelection }]
              : []),
          ]
        : [],
      some
        ? [
            { label: "Move to front", keys: "Shift+]", run: () => reorderTo("front") },
            { label: "Move to back", keys: "Shift+[", run: () => reorderTo("back") },
          ]
        : [],
    ]
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
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files") || insideLivePortal(event.target)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        const files = [...event.dataTransfer.files]
        if (files.length === 0 || insideLivePortal(event.target)) return
        event.preventDefault()
        void placeFiles(files, toWorld(cam, screenOf(event)), true)
      }}
      onContextMenu={(event) => {
        if (insideLivePortal(event.target) || isEditableTarget(event.target)) return
        event.preventDefault()
        const at = screenOf(event)
        const hit = topHit(scene, toWorld(cam, at), cam.zoom)
        if (hit !== null && !selection.includes(hit.block.id)) {
          const target = outermost(scene, hit.block.id)
          if (!selection.includes(target)) setSelected([target])
        }
        if (hit === null && !event.shiftKey) setSelected([])
        setMenuAt(at)
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
      {menuAt === null ? null : (
        <ContextMenu
          left={menuAt[0]}
          top={menuAt[1]}
          groups={menuGroups()}
          onClose={() => {
            setMenuAt(null)
            root.current?.focus()
          }}
        />
      )}
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
        references={props.references}
        referencesPanel={props.referencesPanel}
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
        pen={penMode}
        onPen={() => setPenMode(!penMode)}
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

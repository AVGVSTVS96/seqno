import { logseq } from "@seqno/dom"

export interface LayoutData {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly vw: number
  readonly vh: number
}

const layoutOf = (element: HTMLElement): LayoutData => {
  const { left, top, width, height } = element.getBoundingClientRect()

  return { left, top, width, height, vw: window.innerWidth, vh: window.innerHeight }
}

const offset = (element: HTMLElement) => ({
  x: Number(element.dataset["dx"] ?? 0),
  y: Number(element.dataset["dy"] ?? 0),
})

const moveBy = (element: HTMLElement, x: number, y: number) => {
  element.style.transform = `translate(${x}px, ${y}px)`
  element.dataset["dx"] = String(x)
  element.dataset["dy"] = String(y)
}

const track = (
  handle: HTMLElement,
  element: HTMLElement,
  busy: string,
  move: (dx: number, dy: number, start: DOMRect) => void,
  done: () => void,
) => {
  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || (down.target instanceof Element && down.target.closest("button"))) {
      return
    }

    down.preventDefault()
    handle.setPointerCapture(down.pointerId)
    const start = element.getBoundingClientRect()
    element.classList.add(busy)

    const onMove = (event: PointerEvent) => {
      move(event.clientX - down.clientX, event.clientY - down.clientY, start)
    }

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove)
      element.classList.remove(busy)
      done()
    }

    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onUp, { once: true })
  })
}

export const enableDrag = (
  element: HTMLElement,
  options: {
    readonly title: string
    readonly close: () => void
    readonly saved?: (layout: LayoutData) => void
  },
) => {
  if (element.dataset["inited_draggable"] !== undefined) {
    return
  }

  element.dataset["inited_draggable"] = "true"
  const handle = document.createElement("div")
  handle.className = logseq("seqno-plugin-handle").className
  const bar = document.createElement("div")
  bar.className = logseq("seqno-plugin-handle-bar").className
  const titleBox = document.createElement("div")
  titleBox.className = logseq("seqno-plugin-handle-title").className
  const title = document.createElement("h3")
  title.textContent = options.title
  titleBox.append(title)
  const actions = document.createElement("div")
  actions.className = logseq("seqno-plugin-handle-actions").className
  const close = document.createElement("button")
  close.type = "button"
  close.className = logseq("seqno-plugin-handle-close").className
  close.setAttribute("aria-label", "Close")
  close.textContent = "×"
  close.addEventListener("click", (event) => {
    event.stopPropagation()
    options.close()
  })
  actions.append(close)
  bar.append(titleBox, actions)
  handle.append(bar)
  element.prepend(handle)
  let from = offset(element)
  track(
    handle,
    element,
    "is-dragging",
    (dx, dy) => {
      moveBy(element, from.x + dx, from.y + dy)
    },
    () => {
      from = offset(element)
      options.saved?.(layoutOf(element))
    },
  )
}

export const enableResize = (element: HTMLElement, saved?: (layout: LayoutData) => void) => {
  if (element.dataset["inited_resizable"] !== undefined) {
    return
  }

  element.dataset["inited_resizable"] = "true"
  const handle = document.createElement("div")
  handle.className = logseq("seqno-plugin-resize").className
  element.prepend(handle)
  track(
    handle,
    element,
    "is-resizing",
    (dx, dy, start) => {
      element.style.width = `${Math.max(start.width + dx, 100)}px`
      element.style.height = `${Math.max(start.height + dy, 60)}px`
    },
    () => saved?.(layoutOf(element)),
  )
}

export const restoreLayout = (element: HTMLElement, layout: LayoutData) => {
  element.dataset["inited_layout"] = "true"
  const left = Math.max(layout.left, 0)
  const top = Math.max(layout.top, 45)
  Object.assign(element.style, {
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    left: `${Math.min((left * 100) / layout.vw, 99)}%`,
    top: `${Math.min((top * 100) / layout.vh, 99)}%`,
  })
}

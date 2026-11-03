import { logseq } from "@seqno/dom"
import DOMPurify from "dompurify"

export interface UIOptions {
  readonly key: string | null
  readonly slot: string | null
  readonly path: string | null
  readonly template: string | null
  readonly style: Readonly<Record<string, string>>
  readonly attrs: Readonly<Record<string, string>>
  readonly reset: boolean
}

export interface ModelEvent {
  readonly type: string
  readonly value: string | null
  readonly id: string
  readonly className: string
  readonly dataset: Readonly<Record<string, string>>
  readonly rect?: unknown
}

export type CallModel = (name: string, event: ModelEvent) => void

export const sanitizeHtml = (template: string) =>
  DOMPurify.sanitize(template, {
    ADD_TAGS: ["iframe"],
    ALLOW_UNKNOWN_PROTOCOLS: true,
    ADD_ATTR: ["allow", "src", "allowfullscreen", "frameborder", "scrolling", "target"],
  })

const kebab = (key: string) =>
  key.startsWith("--") ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

export const applyStyle = (element: HTMLElement, style: Readonly<Record<string, unknown>>) => {
  for (const [key, value] of Object.entries(style)) {
    if (value === null || value === undefined) element.style.removeProperty(kebab(key))
    else element.style.setProperty(kebab(key), String(value))
  }
}

const modelEvents = [
  "click",
  "dblclick",
  "keyup",
  "keypress",
  "keydown",
  "change",
  "input",
  "contextmenu",
  "focusin",
  "focusout",
] as const

const valueOf = (element: Element) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement
    ? element.value
    : null

const listen = (wrapper: HTMLElement, callModel: CallModel) => {
  for (const type of modelEvents) {
    wrapper.addEventListener(type, (event) => {
      const origin = event.target instanceof Element ? event.target : null
      const target = origin?.closest(`[data-on-${type}]`)
      if (!(target instanceof HTMLElement) || !wrapper.contains(target)) return
      const name = target.dataset[`on${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`]
      if (name === undefined) return
      if (target.dataset["preventDefault"] === "true") event.preventDefault()
      callModel(name, {
        type,
        value: valueOf(target),
        id: target.id,
        className: target.className,
        dataset: Object.fromEntries(
          Object.entries(target.dataset).flatMap(([key, item]) =>
            item === undefined ? [] : [[key, item]],
          ),
        ),
        ...(target.dataset["rect"] === undefined
          ? {}
          : { rect: target.getBoundingClientRect().toJSON() }),
      })
    })
  }
}

const floatContainer = (pid: string, id: string, title: string, onClose: () => void) => {
  const container = document.createElement("div")
  container.className = logseq("seqno-plugin-float").className
  container.dataset["ref"] = pid
  container.dataset["identity"] = id
  const head = document.createElement("div")
  head.className = "lsp-ui-float-head"
  const label = document.createElement("span")
  label.textContent = title
  const close = document.createElement("button")
  close.type = "button"
  close.className = "lsp-ui-float-close"
  close.setAttribute("aria-label", "Close")
  close.textContent = "×"
  close.addEventListener("click", onClose)
  head.append(label, close)
  const body = document.createElement("div")
  body.className = "lsp-ui-float-body"
  container.append(head, body)
  document.body.append(container)
  return body
}

const targetOf = (pid: string, ui: UIOptions, id: string): HTMLElement | null => {
  if (ui.slot !== null) return document.getElementById(ui.slot)
  if (ui.path !== null) {
    const found = document.querySelector(ui.path)
    return found instanceof HTMLElement ? found : null
  }
  return floatContainer(pid, id, ui.attrs["title"] ?? "", () =>
    document.querySelector(`.seqno-plugin-float[data-identity="${CSS.escape(id)}"]`)?.remove(),
  )
}

const boxOf = (wrapper: HTMLElement) => {
  const float = wrapper.closest(".seqno-plugin-float")
  return float instanceof HTMLElement ? float : wrapper
}

const setAttrs = (element: HTMLElement, attrs: Readonly<Record<string, string>>) => {
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
}

export const injectUI = (pid: string, ui: UIOptions, callModel: CallModel) => {
  const id = `${pid}--${ui.key ?? Math.random().toString(36).slice(2, 10)}`
  const existing = document.getElementById(id)
  if (ui.template === null || ui.template === "") {
    const float = existing?.closest(".seqno-plugin-float")
    ;(float ?? existing)?.remove()
    return
  }
  if (existing !== null) {
    existing.innerHTML = sanitizeHtml(ui.template)
    const outer = boxOf(existing)
    setAttrs(outer, ui.attrs)
    applyStyle(outer, ui.style)
    return
  }
  const target = targetOf(pid, ui, id)
  if (target === null) return
  if (ui.reset && ui.slot !== null) {
    for (const other of target.querySelectorAll("[data-injected-ui]")) other.remove()
  }
  const wrapper = document.createElement("div")
  wrapper.id = id
  wrapper.dataset["injectedUi"] = id
  wrapper.dataset["ref"] = pid
  wrapper.innerHTML = sanitizeHtml(ui.template)
  listen(wrapper, callModel)
  target.append(wrapper)
  const outer = boxOf(wrapper)
  setAttrs(outer, ui.attrs)
  applyStyle(outer, ui.style)
}

export const injectStyle = (pid: string, key: string | null, css: string) => {
  if (css.trim() === "") return
  const name = key === null ? "" : `${key}-${pid}`
  const existing =
    key === null
      ? null
      : document.head.querySelector(`style[data-injected-style="${CSS.escape(name)}"]`)
  if (existing !== null) {
    existing.textContent = css
    return
  }
  const style = document.createElement("style")
  style.dataset["injectedStyle"] = name
  style.dataset["ref"] = pid
  style.textContent = css
  document.head.append(style)
}

export const removeInjected = (pid: string) => {
  for (const element of document.querySelectorAll(`[data-ref="${CSS.escape(pid)}"]`)) {
    element.remove()
  }
}

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type ToggleEvent,
} from "react"
import { createPortal } from "react-dom"
import { Keys } from "./Keys.tsx"

export interface Placement {
  readonly align: "start" | "center" | "end"
  readonly gap: number
  readonly inset: number
  readonly side?: "top" | "bottom"
}

const shifts = { start: "0%", center: "-50%", end: "-100%" } as const

const origins = { start: "0%", center: "50%", end: "100%" } as const

const place = (popover: HTMLElement, box: DOMRect, placement: Placement) => {
  const x = { start: box.left, center: box.left + box.width / 2, end: box.right }[placement.align]
  const above = placement.side === "top"
  const style = popover.style
  style.setProperty("--anchor-x", `${x}px`)
  style.setProperty(
    "--anchor-y",
    `${above ? box.top - placement.gap : box.bottom + placement.gap}px`,
  )
  style.setProperty("--shift", shifts[placement.align])
  style.setProperty("--shift-y", above ? "-100%" : "0%")
  style.setProperty("--inset", `${placement.inset}px`)
  style.setProperty("--origin", `${origins[placement.align]} ${above ? "100%" : "0%"}`)
  style.setProperty("--slide", above ? "8px" : "-8px")
}

const placeNear = (popover: HTMLElement, anchor: Element, placement: Placement) =>
  place(popover, anchor.getBoundingClientRect(), placement)

const items = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]")].filter(
    (item) => item.getAttribute("aria-disabled") !== "true",
  )

const moveFocus = (menu: HTMLElement, by: (index: number, count: number) => number) => {
  const all = items(menu)
  const current = all.findIndex((item) => item === document.activeElement)
  all[by(current, all.length)]?.focus()
}

const menuKeys: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index <= 0 ? count - 1 : index - 1),
  Home: () => 0,
  End: (_, count) => count - 1,
}

export const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Tab") {
    event.preventDefault()
    event.currentTarget.hidePopover()
    return
  }
  const step = menuKeys[event.key]
  if (step === undefined) return
  event.preventDefault()
  moveFocus(event.currentTarget, step)
}

const closePopoverOf = (element: Element) => {
  const popover = element.closest("[popover]")
  if (popover instanceof HTMLElement) popover.hidePopover()
}

export const showPopover = (id: string) => document.getElementById(id)?.showPopover()

export const togglePopover = (id: string) => document.getElementById(id)?.togglePopover()

interface TriggerProps {
  readonly ref: Ref<HTMLButtonElement>
  readonly popoverTarget: string
  readonly "aria-haspopup": "menu" | "dialog"
  readonly "aria-expanded": boolean
  readonly "aria-controls": string
  readonly onPointerDown: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

export interface PopoverHandle {
  readonly id: string
  readonly open: boolean
  readonly anchor: RefObject<HTMLButtonElement | null>
  readonly trigger: TriggerProps
  readonly onBeforeToggle: (event: ToggleEvent<HTMLElement>) => void
  readonly onToggle: (event: ToggleEvent<HTMLElement>) => void
}

export const usePopover = ({
  placement,
  kind,
  id: fixedId,
  anchorOverride,
  onOpen,
}: {
  readonly placement: Placement
  readonly kind: "menu" | "dialog"
  readonly id?: string
  readonly anchorOverride?: RefObject<HTMLElement | null>
  readonly onOpen?: () => void
}): PopoverHandle => {
  const generated = useId()
  const id = fixedId ?? generated
  const anchor = useRef<HTMLButtonElement>(null)
  const openedBy = useRef<"pointer" | "keyboard">("pointer")
  const [open, setOpen] = useState(false)
  return {
    id,
    open,
    anchor,
    trigger: {
      ref: anchor,
      popoverTarget: id,
      "aria-haspopup": kind,
      "aria-expanded": open,
      "aria-controls": id,
      onPointerDown: () => {
        openedBy.current = "pointer"
      },
      onKeyDown: (event) => {
        openedBy.current = "keyboard"
        if (event.key !== "ArrowDown" || open) return
        event.preventDefault()
        showPopover(id)
      },
    },
    onBeforeToggle: (event) => {
      const target = anchorOverride?.current ?? anchor.current
      if (event.newState === "open" && target !== null) {
        placeNear(event.currentTarget, target, placement)
      }
    },
    onToggle: (event) => {
      const opened = event.newState === "open"
      setOpen(opened)
      if (!opened) return
      onOpen?.()
      const first = items(event.currentTarget)[0]
      if (kind === "menu" && openedBy.current === "keyboard" && first !== undefined) first.focus()
      else event.currentTarget.focus()
    },
  }
}

export const Menu = ({
  handle,
  label,
  className,
  children,
}: {
  readonly handle: PopoverHandle
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}) => (
  <div
    id={handle.id}
    popover="auto"
    role="menu"
    aria-label={label}
    tabIndex={-1}
    className={className === undefined ? "menu" : `menu ${className}`}
    onBeforeToggle={handle.onBeforeToggle}
    onToggle={handle.onToggle}
    onKeyDown={onMenuKeyDown}
  >
    {children}
  </div>
)

export const MenuItem = ({
  icon,
  hint,
  onSelect,
  children,
}: {
  readonly icon?: ReactNode
  readonly hint?: ReactNode
  readonly onSelect: () => void
  readonly children: ReactNode
}) => (
  <button
    type="button"
    role="menuitem"
    tabIndex={-1}
    className="menu-item"
    onPointerMove={(event) => {
      if (document.activeElement !== event.currentTarget) event.currentTarget.focus()
    }}
    onPointerLeave={(event) => {
      const menu = event.currentTarget.closest("[role=menu]")
      if (menu instanceof HTMLElement) menu.focus()
    }}
    onClick={(event) => {
      closePopoverOf(event.currentTarget)
      onSelect()
    }}
  >
    {icon}
    <span className="menu-item-label">{children}</span>
    {hint === undefined ? null : <span className="menu-item-hint">{hint}</span>}
  </button>
)

export const MenuSeparator = () => <div role="separator" className="menu-separator" />

export interface TooltipContent {
  readonly label: string
  readonly keys?: ReadonlyArray<string>
}

const below: Placement = { align: "center", gap: 4, inset: 4 }

export const useTooltip = (content: TooltipContent | undefined, placement: Placement = below) => {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const id = useId()
  const show = (element: HTMLElement) => setAnchor(element.getBoundingClientRect())
  const hide = () => setAnchor(null)
  if (content === undefined) return { props: {}, tooltip: null }
  return {
    props: {
      "aria-describedby": anchor === null ? undefined : id,
      onPointerEnter: (event: { readonly currentTarget: HTMLElement }) => show(event.currentTarget),
      onPointerLeave: hide,
      onPointerDownCapture: hide,
      onFocus: (event: { readonly currentTarget: HTMLElement }) => {
        if (event.currentTarget.matches(":focus-visible")) show(event.currentTarget)
      },
      onBlur: hide,
    },
    tooltip:
      anchor === null
        ? null
        : createPortal(
            <div
              id={id}
              role="tooltip"
              popover="manual"
              className={content.keys === undefined ? "tooltip tooltip-plain" : "tooltip"}
              ref={(element) => {
                if (element === null) return
                place(element, anchor, placement)
                element.showPopover()
              }}
            >
              <span className="tooltip-label">{content.label}</span>
              {content.keys === undefined ? null : <Keys keys={content.keys} framed />}
            </div>,
            document.body,
          ),
  }
}

export const openDialog = (id: string) => {
  const dialog = document.getElementById(id)
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal()
}

export const toggleDialog = (id: string) => {
  const dialog = document.getElementById(id)
  if (!(dialog instanceof HTMLDialogElement)) return
  if (dialog.open) dialog.close()
  else dialog.showModal()
}

export const closeDialogOf = (element: Element) => element.closest("dialog")?.close()

export const Dialog = ({
  id,
  label,
  className,
  children,
}: {
  readonly id: string
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}) => (
  <dialog
    id={id}
    aria-label={label}
    className={className === undefined ? "dialog" : `dialog ${className}`}
    onClick={(event) => {
      if (event.target === event.currentTarget) event.currentTarget.close()
    }}
  >
    {children}
  </dialog>
)

import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { logseq } from "@seqno/dom"
import { IconLoader2 } from "@tabler/icons-react"
import pdfViewerCss from "pdfjs-dist/web/pdf_viewer.css?inline"
import { Suspense, use, useContext, useState, useSyncExternalStore } from "react"
import type { PointerEvent, ReactNode } from "react"
import type { PdfHost } from "./host.ts"
import { activates } from "./keys.ts"
import { classesOf, colors } from "./model.ts"
import { retryWithPassword } from "./open.ts"
import pdfCss from "./pdf.css?inline"
import { Regions } from "./Regions.tsx"
import { Session } from "./session.ts"
import type { Menu, Snapshot } from "./session.ts"
import { areaDashed, currentPdf, viewerTheme } from "./state.ts"
import type { CurrentPdf } from "./state.ts"
import { Toolbar } from "./Toolbar.tsx"

const Loading = () => (
  <output className="seqno-pdf-loading" aria-label="Loading PDF">
    <IconLoader2 size={28} aria-hidden />
  </output>
)

const MenuItem = ({
  action,
  onSelect,
  children,
}: {
  action: string
  onSelect: () => void
  children: ReactNode
}) => (
  <li
    {...logseq("seqno-pdf-item")}
    role="menuitem"
    tabIndex={-1}
    data-action={action}
    onClick={onSelect}
    onKeyDown={activates(onSelect)}
  >
    {children}
  </li>
)

const ContextMenu = ({ session, menu, host }: { session: Session; menu: Menu; host: PdfHost }) => {
  const area = menu.highlight.content.image !== undefined
  const saved = !menu.fresh

  return (
    <ul
      {...logseq("seqno-pdf-menu")}
      role="menu"
      style={{ top: menu.top, left: menu.left, visibility: menu.hidden ? "hidden" : "visible" }}
      ref={(element) => {
        const viewer = element?.closest(".seqno-pdf-viewer")

        if (element === null || viewer === null || viewer === undefined) {
          return
        }

        const box = element.getBoundingClientRect()
        const frame = viewer.getBoundingClientRect()
        const x = frame.right - box.right
        const y = frame.bottom - box.bottom
        element.style.transform = `translate3d(${x < 0 ? x - 5 : 0}px,${y < 0 ? y - 5 : 0}px,0)`
      }}
      onClick={(event) => {
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          session.closeMenu()
        }
      }}
    >
      <li {...logseq("seqno-pdf-menu-colors")} role="none">
        {colors.map((color) => (
          <a
            key={color}
            {...logseq("seqno-pdf-menu-color", color)}
            role="menuitem"
            tabIndex={-1}
            data-highlight-color={color}
            data-action={color}
            onClick={() => {
              session.applyColor(color)
            }}
            onKeyDown={activates(() => {
              session.applyColor(color)
            })}
          >
            {color}
          </a>
        ))}
      </li>
      {saved ? (
        <MenuItem
          action="ref"
          onSelect={() => {
            void session.copyRef(menu.highlight)
            session.closeMenuSoon()
          }}
        >
          Copy ref
        </MenuItem>
      ) : null}
      {area ? null : (
        <MenuItem
          action="copy"
          onSelect={() => {
            session.copyText(menu)
          }}
        >
          Copy text
        </MenuItem>
      )}
      {saved ? (
        <MenuItem
          action="link"
          onSelect={() => {
            void session.linkedReferences(menu.highlight, host.navigate)
          }}
        >
          Linked references
        </MenuItem>
      ) : null}
      {saved ? (
        <MenuItem
          action="del"
          onSelect={() => {
            session.remove(menu.highlight)
          }}
        >
          Delete
        </MenuItem>
      ) : null}
      {area
        ? null
        : host.menuItems.map((item) => (
            <MenuItem
              key={item.key}
              action="hook"
              onSelect={() => {
                session.runItem(item, menu)
              }}
            >
              {item.label}
            </MenuItem>
          ))}
    </ul>
  )
}

const Resizer = ({ session }: { session: Session }) => {
  const [dragging, setDragging] = useState(false)

  const start = (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const pane = handle.closest(".seqno-pdf")

    if (!(pane instanceof HTMLElement)) {
      return
    }

    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    document.documentElement.classList.add(...classesOf("seqno-pdf-resizing"))
    let timer: ReturnType<typeof setTimeout> | null = null

    const move = (moved: globalThis.PointerEvent) => {
      const ratio = moved.clientX / document.documentElement.clientWidth
      const width = `${Math.min(Math.max(ratio * 100, 20), 80)}vw`
      pane.style.setProperty("width", width)

      if (timer !== null) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        document.documentElement.style.setProperty("--ph-view-container-width", width)
        session.fitSoon()
      }, 200)
    }

    const end = () => {
      handle.removeEventListener("pointermove", move)
      document.documentElement.classList.remove(...classesOf("seqno-pdf-resizing"))
      setDragging(false)
    }

    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end, { once: true })
    handle.addEventListener("pointercancel", end, { once: true })
  }

  return (
    <span
      {...logseq("seqno-pdf-resizer")}
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the PDF"
      onPointerDown={start}
    />
  )
}

const Viewer = ({
  session,
  attach,
  host,
}: {
  session: Session
  attach: (container: HTMLDivElement | null) => (() => void) | undefined
  host: PdfHost
}) => {
  const snapshot: Snapshot = useSyncExternalStore(session.subscribe, session.snapshot)
  const dashed = useAtomValue(areaDashed)

  return (
    <div {...logseq("seqno-pdf-scroller")}>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a mouse drag on the page starts a text or area selection; keyboard selection is the browser's own */}
      <div
        {...logseq("seqno-pdf-viewer", dashed)}
        data-dashed={dashed}
        ref={attach}
        onMouseDown={(event) => {
          if (event.button !== 0 || session.startArea(event.nativeEvent)) {
            return
          }

          let dirty = false

          const changed = () => {
            dirty = true
          }

          document.addEventListener("selectionchange", changed)
          document.addEventListener(
            "mouseup",
            (up) => {
              document.removeEventListener("selectionchange", changed)

              if (dirty) {
                session.selectionEnded({ x: up.clientX, y: up.clientY })
              }
            },
            { once: true },
          )
        }}
      >
        <div {...logseq("seqno-pdf-pages")} />
        <div {...logseq("seqno-pdf-holder")}>
          {snapshot.menu === null ? null : (
            <ContextMenu session={session} menu={snapshot.menu} host={host} />
          )}
        </div>
        {snapshot.area === null ? null : (
          <div {...logseq("seqno-pdf-area-selection")}>
            <div {...logseq("seqno-pdf-shadow-rect")} style={{ ...snapshot.area }} />
          </div>
        )}
      </div>
      {snapshot.ready && !snapshot.broken ? (
        <Regions session={session} snapshot={snapshot} />
      ) : null}
      {snapshot.ready ? <Resizer session={session} /> : null}
      {snapshot.ready ? <Toolbar session={session} snapshot={snapshot} host={host} /> : null}
    </div>
  )
}

const PasswordPrompt = ({ onSubmit }: { onSubmit: (password: string) => void }) => {
  const [password, setPassword] = useState("")

  return (
    <dialog
      className="seqno-pdf-dialog"
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
    >
      <h3>Password required</h3>
      <p>This document is password protected. Please enter a password:</p>
      <input
        autoFocus
        type="password"
        value={password}
        onChange={(event) => {
          setPassword(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit(password)
          }
        }}
      />
      <div className="seqno-pdf-actions">
        <button
          type="button"
          onClick={() => {
            onSubmit(password)
          }}
        >
          Submit
        </button>
      </div>
    </dialog>
  )
}

const Loader = ({ current, host }: { current: CurrentPdf; host: PdfHost }) => {
  const registry = useContext(RegistryContext)
  const loaded = use(current.loading)

  const [session] = useState(() =>
    loaded._tag === "Ready"
      ? new Session(registry, host, current.asset, loaded.document, loaded.pdfjs, loaded.highlights)
      : null,
  )

  if (loaded._tag === "Password") {
    return (
      <PasswordPrompt
        onSubmit={(password) => {
          retryWithPassword(registry, host, current, password)
        }}
      />
    )
  }

  return session === null ? null : (
    <div {...logseq("seqno-pdf-loader")}>
      <Viewer session={session} attach={session.attach} host={host} />
    </div>
  )
}

export const PdfPane = ({ host }: { readonly host: PdfHost }) => {
  const current = useAtomValue(currentPdf)
  const theme = useAtomValue(viewerTheme)

  return (
    <>
      <style href="@seqno/pdf/viewer" precedence="default">
        {pdfViewerCss}
      </style>
      <style href="@seqno/pdf" precedence="default">
        {pdfCss}
      </style>
      {current === null ? null : (
        <div
          {...logseq("seqno-pdf", { identity: current.asset.identity, theme })}
          data-viewer-theme={theme}
        >
          <Suspense fallback={<Loading />}>
            <Loader
              key={`${current.asset.identity}:${current.attempt}`}
              current={current}
              host={host}
            />
          </Suspense>
        </div>
      )}
    </>
  )
}

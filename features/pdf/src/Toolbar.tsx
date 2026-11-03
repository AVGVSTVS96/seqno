import { RegistryContext, useAtom } from "@effect/atom-react"
import { logseq } from "@seqno/dom"
import {
  IconAdjustmentsHorizontal,
  IconArrowBack,
  IconArrowNarrowDown,
  IconArrowNarrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconExternalLink,
  IconHighlight,
  IconInfoCircle,
  IconLetterCase,
  IconListDetails,
  IconMarquee2,
  IconNotes,
  IconSearch,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react"
import { useContext, useState, type KeyboardEvent, type ReactNode } from "react"
import type { Navigate } from "@seqno/outliner"
import type { Highlight } from "./highlights.ts"
import type { PdfHost } from "./host.ts"
import { areaImagePath, hlsPageTitle } from "./model.ts"
import { closePdf } from "./open.ts"
import type { Session, Snapshot } from "./session.ts"
import {
  areaDashed,
  areaMode,
  autoOpenMenu,
  blockColored,
  highlightMode,
  viewerTheme,
  type ViewerTheme,
} from "./state.ts"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

const themes: ReadonlyArray<ViewerTheme> = ["light", "warm", "dark"]

const Button = ({
  title,
  active,
  onClick,
  children,
}: {
  title?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) => (
  <a
    role="button"
    tabIndex={0}
    {...logseq("seqno-pdf-button", active === true)}
    data-active={active === true}
    title={title}
    onClick={(event) => {
      event.stopPropagation()
      onClick()
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") onClick()
    }}
  >
    {children}
  </a>
)

const Toggle = ({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    {...logseq("seqno-pdf-switch", on)}
    onClick={onChange}
  />
)

const closeOnOutside = (box: HTMLElement | null, close: () => void, keep: string) => {
  if (box === null) return
  const listener = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element) || box.contains(target)) return
    if (target.closest(`[title="${keep}"]`) !== null) return
    if (target.closest("dialog") !== null) return
    close()
  }
  const timer = setTimeout(() => document.addEventListener("click", listener))
  box.focus()
  return () => {
    clearTimeout(timer)
    document.removeEventListener("click", listener)
  }
}

const escapeCloses = (close: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Escape") close()
}

const prValue = (value: unknown): string =>
  typeof value === "string"
    ? JSON.stringify(value)
    : value === null || value === undefined
      ? "nil"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)

const Metadata = ({
  info,
  onClose,
  notify,
}: {
  info: ReadonlyArray<readonly [string, unknown]>
  onClose: () => void
  notify: (message: string) => void
}) => (
  <dialog
    className="seqno-pdf-dialog"
    ref={(dialog) => {
      if (dialog !== null && !dialog.open) dialog.showModal()
    }}
    onClose={onClose}
  >
    <div {...logseq("seqno-pdf-docinfo")}>
      <div {...logseq("seqno-pdf-inner-text")}>
        {info.map(([key, value]) => (
          <p key={key}>
            <strong>{`${key}::`}</strong>
            {"  "}
            <i>{prValue(value)}</i>
          </p>
        ))}
      </div>
    </div>
    <div className="seqno-pdf-actions">
      <button
        type="button"
        onClick={(event) => {
          const text = event.currentTarget.closest("dialog")?.querySelector(".seqno-pdf-inner-text")
          const copied = text instanceof HTMLElement ? text.innerText.replace(/[\n\t]+/g, "\n") : ""
          void navigator.clipboard.writeText(copied).then(() => notify("Copied!"))
          onClose()
        }}
      >
        Copy all
      </button>
    </div>
  </dialog>
)

const Settings = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const [theme, setTheme] = useAtom(viewerTheme)
  const [dashed, setDashed] = useAtom(areaDashed)
  const [colored, setColored] = useAtom(blockColored)
  const [autoOpen, setAutoOpen] = useAtom(autoOpenMenu)
  const [info, setInfo] = useState<ReadonlyArray<readonly [string, unknown]> | null>(null)
  const showMetadata = () =>
    void session.document
      .getMetadata()
      .then((meta) => setInfo(Object.entries(meta.info)))
      .catch(() => undefined)
  return (
    <div {...logseq("seqno-pdf-settings")} data-visible>
      <div
        {...logseq("seqno-pdf-settings-inner")}
        tabIndex={-1}
        ref={(box) => closeOnOutside(box, onClose, "More settings")}
        onKeyUp={escapeCloses(onClose)}
      >
        <div {...logseq("seqno-pdf-theme-picker")}>
          {themes.map((it) => (
            <button
              type="button"
              key={it}
              {...logseq("seqno-pdf-theme", it)}
              data-viewer-theme={it}
              aria-label={it}
              onClick={() => setTheme(it)}
            >
              {theme === it ? <IconCheck size={16} aria-hidden /> : null}
            </button>
          ))}
        </div>
        <div {...logseq("seqno-pdf-toggle", false)}>
          <label>Dashed style for area highlight</label>
          <Toggle
            on={dashed}
            onChange={() => setDashed(!dashed)}
            label="Dashed style for area highlight"
          />
        </div>
        <div {...logseq("seqno-pdf-toggle", true)} data-between>
          <label>Colored label for highlight block</label>
          <Toggle
            on={colored}
            onChange={() => setColored(!colored)}
            label="Colored label for highlight block"
          />
        </div>
        <div {...logseq("seqno-pdf-toggle", true)} data-between>
          <label>Auto open context menu for selections</label>
          <Toggle
            on={autoOpen}
            onChange={() => setAutoOpen(!autoOpen)}
            label="Auto open context menu for selections"
          />
        </div>
        <div {...logseq("seqno-pdf-toggle", false)}>
          <a
            {...logseq("seqno-pdf-metadata-link")}
            title="Document metadata"
            onClick={showMetadata}
          >
            Document metadata
            <IconInfoCircle size={16} aria-hidden />
          </a>
        </div>
      </div>
      {info === null ? null : (
        <Metadata info={info} onClose={() => setInfo(null)} notify={session.host.notify} />
      )}
    </div>
  )
}

interface OutlineNode {
  readonly title: string
  readonly dest: unknown
  readonly items: ReadonlyArray<OutlineNode>
}

const OutlineItem = ({
  session,
  node,
  top,
}: {
  session: Session
  node: OutlineNode
  top: boolean
}) => {
  const [expanded, setExpanded] = useState(false)
  const children = node.items.length > 0
  return (
    <div
      {...logseq("seqno-pdf-outline-item", { parent: children, expanded })}
      data-parent={children}
      data-expanded={expanded}
    >
      <div {...logseq("seqno-pdf-inner")}>
        <a
          href="#"
          style={top ? { fontWeight: "bold" } : undefined}
          onClick={(event) => {
            event.preventDefault()
            if (event.target instanceof Element && event.target.closest("i") !== null) {
              setExpanded(!expanded)
            } else if (node.dest !== null && node.dest !== undefined) {
              const dest = node.dest
              if (typeof dest === "string" || Array.isArray(dest)) {
                void session.viewer?.linkService.goToDestination(dest)
              }
            }
          }}
        >
          <i {...logseq("seqno-pdf-arrow")}>
            <IconChevronRight size={16} aria-hidden />
          </i>
          <span>{node.title}</span>
        </a>
      </div>
      {children && expanded ? (
        <div {...logseq("seqno-pdf-children")}>
          {node.items.map((item, index) => (
            <OutlineItem key={index} session={session} node={item} top={false} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const HighlightsList = ({
  session,
  snapshot,
  navigate,
}: {
  session: Session
  snapshot: Snapshot
  navigate: Navigate
}) => {
  const [active, setActive] = useState<string | null>(null)
  const sorted = snapshot.highlights.toSorted((a, b) => a.page - b.page)
  const image = (highlight: Highlight) =>
    highlight.content.image === undefined
      ? undefined
      : session.host.resolveAsset(
          areaImagePath(session.asset.key, highlight.page, highlight.id, highlight.content.image),
        )
  return sorted.map((highlight) => (
    <div
      key={highlight.id}
      {...logseq("seqno-pdf-highlights-item", active === highlight.id)}
      data-active={active === highlight.id}
      onClick={() => {
        session.scrollTo(highlight)
        setActive(highlight.id)
      }}
      onDoubleClick={() => session.linkedReferences(highlight, navigate)}
    >
      <h6>
        <span>
          <small
            {...logseq("seqno-pdf-highlights-color", highlight.properties.color)}
            data-highlight-color={highlight.properties.color}
          />
          <strong>Page {highlight.page}</strong>
        </span>
        <button
          type="button"
          title="Linked references"
          onClick={(event) => {
            event.stopPropagation()
            session.linkedReferences(highlight, navigate)
          }}
        >
          <IconExternalLink size={14} aria-hidden />
        </button>
      </h6>
      {highlight.content.image === undefined ? (
        <p {...logseq("seqno-pdf-text-wrap")}>{highlight.content.text}</p>
      ) : (
        <p {...logseq("seqno-pdf-area-wrap")}>
          <img src={image(highlight)} alt="" />
        </p>
      )}
    </div>
  ))
}

const outlineOf = (
  items: ReadonlyArray<{ title: string; dest: unknown; items: ReadonlyArray<unknown> }>,
): ReadonlyArray<OutlineNode> =>
  items.map((item) => ({
    title: item.title,
    dest: item.dest,
    items: outlineOf(
      item.items.flatMap((child) =>
        typeof child === "object" && child !== null && "title" in child && "items" in child
          ? [
              {
                title: String(child.title),
                dest: "dest" in child ? child.dest : null,
                items: Array.isArray(child.items) ? child.items : [],
              },
            ]
          : [],
      ),
    ),
  }))

const Outline = ({
  session,
  snapshot,
  navigate,
  visible,
  outline,
  onClose,
}: {
  session: Session
  snapshot: Snapshot
  navigate: Navigate
  visible: boolean
  outline: ReadonlyArray<OutlineNode> | null
  onClose: () => void
}) => {
  const [tab, setTab] = useState<"contents" | "highlights">("contents")
  const close = () => {
    onClose()
    setTab("contents")
  }
  return (
    <div {...logseq("seqno-pdf-outline-wrap", visible)} data-visible={visible}>
      <div
        {...logseq("seqno-pdf-outline")}
        tabIndex={-1}
        ref={(box) => (visible ? closeOnOutside(box, close, "Outline") : undefined)}
        onKeyUp={escapeCloses(close)}
      >
        <div {...logseq("seqno-pdf-outline-tabs")}>
          <div {...logseq("seqno-pdf-inner")}>
            <button
              type="button"
              {...logseq("seqno-pdf-outline-tab", tab === "contents")}
              data-active={tab === "contents"}
              onClick={() => setTab("contents")}
            >
              Contents
            </button>
            <button
              type="button"
              {...logseq("seqno-pdf-outline-tab", tab === "highlights")}
              data-active={tab === "highlights"}
              onClick={() => setTab("highlights")}
            >
              Highlights
            </button>
          </div>
        </div>
        <div {...logseq("seqno-pdf-outline-panels")}>
          {tab === "contents" ? (
            outline !== null && outline.length > 0 ? (
              <section>
                {outline.map((node, index) => (
                  <OutlineItem key={index} session={session} node={node} top />
                ))}
              </section>
            ) : (
              <section {...logseq("seqno-pdf-outline-empty")}>No outlines</section>
            )
          ) : (
            <HighlightsList session={session} snapshot={snapshot} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  )
}

const Finder = ({ session, snapshot }: { session: Session; snapshot: Snapshot }) => {
  const [input, setInput] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [entered, setEntered] = useState(false)
  const close = () => {
    setInput("")
    setEntered(false)
    session.setFinder(false)
  }
  const find = (previous: boolean, type = "again") =>
    session.find(input, caseSensitive, previous, type)
  const status = snapshot.find.status
  return (
    <div {...logseq("seqno-pdf-finder-wrap")} data-visible>
      <div
        {...logseq("seqno-pdf-finder")}
        tabIndex={-1}
        ref={(box) => {
          if (box === null) return
          const listener = (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const value = box.querySelector("input")?.value ?? ""
            if (value.trim() !== "") return
            if (target.closest('[title="Search"]') !== null || box.contains(target)) return
            close()
          }
          document.addEventListener("click", listener)
          return () => document.removeEventListener("click", listener)
        }}
      >
        <div {...logseq("seqno-pdf-find-input-inner")}>
          <div {...logseq("seqno-pdf-find-input")}>
            <input
              placeholder="search"
              type="text"
              autoFocus
              value={input}
              onChange={(event) => {
                setInput(event.currentTarget.value)
                setEntered(false)
              }}
              onKeyUp={(event) => {
                if (event.key === "Enter") {
                  find(event.shiftKey)
                  setEntered(true)
                } else if (event.key === "Escape") {
                  if (input.trim() === "") close()
                  else {
                    session.resetFind()
                    setInput("")
                    setEntered(false)
                  }
                }
              }}
            />
            {input.trim() === "" ? null : (
              <button type="button" {...logseq("seqno-pdf-enter-icon")} title="Enter to search">
                <IconArrowBack size={14} aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            {...logseq("seqno-pdf-case", caseSensitive)}
            data-active={caseSensitive}
            aria-label="Match case"
            onClick={() => {
              setCaseSensitive(!caseSensitive)
              session.find(input, !caseSensitive, false, "casesensitivitychange")
            }}
          >
            <IconLetterCase size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Previous match" onClick={() => find(true)}>
            <IconChevronUp size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Next match" onClick={() => find(false)}>
            <IconChevronDown size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Close search" onClick={close}>
            <IconX size={16} aria-hidden />
          </button>
        </div>
        <div {...logseq("seqno-pdf-find-result")}>
          {entered && input.trim() !== "" && status !== null ? (
            status === "not-found" ? (
              <div {...logseq("seqno-pdf-not-found")}>Not found.</div>
            ) : (
              <div>
                {snapshot.find.current} of {snapshot.find.total}
                {` matches ("${snapshot.find.query}")`}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}

const Pager = ({ session, snapshot }: { session: Session; snapshot: Snapshot }) => {
  const [typed, setTyped] = useState<{ page: number; value: string } | null>(null)
  const shown = typed !== null && typed.page === snapshot.page ? typed.value : String(snapshot.page)
  return (
    <div {...logseq("seqno-pdf-pager")}>
      <span {...logseq("seqno-pdf-page-number")}>
        <input
          type="number"
          min={1}
          max={snapshot.pages}
          aria-label="Page number"
          {...logseq("seqno-pdf-page-input", Number(shown) > 999)}
          data-long={Number(shown) > 999}
          value={shown}
          onMouseEnter={(event) => event.currentTarget.select()}
          onChange={(event) => setTyped({ page: snapshot.page, value: event.currentTarget.value })}
          onKeyUp={(event) => {
            const value = Number.parseInt(event.currentTarget.value, 10)
            if (event.key === "Enter" && value > 0) {
              setTyped(null)
              session.goToPage(value)
            }
          }}
        />
        <small>/ {snapshot.pages}</small>
      </span>
      <span {...logseq("seqno-pdf-page-buttons")}>
        <Button onClick={() => session.previousPage()} title="Previous page">
          <IconArrowNarrowUp size={16} aria-hidden />
        </Button>
        <Button onClick={() => session.nextPage()} title="Next page">
          <IconArrowNarrowDown size={16} aria-hidden />
        </Button>
      </span>
    </div>
  )
}

export const Toolbar = ({
  session,
  snapshot,
  host,
}: {
  session: Session
  snapshot: Snapshot
  host: PdfHost
}) => {
  const registry = useContext(RegistryContext)
  const [area, setArea] = useAtom(areaMode)
  const [highlighting, setHighlighting] = useAtom(highlightMode)
  const [outline, setOutline] = useState(false)
  const [contents, setContents] = useState<ReadonlyArray<OutlineNode> | null>(null)
  const [settings, setSettings] = useState(false)
  const toggleOutline = () => {
    if (!outline && contents === null) {
      void session.document
        .getOutline()
        .then((items) => setContents(outlineOf(items ?? [])))
        .catch(() => setContents([]))
    }
    setOutline(!outline)
  }
  return (
    <div {...logseq("seqno-pdf-header")}>
      <div {...logseq("seqno-pdf-toolbar")}>
        <div {...logseq("seqno-pdf-inner")}>
          <div {...logseq("seqno-pdf-buttons")}>
            <Button title="More settings" onClick={() => setSettings(!settings)}>
              <IconAdjustmentsHorizontal size={18} aria-hidden />
            </Button>
            <Button
              title={`Area highlight (${isMac ? "⌘" : "Shift"})`}
              active={area}
              onClick={() => setArea(!area)}
            >
              <IconMarquee2 size={18} aria-hidden />
            </Button>
            <Button
              title="Highlight mode"
              active={highlighting}
              onClick={() => setHighlighting(!highlighting)}
            >
              <IconHighlight size={16} aria-hidden />
            </Button>
            <Button title="Zoom out" onClick={() => session.zoomOut()}>
              <IconZoomOut size={18} aria-hidden />
            </Button>
            <Button title="Zoom in" onClick={() => session.zoomIn()}>
              <IconZoomIn size={18} aria-hidden />
            </Button>
            <Button title="Outline" onClick={toggleOutline}>
              <IconListDetails size={16} aria-hidden />
            </Button>
            <Button title="Search" onClick={() => session.setFinder(!snapshot.finder)}>
              <IconSearch size={18} aria-hidden />
            </Button>
            <Button
              title="Annotations page"
              onClick={() => host.navigate({ _tag: "Page", name: hlsPageTitle(session.asset.key) })}
            >
              <IconNotes size={16} aria-hidden />
            </Button>
            <Pager session={session} snapshot={snapshot} />
            <Button onClick={() => closePdf(registry)}>Close</Button>
          </div>
        </div>
        <Outline
          session={session}
          snapshot={snapshot}
          navigate={host.navigate}
          visible={outline}
          outline={contents}
          onClose={() => setOutline(false)}
        />
        {snapshot.finder ? <Finder session={session} snapshot={snapshot} /> : null}
        {settings ? <Settings session={session} onClose={() => setSettings(false)} /> : null}
      </div>
    </div>
  )
}

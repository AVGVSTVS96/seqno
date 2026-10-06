import { IconCalendar, IconFile, IconHash, IconPlus, IconPointFilled } from "@tabler/icons-react"
import { useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { EditorView } from "@codemirror/view"
import { accept, pick, type PopupFrame } from "./completion.ts"
import type { Range } from "./fuzzy.ts"
import { Choice, type Popup } from "./popup.ts"

const labels: Readonly<Record<Popup["kind"], string>> = {
  Page: "Search for a page",
  Tag: "Search for a tag",
  Block: "Search for a block",
  Slash: "Commands",
}

const merged = (ranges: ReadonlyArray<Range>): ReadonlyArray<Range> =>
  ranges
    .toSorted((left, right) => left[0] - right[0])
    .reduce<Array<Range>>((out, range) => {
      const last = out.at(-1)
      if (last !== undefined && range[0] <= last[1]) {
        out[out.length - 1] = [last[0], Math.max(last[1], range[1])]
      } else out.push(range)
      return out
    }, [])

const Marked = ({
  text,
  ranges,
}: {
  readonly text: string
  readonly ranges: ReadonlyArray<Range>
}) => {
  const parts: Array<ReactNode> = []
  let at = 0
  for (const [from, to] of merged(ranges)) {
    if (from > at) parts.push(text.slice(at, from))
    parts.push(<mark key={from}>{text.slice(from, to)}</mark>)
    at = to
  }
  if (at < text.length) parts.push(text.slice(at))
  return <span className="sq-popup-text">{parts}</span>
}

const Icon = ({ children }: { readonly children: ReactNode }) => (
  <span className="sq-popup-icon" aria-hidden>
    {children}
  </span>
)

const small = { size: 14, stroke: 2 } as const

const Content = ({ choice, popup }: { readonly choice: Choice; readonly popup: Popup }) =>
  Choice.$match(choice, {
    Command: ({ command }) => (
      <span className="sq-popup-command">
        <span className="sq-popup-command-icon" aria-hidden>
          <command.icon size={18} stroke={2} />
        </span>
        <span className="sq-popup-text">{command.label}</span>
      </span>
    ),
    Page: ({ title, ranges }) => (
      <span className="sq-popup-entry">
        <Icon>{popup.kind === "Tag" ? <IconHash {...small} /> : <IconFile {...small} />}</Icon>
        <Marked text={title} ranges={ranges} />
      </span>
    ),
    NewPage: ({ title }) => (
      <span className="sq-popup-entry">
        <Icon>
          <IconPlus {...small} />
        </Icon>
        <span className="sq-popup-text">
          {popup.kind === "Tag" ? "New tag" : "New page"} {title}
        </span>
      </span>
    ),
    Journal: ({ label }) => (
      <span className="sq-popup-entry">
        <Icon>
          <IconCalendar {...small} />
        </Icon>
        <span className="sq-popup-text">{label}</span>
      </span>
    ),
    Block: ({ hit, text, ranges }) => (
      <span className="sq-popup-block">
        <span className="sq-popup-crumb">{hit.path.join(" / ")}</span>
        <span className="sq-popup-entry">
          <Icon>
            <IconPointFilled {...small} />
          </Icon>
          <Marked text={text} ranges={ranges} />
        </span>
      </span>
    ),
  })

const reveal = (row: HTMLDivElement | null) => row?.scrollIntoView({ block: "nearest" })

const Row = ({
  view,
  popup,
  choice,
  index,
}: {
  readonly view: EditorView
  readonly popup: Popup
  readonly choice: Choice
  readonly index: number
}) => {
  const pointer = useRef<string | null>(null)
  const active = popup.active === index
  return (
    <div
      role="option"
      aria-selected={active}
      className="sq-popup-row"
      ref={active && !popup.pointer ? reveal : undefined}
      onPointerMove={(event) => {
        const at = `${event.clientX},${event.clientY}`
        if (pointer.current === at) return
        pointer.current = at
        if (!active) pick(view, index)
      }}
      onClick={() => accept(view, index)}
    >
      <Content choice={choice} popup={popup} />
    </div>
  )
}

const groupsOf = (popup: Popup) =>
  popup.choices.reduce<Array<{ readonly name: string; readonly rows: Array<number> }>>(
    (groups, choice, index) => {
      const name = choice._tag === "Command" ? choice.command.group : ""
      const last = groups.at(-1)
      if (last?.name === name) last.rows.push(index)
      else groups.push({ name, rows: [index] })
      return groups
    },
    [],
  )

export const PopupView = ({ frame }: { readonly frame: PopupFrame }) => {
  const { popup, view, dom } = frame
  if (popup.choices.length === 0) return null
  const row = (index: number) => {
    const choice = popup.choices[index]
    return choice === undefined ? null : (
      <Row key={index} view={view} popup={popup} choice={choice} index={index} />
    )
  }
  const grouped = popup.kind === "Slash" && popup.query === ""
  return createPortal(
    <div
      key={`${popup.kind}:${popup.from}`}
      className={`sq-popup sq-popup-${popup.kind.toLowerCase()}`}
      role="listbox"
      aria-label={labels[popup.kind]}
      onMouseDown={(event) => event.preventDefault()}
    >
      {grouped
        ? groupsOf(popup).map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div className="sq-popup-group" aria-hidden>
                {group.name}
              </div>
              {group.rows.map(row)}
            </div>
          ))
        : popup.choices.map((_, index) => row(index))}
    </div>,
    dom,
  )
}

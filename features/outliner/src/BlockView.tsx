import { use, useState, type MouseEvent, type ReactNode } from "react"
import { Match } from "effect"
import { clockTotal, type BlockContent, type Body, type Inline, type Marker } from "@seqno/syntax"
import { CodeBlock } from "./CodeBlock.tsx"
import { Inlines } from "./Inline.tsx"
import { RenderContext, toPage } from "./render.ts"
import { isCanceled, switchable, taskState } from "./tasks.ts"

const stop = (event: MouseEvent) => event.stopPropagation()

const Heading = ({
  level,
  className,
  children,
}: {
  readonly level: number
  readonly className?: string | undefined
  readonly children: ReactNode
}) => {
  const classes = `seqno-heading seqno-h${Math.min(level, 6)}${className === undefined ? "" : ` ${className}`}`
  return Match.value(level).pipe(
    Match.when(1, () => <h1 className={classes}>{children}</h1>),
    Match.when(2, () => <h2 className={classes}>{children}</h2>),
    Match.when(3, () => <h3 className={classes}>{children}</h3>),
    Match.when(4, () => <h4 className={classes}>{children}</h4>),
    Match.when(5, () => <h5 className={classes}>{children}</h5>),
    Match.orElse(() => <h6 className={classes}>{children}</h6>),
  )
}

const BodyView = ({ body }: { readonly body: Body }) =>
  Match.valueTags(body, {
    Paragraph: ({ inline }) => (
      <div className="seqno-line">
        <Inlines nodes={inline} />
      </div>
    ),
    Heading: ({ level, inline }) => (
      <Heading level={level}>
        <Inlines nodes={inline} />
      </Heading>
    ),
    Code: ({ language, code }) => <CodeBlock language={language} code={code} />,
    Quote: ({ lines }) => (
      <blockquote className="seqno-quote">
        {lines.map((line, index) => (
          <div key={index} className="seqno-line">
            <Inlines nodes={line} />
          </div>
        ))}
      </blockquote>
    ),
  })

const TaskControls = ({
  marker,
  onMarker,
}: {
  readonly marker: Marker
  readonly onMarker: (marker: Marker | null) => void
}) => {
  const next = switchable[marker]
  const done = marker === "DONE"
  return (
    <>
      {isCanceled(marker) ? null : (
        <input
          type="checkbox"
          className="seqno-checkbox"
          aria-label={done ? "Mark as not done" : "Mark as done"}
          checked={done}
          onClick={stop}
          onChange={(event) => onMarker(event.currentTarget.checked ? "DONE" : "TODO")}
        />
      )}
      {done || isCanceled(marker) ? null : next === undefined ? (
        <span className="seqno-marker">{marker}</span>
      ) : (
        <a
          href="#"
          className="seqno-marker is-switch"
          title={`Change ${marker} to ${next}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onMarker(next)
          }}
        >
          {marker}
        </a>
      )}
    </>
  )
}

const Title = ({
  content,
  title,
  onMarker,
}: {
  readonly content: BlockContent
  readonly title: ReadonlyArray<Inline>
  readonly onMarker: (marker: Marker | null) => void
}) => {
  const inner = (
    <>
      {content.marker === null ? null : (
        <TaskControls marker={content.marker} onMarker={onMarker} />
      )}
      <Inlines nodes={title} />
    </>
  )
  const state = taskState(content.marker)
  return content.heading === null ? (
    <div className="seqno-title" data-task={state}>
      {inner}
    </div>
  ) : (
    <Heading level={content.heading} className={state === undefined ? undefined : `is-${state}`}>
      {inner}
    </Heading>
  )
}

const Logbook = ({ entries }: { readonly entries: ReadonlyArray<string> }) => (
  <div className="seqno-drawer" onClick={stop}>
    <div className="seqno-drawer-name">:LOGBOOK:</div>
    {entries.map((entry, index) => (
      <div key={index} className="seqno-drawer-line">
        {entry}
      </div>
    ))}
  </div>
)

export const BlockView = ({
  content,
  onMarker,
}: {
  readonly content: BlockContent
  readonly onMarker: (marker: Marker | null) => void
}) => {
  const renderer = use(RenderContext)
  const [drawer, setDrawer] = useState(false)
  const logbook = content.logbook
  const clocked = logbook !== null && logbook.seconds > 0
  const empty =
    content.title === null &&
    content.body.length === 0 &&
    content.properties.length === 0 &&
    content.planning.length === 0
  return (
    <div className="seqno-block">
      {content.title === null && !clocked && !empty ? null : (
        <div className="seqno-title-row">
          {content.title === null ? (
            <div className="seqno-title" />
          ) : (
            <Title content={content} title={content.title} onMarker={onMarker} />
          )}
          {clocked ? (
            <a
              href="#"
              className="seqno-clock"
              aria-expanded={drawer}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setDrawer(!drawer)
              }}
            >
              {clockTotal(logbook.seconds)}
            </a>
          ) : null}
        </div>
      )}
      {drawer && logbook !== null ? <Logbook entries={logbook.entries} /> : null}
      {content.planning.map((entry) => (
        <div key={entry.span.from} className="seqno-planning">
          <span className="seqno-planning-label">{entry.kind}: </span>
          <span className="seqno-planning-date">&lt;{entry.date}&gt;</span>
        </div>
      ))}
      {content.properties.length === 0 ? null : (
        <div className="seqno-attrs">
          {content.properties.map((property) => (
            <div key={property.span.from} className="seqno-attr">
              <a
                href="#"
                className="seqno-attr-key"
                onClick={toPage(renderer.navigate, property.key)}
              >
                {property.key}
              </a>
              <span className="seqno-attr-colon">:</span>
              <span className="seqno-attr-value">
                <Inlines nodes={property.value} />
              </span>
            </div>
          ))}
        </div>
      )}
      {content.body.map((body) => (
        <BodyView key={body.span.from} body={body} />
      ))}
    </div>
  )
}

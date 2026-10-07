import { use, useState, type MouseEvent, type ReactNode } from "react"
import { Match } from "effect"
import type { Props } from "@seqno/domain"
import {
  clockTotal,
  isHiddenProperty,
  propertyValue,
  type BlockContent,
  type Body,
  type Inline,
  type Marker,
} from "@seqno/syntax"
import { CodeBlock } from "./CodeBlock.tsx"
import { Inlines } from "./Inline.tsx"
import { clickOnEnter, RenderContext, toPage } from "./render.ts"
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

type CodeChange = (from: number, to: number, insert: string) => void

const BodyView = ({ body, onCode }: { readonly body: Body; readonly onCode?: CodeChange }) =>
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
    Code: ({ language, code, codeFrom }) => (
      <CodeBlock
        language={language}
        code={code}
        {...(onCode === undefined
          ? {}
          : { onEdit: (next: string) => onCode(codeFrom, codeFrom + code.length, next) })}
      />
    ),
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
          role="link"
          tabIndex={0}
          onKeyDown={clickOnEnter}
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

const namedColors = new Set(["yellow", "red", "pink", "green", "blue", "purple", "gray"])

const backgroundOf = (props: Props): string | null => {
  const value = (props["background-color"] ?? props["background_color"] ?? "").trim()
  if (namedColors.has(value)) return `var(--bg-highlight-${value})`
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : null
}

const Title = ({
  content,
  title,
  background,
  onMarker,
}: {
  readonly content: BlockContent
  readonly title: ReadonlyArray<Inline>
  readonly background: string | null
  readonly onMarker: (marker: Marker | null) => void
}) => {
  const parts = (
    <>
      {content.marker === null ? null : (
        <TaskControls marker={content.marker} onMarker={onMarker} />
      )}
      <Inlines nodes={title} />
    </>
  )
  const inner =
    background === null ? (
      parts
    ) : (
      <span className="seqno-block-bg" style={{ backgroundColor: background }}>
        {parts}
      </span>
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

const shownProperties = (props: Props, content: BlockContent) => [
  ...Object.entries(props).flatMap(([key, value]) =>
    isHiddenProperty(key) ? [] : [{ key, value: propertyValue(key, value) }],
  ),
  ...content.properties,
]

export const BlockView = ({
  content,
  props,
  onMarker,
  onCode,
}: {
  readonly content: BlockContent
  readonly props: Props
  readonly onMarker: (marker: Marker | null) => void
  readonly onCode?: CodeChange
}) => {
  const renderer = use(RenderContext)
  const [drawer, setDrawer] = useState(false)
  const logbook = content.logbook
  const clocked = logbook !== null && logbook.seconds > 0
  const properties = shownProperties(props, content)
  const empty =
    content.title === null &&
    content.body.length === 0 &&
    properties.length === 0 &&
    content.planning.length === 0
  return (
    <div className="seqno-block">
      {content.title === null && !clocked && !empty ? null : (
        <div className="seqno-title-row">
          {content.title === null ? (
            <div className="seqno-title" />
          ) : (
            <Title
              content={content}
              title={content.title}
              background={backgroundOf(props)}
              onMarker={onMarker}
            />
          )}
          {clocked ? (
            <a
              role="link"
              tabIndex={0}
              onKeyDown={clickOnEnter}
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
      {properties.length === 0 ? null : (
        <div className="seqno-attrs">
          {properties.map((property) => (
            <div key={property.key} className="seqno-attr">
              <a
                role="link"
                tabIndex={0}
                onKeyDown={clickOnEnter}
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
        <BodyView key={body.span.from} body={body} {...(onCode === undefined ? {} : { onCode })} />
      ))}
    </div>
  )
}

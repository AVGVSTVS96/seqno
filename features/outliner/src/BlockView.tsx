import {
  IconAlertCircleFilled,
  IconAlertTriangleFilled,
  IconBulbFilled,
  IconFlameFilled,
  IconInfoCircleFilled,
  IconPinnedFilled,
} from "@tabler/icons-react"
import { use, useState, type MouseEvent, type ReactNode } from "react"
import { Match } from "effect"
import { logseq, names } from "@seqno/dom"
import type { Block, Props } from "@seqno/domain"
import {
  clockTotal,
  isHiddenProperty,
  propertyValue,
  type AdmonitionKind,
  type BlockContent,
  type Body,
  type Inline,
  type Marker,
  type PropertyConfig,
} from "@seqno/syntax"
import { AnnotationPrefix, annotationNames, isAnnotation, isAreaAnnotation } from "./Annotation.tsx"
import { CodeBlock } from "./CodeBlock.tsx"
import { Inlines } from "./Inline.tsx"
import { Latex } from "./Math.tsx"
import {
  BlockSource,
  clickOnEnter,
  CodeSlot,
  HostBlock,
  PropertySettings,
  RenderContext,
  toPage,
} from "./render.ts"
import { isCanceled, switchable, taskState } from "./tasks.ts"

const stop = (event: MouseEvent) => event.stopPropagation()

const Heading = ({
  level,
  marker = null,
  children,
}: {
  readonly level: number
  readonly marker?: Marker | null
  readonly children: ReactNode
}) => {
  const props = {
    className: names(logseq("seqno-heading", marker).className, `seqno-h${Math.min(level, 6)}`),
    "data-task": taskState(marker),
  }
  return Match.value(level).pipe(
    Match.when(1, () => <h1 {...props}>{children}</h1>),
    Match.when(2, () => <h2 {...props}>{children}</h2>),
    Match.when(3, () => <h3 {...props}>{children}</h3>),
    Match.when(4, () => <h4 {...props}>{children}</h4>),
    Match.when(5, () => <h5 {...props}>{children}</h5>),
    Match.orElse(() => <h6 {...props}>{children}</h6>),
  )
}

type CodeChange = (from: number, to: number, insert: string) => void

const admonitionIcons = {
  note: IconInfoCircleFilled,
  tip: IconBulbFilled,
  important: IconAlertCircleFilled,
  caution: IconFlameFilled,
  warning: IconAlertTriangleFilled,
  pinned: IconPinnedFilled,
} satisfies Record<AdmonitionKind, unknown>

const Admonition = ({
  kind,
  lines,
}: {
  readonly kind: AdmonitionKind
  readonly lines: ReadonlyArray<ReadonlyArray<Inline>>
}) => {
  const Icon = admonitionIcons[kind]
  return (
    <div {...logseq("seqno-admonition", kind)} data-kind={kind}>
      <div {...logseq("seqno-admonition-icon")} title={`${kind[0]?.toUpperCase()}${kind.slice(1)}`}>
        <Icon {...logseq("seqno-admonition-svg", kind)} aria-hidden />
      </div>
      <div {...logseq("seqno-admonition-body")}>
        {lines.map((line, index) => (
          <div key={index} className="seqno-line">
            <Inlines nodes={line} />
          </div>
        ))}
      </div>
    </div>
  )
}

const BodyView = ({ body, onCode }: { readonly body: Body; readonly onCode?: CodeChange }) => {
  const Rendered = use(CodeSlot)
  return Match.valueTags(body, {
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
    Code: ({ language, code, codeFrom }) => {
      const source = (
        <CodeBlock
          language={language}
          code={code}
          {...(onCode === undefined
            ? {}
            : { onEdit: (next: string) => onCode(codeFrom, codeFrom + code.length, next) })}
        />
      )
      return Rendered === null ? (
        source
      ) : (
        <Rendered language={language} code={code}>
          {source}
        </Rendered>
      )
    },
    Admonition: ({ kind, lines }) => <Admonition kind={kind} lines={lines} />,
    Math: ({ tex, span }) => <Latex tex={tex} block caret={span.to} />,
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
}

const TaskControls = ({
  marker,
  onMarker,
}: {
  readonly marker: Marker
  readonly onMarker: (marker: Marker | null) => void
}) => {
  const { readOnly } = use(RenderContext)
  const next = readOnly ? undefined : switchable[marker]
  const done = marker === "DONE"
  return (
    <>
      {isCanceled(marker) ? null : (
        <input
          type="checkbox"
          {...logseq("seqno-checkbox", done)}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          checked={done}
          disabled={readOnly}
          onClick={stop}
          onChange={(event) => onMarker(event.currentTarget.checked ? "DONE" : "TODO")}
        />
      )}
      {done || isCanceled(marker) ? null : next === undefined ? (
        <span {...logseq("seqno-marker", { marker, switchable: false })}>{marker}</span>
      ) : (
        <a
          role="link"
          tabIndex={0}
          onKeyDown={clickOnEnter}
          {...logseq("seqno-marker", { marker, switchable: true })}
          data-switch
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
  annotation,
}: {
  readonly content: BlockContent
  readonly title: ReadonlyArray<Inline>
  readonly background: string | null
  readonly onMarker: (marker: Marker | null) => void
  readonly annotation: Block | null
}) => {
  const area = annotation !== null && isAreaAnnotation(annotation.props)
  const prefix = annotation === null ? null : <AnnotationPrefix block={annotation} />
  const parts = (
    <>
      {content.marker === null ? null : (
        <TaskControls marker={content.marker} onMarker={onMarker} />
      )}
      {area ? null : prefix}
      <Inlines nodes={title} />
      {area ? prefix : null}
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
  return content.heading === null ? (
    <div {...logseq("seqno-title", content.marker)} data-task={taskState(content.marker)}>
      {inner}
    </div>
  ) : (
    <Heading level={content.heading} marker={content.marker}>
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

const shownProperties = (props: Props, content: BlockContent, config: PropertyConfig) => [
  ...Object.entries(props).flatMap(([key, value]) =>
    isHiddenProperty(key) ? [] : [{ key, value: propertyValue(key, value, 0, config) }],
  ),
  ...content.properties,
]

const blankAreaTitle = (block: Block) =>
  isAreaAnnotation(block.props) && (block.text.split("\n")[0] ?? "").trim() === "[:span]"

export const BlockView = ({
  content,
  props,
  onMarker,
  onCode,
  block,
}: {
  readonly content: BlockContent
  readonly props: Props
  readonly onMarker: (marker: Marker | null) => void
  readonly onCode?: CodeChange
  readonly block?: Block
}) => {
  const annotation = block !== undefined && isAnnotation(block.props) ? block : null
  const title = annotation !== null && blankAreaTitle(annotation) ? [] : content.title
  const marks = annotation === null ? null : annotationNames(annotation.props)
  const titleNames =
    annotation === null
      ? null
      : logseq("seqno-annotation-title", { area: isAreaAnnotation(annotation.props) })
  const renderer = use(RenderContext)
  const host = use(HostBlock)
  const blockNames = logseq("seqno-block", host)
  const rowNames = logseq("seqno-title-row")
  const [drawer, setDrawer] = useState(false)
  const logbook = content.logbook
  const clocked = logbook !== null && logbook.seconds > 0
  const properties = shownProperties(props, content, use(PropertySettings))
  const empty =
    content.title === null &&
    content.body.length === 0 &&
    properties.length === 0 &&
    content.planning.length === 0
  return (
    <BlockSource value={onCode ?? null}>
      <div
        {...blockNames}
        {...marks?.attributes}
        className={names(blockNames.className, marks?.className)}
      >
        {title === null && !clocked && !empty ? null : (
          <div
            {...titleNames}
            {...rowNames}
            className={names(rowNames.className, titleNames?.className)}
          >
            {title === null ? (
              <div className="seqno-title" />
            ) : (
              <Title
                content={content}
                title={title}
                background={backgroundOf(props)}
                onMarker={onMarker}
                annotation={annotation}
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
          <div key={entry.span.from} {...logseq("seqno-planning")}>
            <span className="seqno-planning-label">{entry.kind}: </span>
            <span className="seqno-planning-date">&lt;{entry.date}&gt;</span>
          </div>
        ))}
        {properties.length === 0 ? null : (
          <div {...logseq("seqno-attrs")}>
            {properties.map((property) => (
              <div key={property.key} className="seqno-attr">
                <a
                  role="link"
                  tabIndex={0}
                  onKeyDown={clickOnEnter}
                  {...logseq("seqno-attr-key")}
                  onClick={toPage(renderer.navigate, property.key)}
                >
                  {property.key}
                </a>
                <span className="seqno-attr-colon">:</span>
                <span {...logseq("seqno-attr-value")}>
                  <Inlines nodes={property.value} />
                </span>
              </div>
            ))}
          </div>
        )}
        {content.body.length === 0 ? null : (
          <div {...logseq("seqno-body")}>
            {content.body.map((body) => (
              <BodyView
                key={body.span.from}
                body={body}
                {...(onCode === undefined ? {} : { onCode })}
              />
            ))}
          </div>
        )}
      </div>
    </BlockSource>
  )
}

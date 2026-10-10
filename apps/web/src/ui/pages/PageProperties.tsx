import { RegistryContext, useAtomSet } from "@effect/atom-react"
import { Effect, Stream } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { Fragment, useContext, useState, type ReactNode } from "react"
import { BlockId, normalizePageName, type Page } from "@seqno/domain"
import { BlockEditor, createHandoff, type EditorHost } from "@seqno/editor"
import { analyzeBlock } from "@seqno/syntax"
import { dispatch, dispatchAll, pages } from "../../atoms.ts"
import { referencedOnly } from "./atoms.ts"
import { isHiddenPageProp, listValues, visibleProps } from "./model.ts"
import { PageLink } from "./PageLink.tsx"

const listKeys = new Set(["alias", "tags"])

const refTo = (name: string, children: ReactNode) => (
  <PageLink page={{ name: normalizePageName(name), title: name }} className="seqno-ref">
    {children}
  </PageLink>
)

const InlineValue = ({ value }: { readonly value: string }) => {
  const parts: Array<ReactNode> = []
  let at = 0
  for (const ref of analyzeBlock(value).refs) {
    if (ref._tag === "BlockRef") continue
    parts.push(value.slice(at, ref.span.from))
    parts.push(
      ref._tag === "PageRef" ? (
        <span key={ref.span.from}>
          <span className="seqno-ref-bracket">[[</span>
          {refTo(ref.name, ref.name)}
          <span className="seqno-ref-bracket">]]</span>
        </span>
      ) : (
        <Fragment key={ref.span.from}>{refTo(ref.name, `#${ref.name}`)}</Fragment>
      ),
    )
    at = ref.span.to
  }
  parts.push(value.slice(at))
  return <>{parts}</>
}

const ListValue = ({ value }: { readonly value: string }) => (
  <>
    {listValues(value).map((name, index) => (
      <Fragment key={name}>
        {index > 0 ? ", " : null}
        {refTo(name, name)}
      </Fragment>
    ))}
  </>
)

const handoff = createHandoff()

const PropertiesEditor = ({
  page,
  onExit,
}: {
  readonly page: Page
  readonly onExit: () => void
}) => {
  const run = useAtomSet(dispatch)
  const runAll = useAtomSet(dispatchAll)
  const registry = useContext(RegistryContext)
  const host: EditorHost = {
    dispatch: (command) => {
      if (command._tag === "SetProperty") run(command)
    },
    dispatchAll: (commands) => runAll(commands.filter((command) => command._tag === "SetProperty")),
    act: (action) => {
      if (action._tag === "Exit") onExit()
    },
    searchPages: () =>
      AtomRegistry.getResult(registry, pages).pipe(
        Effect.orElseSucceed(() => []),
        Effect.map((real) => [...real, ...registry.get(referencedOnly)]),
      ),
    searchBlocks: () => Effect.succeed([]),
  }
  return (
    <div
      className="seqno-page-properties-editor"
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node && event.currentTarget.contains(next))) onExit()
      }}
    >
      <BlockEditor
        block={{
          id: BlockId.make(page.id),
          pageId: page.id,
          parentId: null,
          text: "",
          collapsed: false,
          props: page.props,
        }}
        cursor={{ _tag: "End" }}
        updates={Stream.never}
        host={host}
        handoff={handoff}
        properties={{ _tag: "PageTarget", pageId: page.id }}
        hidden={isHiddenPageProp}
      />
    </div>
  )
}

export const PageProperties = ({ page }: { readonly page: Page }) => {
  const [editing, setEditing] = useState(false)
  const props = visibleProps(page.props)
  if (props.length === 0) return null
  return (
    <div className="seqno-page-properties">
      <div className="seqno-page-properties-control" aria-hidden>
        <span className="seqno-page-properties-bullet" />
      </div>
      {editing ? (
        <PropertiesEditor page={page} onExit={() => setEditing(false)} />
      ) : (
        <dl
          className="seqno-properties"
          aria-label="Page properties"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a") !== null) return
            setEditing(true)
          }}
        >
          {props.map(([key, value]) => (
            <div key={key} className="seqno-property">
              <dt>
                <PageLink
                  page={{ name: normalizePageName(key), title: key }}
                  className="seqno-property-key"
                />
              </dt>
              <dd>
                {listKeys.has(key.toLowerCase()) ? (
                  <ListValue value={value} />
                ) : (
                  <InlineValue value={value} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

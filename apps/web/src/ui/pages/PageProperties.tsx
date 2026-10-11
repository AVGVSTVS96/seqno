import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Effect, Exit, Stream } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { useContext, useState } from "react"
import { BlockId, normalizePageName, type Page } from "@seqno/domain"
import { BlockEditor, createHandoff, type EditorHost } from "@seqno/editor"
import { PropertyValue } from "@seqno/outliner"
import { assetResolver, dispatch, dispatchAll, pages } from "../../atoms.ts"
import { EditorSlot } from "../EditorSlot.tsx"
import { referencedOnly } from "./atoms.ts"
import { isHiddenPageProp, visibleProps } from "./model.ts"
import { useNavigateTo } from "./navigation.ts"
import { PageLink } from "./PageLink.tsx"

const handoff = createHandoff()

const PropertiesEditor = ({
  page,
  onExit,
}: {
  readonly page: Page
  readonly onExit: () => void
}) => {
  const run = useAtomSet(dispatch)
  const runAll = useAtomSet(dispatchAll, { mode: "promiseExit" })
  const registry = useContext(RegistryContext)
  const host: EditorHost = {
    dispatch: (command) => {
      if (command._tag === "SetProperty") run(command)
    },
    dispatchAll: (commands) =>
      runAll(commands.filter((command) => command._tag === "SetProperty")).then(Exit.isSuccess),
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
  const navigateTo = useNavigateTo()
  const resolveAsset = useAtomValue(assetResolver)
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
                <PropertyValue
                  name={key}
                  value={value}
                  onNavigate={navigateTo}
                  editor={EditorSlot}
                  resolveAsset={resolveAsset}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

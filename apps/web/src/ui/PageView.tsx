import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Match, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { normalizePageName, type BlockId, type Page } from "@seqno/domain"
import { Outliner, type NavigationTarget } from "@seqno/outliner"
import { dispatch, pageNamed } from "../atoms.ts"
import { EditorSlot } from "./EditorSlot.tsx"

export const PageView = ({
  page,
  zoom,
}: {
  readonly page: Page
  readonly zoom: BlockId | null
}) => {
  const run = useAtomSet(dispatch)
  const navigate = useNavigate()
  const heading = useId()
  const starred = page.props["favorite"] === "true"
  const onNavigate = Match.type<NavigationTarget>().pipe(
    Match.tagsExhaustive({
      Page: ({ name }) =>
        navigate({ to: "/page/$name", params: { name: normalizePageName(name) } }),
      Zoom: ({ blockId }) =>
        navigate({
          to: "/page/$name",
          params: { name: page.name },
          search: blockId === null ? {} : { zoom: blockId },
        }),
    }),
  )
  return (
    <article className="page" aria-labelledby={heading}>
      <header className="page-header">
        <h1 id={heading}>
          <Link to="/page/$name" params={{ name: page.name }}>
            {page.title}
          </Link>
        </h1>
        <button
          type="button"
          className="ghost star"
          aria-pressed={starred}
          onClick={() =>
            run({
              _tag: "SetProperty",
              target: { _tag: "PageTarget", pageId: page.id },
              key: "favorite",
              value: starred ? null : "true",
            })
          }
        >
          {starred ? "Unstar" : "Star"}
        </button>
      </header>
      <Outliner pageId={page.id} zoom={zoom} onNavigate={onNavigate} editor={EditorSlot} />
    </article>
  )
}

export const PageByName = ({
  name,
  zoom,
}: {
  readonly name: string
  readonly zoom: BlockId | null
}) =>
  AsyncResult.match(useAtomValue(pageNamed(name)), {
    onInitial: () => <p className="hint">Loading…</p>,
    onFailure: () => <p className="problem">The page list could not be read.</p>,
    onSuccess: (found) =>
      Option.match(found.value, {
        onNone: () => <p className="hint">No page named “{name}” yet.</p>,
        onSome: (page) => <PageView page={page} zoom={zoom} />,
      }),
  })

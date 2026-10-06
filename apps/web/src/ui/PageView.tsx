import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Page } from "@seqno/domain"
import { dispatch, pageNamed } from "../atoms.ts"
import { OutlinerPlaceholder } from "./OutlinerPlaceholder.tsx"

export const PageView = ({ page }: { readonly page: Page }) => {
  const run = useAtomSet(dispatch)
  const starred = page.props["favorite"] === "true"
  return (
    <article className="page">
      <header className="page-header">
        <h1>
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
      <OutlinerPlaceholder pageId={page.id} />
    </article>
  )
}

export const PageByName = ({ name }: { readonly name: string }) =>
  AsyncResult.match(useAtomValue(pageNamed(name)), {
    onInitial: () => <p className="hint">Loading…</p>,
    onFailure: () => <p className="problem">The page list could not be read.</p>,
    onSuccess: (found) =>
      Option.match(found.value, {
        onNone: () => <p className="hint">No page named “{name}” yet.</p>,
        onSome: (page) => <PageView page={page} />,
      }),
  })

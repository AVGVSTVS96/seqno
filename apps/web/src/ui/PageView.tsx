import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { normalizePageName, type BlockId, type Page } from "@seqno/domain"
import { Outliner } from "@seqno/outliner"
import { dispatch, pages } from "../atoms.ts"
import { EditorSlot } from "./EditorSlot.tsx"
import { listValues } from "./pages/model.ts"
import { useNavigateTo } from "./pages/navigation.ts"
import { PageProperties } from "./pages/PageProperties.tsx"
import pagesCss from "./pages/pages.css?inline"
import { PageTitle } from "./pages/PageTitle.tsx"
import { NameReferences, References } from "./pages/References.tsx"

export const PagesStyle = () => (
  <style href="seqno/pages" precedence="pages">
    {pagesCss}
  </style>
)

export const PageView = ({
  page,
  zoom,
  inJournals = false,
}: {
  readonly page: Page
  readonly zoom: BlockId | null
  readonly inJournals?: boolean
}) => {
  const heading = useId()
  const navigateTo = useNavigateTo()
  const zoomed = zoom !== null
  return (
    <div className="seqno-page" data-zoomed={zoomed}>
      <PagesStyle />
      <article {...(zoomed ? { "aria-label": page.title } : { "aria-labelledby": heading })}>
        {zoomed ? null : <PageTitle page={page} id={heading} link={inJournals} />}
        <div className="seqno-page-blocks">
          {zoomed ? null : <PageProperties page={page} />}
          <Outliner pageId={page.id} zoom={zoom} onNavigate={navigateTo} editor={EditorSlot} />
        </div>
      </article>
      {zoomed ? null : <References page={page} unlinked={!inJournals} />}
    </div>
  )
}

const named = (all: ReadonlyArray<Page>, name: string) =>
  Option.orElse(Option.fromNullishOr(all.find((page) => page.name === name)), () =>
    Option.fromNullishOr(
      all.find((page) =>
        listValues(page.props["alias"] ?? "").some((alias) => normalizePageName(alias) === name),
      ),
    ),
  )

const MissingPage = ({ name }: { readonly name: string }) => {
  const heading = useId()
  const create = useAtomSet(dispatch)
  return (
    <div className="seqno-page">
      <PagesStyle />
      <article aria-labelledby={heading}>
        <h1 id={heading} className="seqno-page-title" data-editable={false}>
          {name}
        </h1>
        <div className="seqno-page-blocks">
          <button
            type="button"
            className="seqno-page-create"
            aria-label="Click here to start writing"
            onClick={() => create({ _tag: "CreatePage", title: name })}
          >
            <span className="seqno-page-create-bullet" />
          </button>
        </div>
      </article>
      <NameReferences name={name} />
    </div>
  )
}

export const PageByName = ({
  name,
  zoom,
}: {
  readonly name: string
  readonly zoom: BlockId | null
}) =>
  AsyncResult.match(useAtomValue(pages), {
    onInitial: () => null,
    onFailure: () => <p className="problem">The page list could not be read.</p>,
    onSuccess: ({ value }) =>
      Option.match(named(value, name), {
        onNone: () => <MissingPage name={name} />,
        onSome: (page) => <PageView page={page} zoom={zoom} />,
      }),
  })

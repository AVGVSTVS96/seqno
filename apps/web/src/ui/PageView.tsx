import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { normalizePageName, type BlockId, type Page } from "@seqno/domain"
import { Outliner } from "@seqno/outliner"
import { assetResolver, createPage, pages } from "../atoms.ts"
import { EditorSlot } from "./EditorSlot.tsx"
import { blockMenu } from "./shell/BlockMenu.tsx"
import { referencedOnly } from "./pages/atoms.ts"
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
  const resolveAsset = useAtomValue(assetResolver)
  const openMenu = useAtomSet(blockMenu)
  const zoomed = zoom !== null
  return (
    <div className="seqno-page" data-zoomed={zoomed}>
      <PagesStyle />
      <article {...(zoomed ? { "aria-label": page.title } : { "aria-labelledby": heading })}>
        {zoomed ? null : <PageTitle page={page} id={heading} link={inJournals} />}
        <div className="seqno-page-blocks">
          {zoomed ? null : <PageProperties page={page} />}
          <Outliner
            pageId={page.id}
            zoom={zoom}
            addable
            onNavigate={navigateTo}
            editor={EditorSlot}
            resolveAsset={resolveAsset}
            onBlockMenu={openMenu}
          />
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
  const create = useAtomSet(createPage)
  const title = useAtomValue(referencedOnly).find((page) => page.name === name)?.title ?? name
  return (
    <div className="seqno-page">
      <PagesStyle />
      <article aria-labelledby={heading}>
        <h1 id={heading} className="seqno-page-title" data-editable={false}>
          {title}
        </h1>
        <div className="seqno-page-blocks">
          <button
            type="button"
            className="seqno-page-create"
            aria-label="Click here to start writing"
            onClick={() => create(title)}
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

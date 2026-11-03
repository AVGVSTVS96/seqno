import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { isWhiteboard, normalizePageName, type BlockId, type Page } from "@seqno/domain"
import { Outliner } from "@seqno/outliner"
import { assetResolver, createPage, pages } from "../atoms.ts"
import { EditorSlot } from "./EditorSlot.tsx"
import { blockMenu } from "./shell/BlockMenu.tsx"
import { vimMode } from "./shell/state.ts"
import { referencedOnly } from "./pages/atoms.ts"
import { listValues } from "./pages/model.ts"
import { useNavigateTo } from "./pages/navigation.ts"
import { PageProperties } from "./pages/PageProperties.tsx"
import { PagesStyle } from "./pages/PagesStyle.tsx"
import { PageTitle } from "./pages/PageTitle.tsx"
import { PluginItems } from "@seqno/plugins"
import { NameReferences, References } from "./pages/References.tsx"
import { BoardPage } from "./pages/BoardPage.tsx"

export { PagesStyle } from "./pages/PagesStyle.tsx"

export const PageView = ({
  page,
  zoom,
  inJournals,
}: {
  readonly page: Page
  readonly zoom: BlockId | null
  readonly inJournals?: boolean
}) => {
  const heading = useId()
  const navigateTo = useNavigateTo()
  const resolveAsset = useAtomValue(assetResolver)
  const openMenu = useAtomSet(blockMenu)
  const vim = useAtomValue(vimMode)
  const zoomed = zoom !== null
  return (
    <div
      className={inJournals === true ? "seqno-page journal page" : "seqno-page page"}
      data-zoomed={zoomed}
    >
      <PagesStyle />
      <article {...(zoomed ? { "aria-label": page.title } : { "aria-labelledby": heading })}>
        {zoomed || inJournals === true ? null : <PluginItems type="pagebar" />}
        {zoomed ? null : (
          <div className="ls-page-title">
            <PageTitle page={page} id={heading} link={inJournals ?? false} />
          </div>
        )}
        <div className="seqno-page-blocks page-blocks-inner content">
          {zoomed ? null : <PageProperties page={page} />}
          <Outliner
            pageId={page.id}
            zoom={zoom}
            addable
            windowed
            onNavigate={navigateTo}
            editor={EditorSlot}
            resolveAsset={resolveAsset}
            onBlockMenu={openMenu}
            vim={vim}
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
    <div className="seqno-page page">
      <PagesStyle />
      <article aria-labelledby={heading}>
        <div className="ls-page-title">
          <h1 id={heading} className="seqno-page-title page-title title" data-editable={false}>
            {title}
          </h1>
        </div>
        <div className="seqno-page-blocks page-blocks-inner content">
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
        onSome: (page) =>
          isWhiteboard(page) ? (
            <BoardPage page={page} zoom={zoom} />
          ) : (
            <PageView page={page} zoom={zoom} />
          ),
      }),
  })

import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconCaretRightFilled } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Fragment, useId, useState, type ReactNode } from "react"
import type { Block, BlockId, Page, PageId } from "@seqno/domain"
import { clickOnEnter, Outliner, pageTreeAtom } from "@seqno/outliner"
import type { Reference } from "@seqno/rpc"
import { allPages, assetResolver } from "../../atoms.ts"
import { EditorSlot } from "../EditorSlot.tsx"
import { blockMenu } from "../shell/BlockMenu.tsx"
import { linkedReferences, nameReferences, unlinkedReferences } from "./atoms.ts"
import { markMentions, wordsOf } from "./mentions.ts"
import {
  crumbLabel,
  groupByPage,
  listValues,
  outermost,
  trailOf,
  type ReferenceGroup,
} from "./model.ts"
import { useNavigateTo } from "./navigation.ts"
import { PageLink } from "./PageLink.tsx"

const Fold = ({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) => (
  <button
    type="button"
    className="seqno-fold"
    data-open={open}
    tabIndex={-1}
    aria-hidden
    onClick={onToggle}
  >
    <IconCaretRightFilled size={16} />
  </button>
)

const Crumbs = ({
  pageId,
  trail,
}: {
  readonly pageId: PageId
  readonly trail: ReadonlyArray<Block>
}) => {
  const navigateTo = useNavigateTo()
  return trail.length === 0 ? null : (
    <nav className="seqno-reference-crumbs" aria-label="Parent blocks">
      {trail.map((parent, at) => (
        <Fragment key={parent.id}>
          {at === 0 ? null : (
            <span className="seqno-reference-crumbs-separator" aria-hidden>
              /
            </span>
          )}
          <a
            role="link"
            tabIndex={0}
            onKeyDown={clickOnEnter}
            onClick={(event) => {
              event.preventDefault()
              navigateTo(
                event.shiftKey
                  ? { _tag: "SidebarBlock", blockId: parent.id }
                  : { _tag: "Zoom", pageId, blockId: parent.id },
              )
            }}
          >
            {crumbLabel(parent.text)}
          </a>
        </Fragment>
      ))}
    </nav>
  )
}

const ReferenceBlock = ({
  pageId,
  blockId,
  trail,
}: {
  readonly pageId: PageId
  readonly blockId: BlockId
  readonly trail: ReadonlyArray<Block>
}) => {
  const navigateTo = useNavigateTo()
  const resolveAsset = useAtomValue(assetResolver)
  const openMenu = useAtomSet(blockMenu)
  return (
    <div className="seqno-reference">
      <Crumbs pageId={pageId} trail={trail} />
      <Outliner
        pageId={pageId}
        zoom={blockId}
        onNavigate={navigateTo}
        editor={EditorSlot}
        resolveAsset={resolveAsset}
        onBlockMenu={openMenu}
      />
    </div>
  )
}

const Group = ({ group, page }: { readonly group: ReferenceGroup; readonly page: Page }) => {
  const [open, setOpen] = useState(true)
  const blocks = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(pageTreeAtom(group.pageId)), (tree) => tree.blocks),
    (): ReadonlyArray<Block> => [],
  )
  const trail = trailOf(blocks)
  return (
    <section className="seqno-references-group" aria-label={page.title}>
      <div className="seqno-references-head" data-open={open}>
        <Fold open={open} onToggle={() => setOpen(!open)} />
        <PageLink page={page} className="seqno-references-page" />
      </div>
      {open ? (
        <div className="seqno-references-blocks">
          {outermost(group.blockIds, trail).map((blockId) => (
            <ReferenceBlock
              key={blockId}
              pageId={group.pageId}
              blockId={blockId}
              trail={trail(blockId)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

const Groups = ({ references }: { readonly references: ReadonlyArray<Reference> }) => {
  const known = new Map(useAtomValue(allPages).map((page) => [page.id, page]))
  return groupByPage(references).flatMap((group) => {
    const page = known.get(group.pageId)
    return page === undefined ? [] : [<Group key={group.pageId} group={group} page={page} />]
  })
}

const Section = ({
  label,
  count,
  initiallyOpen,
  mentions = [],
  children,
}: {
  readonly label: string
  readonly count: number | null
  readonly initiallyOpen: boolean
  readonly mentions?: ReadonlyArray<string>
  readonly children: ReactNode
}) => {
  const [open, setOpen] = useState(initiallyOpen)
  const title = useId()
  const toggle = () => setOpen(!open)
  return (
    <section className="seqno-references" aria-labelledby={title} ref={markMentions(mentions)}>
      <div className="seqno-references-head" data-open={open}>
        <Fold open={open} onToggle={toggle} />
        <h2 className="seqno-references-title">
          <button id={title} type="button" aria-expanded={open} onClick={toggle}>
            {label}
            {count === null ? null : <span className="seqno-references-count">{count}</span>}
          </button>
        </h2>
      </div>
      {open ? <div className="seqno-references-body">{children}</div> : null}
    </section>
  )
}

const none: ReadonlyArray<Reference> = []

const Linked = ({ references }: { readonly references: ReadonlyArray<Reference> }) =>
  references.length === 0 ? null : (
    <Section label="Linked references" count={references.length} initiallyOpen>
      <Groups references={references} />
    </Section>
  )

const LinkedReferences = ({ page }: { readonly page: Page }) => (
  <Linked references={AsyncResult.getOrElse(useAtomValue(linkedReferences(page.id)), () => none)} />
)

export const NameReferences = ({ name }: { readonly name: string }) => (
  <div className="seqno-page-references">
    <div>
      <Linked references={AsyncResult.getOrElse(useAtomValue(nameReferences(name)), () => none)} />
    </div>
    <div />
  </div>
)

const UnlinkedReferences = ({ page }: { readonly page: Page }) => {
  const references = AsyncResult.getOrElse(useAtomValue(unlinkedReferences(page.id)), () => none)
  return references.length === 0 ? null : (
    <Section
      label="Unlinked references"
      count={null}
      initiallyOpen={false}
      mentions={wordsOf([page.title, ...listValues(page.props["alias"] ?? "")])}
    >
      <Groups references={references} />
    </Section>
  )
}

export const References = ({
  page,
  unlinked,
}: {
  readonly page: Page
  readonly unlinked: boolean
}) => (
  <div className="seqno-page-references">
    <div>
      <LinkedReferences page={page} />
    </div>
    <div>{unlinked ? <UnlinkedReferences page={page} /> : null}</div>
  </div>
)

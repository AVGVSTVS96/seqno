import { logseq } from "@seqno/dom"
import { useAtomValue } from "@effect/atom-react"
import { IconLink, IconX } from "@tabler/icons-react"
import { Effect, Option } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { useState, type ReactNode } from "react"
import {
  isBlockLink,
  isShapeBlock,
  isWhiteboard,
  normalizePageName,
  portalTarget,
  shapeLinks,
  wordsIn,
  shapeRaw,
  type Block,
  type BlockId,
  type Page,
  type PageId,
} from "@seqno/domain"
import {
  blockRefAtom,
  blockRefCountsAtom,
  blockReferencesAtom,
  coreRuntime,
  Outliner,
  pageNamedAtom,
} from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"
import {
  IconAddLink,
  IconInternalLink,
  IconLinkToBlock,
  IconLinkToPage,
  IconLinkToWhiteboard,
  IconMoveToSidebarRight,
  IconOpenAsPage,
} from "./icons.tsx"
import type { Item } from "./model.ts"
import type { OutlinerEnv } from "./Portal.tsx"
import { QuickSearch, type Pick } from "./QuickSearch.tsx"
import { usePopoverIds } from "./Toolbar.tsx"

export interface LinkEnv {
  readonly outliner: OutlinerEnv
  readonly openPage: (name: string, sidebar: boolean) => void
  readonly board: Page
  readonly focusShape: (blockId: BlockId) => void
  readonly createWhiteboard: (title: string) => void
}

const pageByIdAtom = Atom.family((pageId: PageId) =>
  coreRuntime.atom(
    Effect.flatMap(CoreClient, (client) =>
      Effect.map(client.GetPages(), (pages) => pages.find((page) => page.id === pageId)),
    ),
  ),
)

const short = (text: string) => (text.length > 23 ? `${text.slice(0, 20)}...` : text)

const contentOf = (block: Block) => {
  if (!isShapeBlock(block)) return block.text.split("\n")[0] ?? ""
  const raw = shapeRaw(block)
  const words = block.text === "" ? wordsIn(raw) : block.text
  return words !== "" ? words : `whiteboard ${String(raw["type"] ?? "shape")}`
}

export const ownTarget = (item: Item): string | null =>
  item.shape.type !== "logseq-portal"
    ? null
    : Option.match(portalTarget(item.block.text), {
        onNone: () => null,
        onSome: (target) => (target._tag === "PagePortal" ? target.name : target.uuid),
      })

export const linksOf = (item: Item) => shapeLinks(item.block)

const go = (env: LinkEnv, block: Block, sidebar: boolean) => {
  if (sidebar) env.outliner.onNavigate({ _tag: "SidebarBlock", blockId: block.id })
  else if (block.pageId === env.board.id) env.focusShape(block.id)
  else env.outliner.onNavigate({ _tag: "Zoom", pageId: block.pageId, blockId: block.id })
}

const Label = ({ icon, children }: { readonly icon: ReactNode; readonly children: ReactNode }) => (
  <span className="wb-block-link-label">
    {icon}
    {children}
  </span>
)

const BlockTarget = ({
  uuid,
  showContent,
  env,
  hideOnBoard,
}: {
  readonly uuid: string
  readonly showContent: boolean
  readonly env: LinkEnv
  readonly hideOnBoard: boolean
}) => {
  const found = useAtomValue(blockRefAtom(uuid))
  if (AsyncResult.isInitial(found)) return null
  if (!AsyncResult.isSuccess(found)) {
    return <span className="wb-block-link-missing">Invalid reference. Did you remove it?</span>
  }
  const block = found.value
  if (hideOnBoard && block.pageId === env.board.id) return null
  return <BlockButton block={block} showContent={showContent} env={env} />
}

const BlockButton = ({
  block,
  showContent,
  env,
}: {
  readonly block: Block
  readonly showContent: boolean
  readonly env: LinkEnv
}) => {
  const page = AsyncResult.getOrElse(useAtomValue(pageByIdAtom(block.pageId)), () => undefined)
  const shape = isShapeBlock(block)
  return (
    <button
      type="button"
      className="wb-block-link"
      onPointerDown={(event) => {
        event.stopPropagation()
        go(env, block, event.shiftKey)
      }}
    >
      <Label icon={shape ? <IconLinkToWhiteboard size={16} /> : <IconLinkToBlock size={16} />}>
        <span className="wb-block-link-crumb">{page?.title ?? ""}</span>
        {showContent ? (
          <span className="wb-block-link-content">{short(contentOf(block))}</span>
        ) : null}
      </Label>
    </button>
  )
}

const PageTarget = ({
  name,
  env,
  hideOnBoard,
}: {
  readonly name: string
  readonly env: LinkEnv
  readonly hideOnBoard: boolean
}) => {
  const page = AsyncResult.getOrElse(useAtomValue(pageNamedAtom(name)), () => undefined)
  if (hideOnBoard && normalizePageName(name) === env.board.name) return null
  const board = page !== undefined && isWhiteboard(page)
  return (
    <button
      type="button"
      className="wb-block-link"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (page !== undefined) env.openPage(page.title, event.shiftKey)
      }}
    >
      <Label icon={board ? <IconLinkToWhiteboard size={16} /> : <IconLinkToPage size={16} />}>
        <span {...logseq("seqno-pageref-link", page?.name ?? name)}>{page?.title ?? name}</span>
      </Label>
    </button>
  )
}

export const BlockLink = ({
  link,
  showContent,
  env,
  hideOnBoard,
}: {
  readonly link: string
  readonly showContent: boolean
  readonly env: LinkEnv
  readonly hideOnBoard: boolean
}) =>
  isBlockLink(link) ? (
    <BlockTarget uuid={link} showContent={showContent} env={env} hideOnBoard={hideOnBoard} />
  ) : (
    <PageTarget name={link} env={env} hideOnBoard={hideOnBoard} />
  )

export const QuickLinks = ({
  item,
  env,
  left,
  top,
}: {
  readonly item: Item
  readonly env: LinkEnv
  readonly left: number
  readonly top: number
}) => {
  const own = ownTarget(item)
  const links = [
    ...(own === null ? [] : [[own, false] as const]),
    ...linksOf(item).map((link) => [link, true] as const),
  ]
  if (links.length === 0) return null
  return (
    <div
      className="wb-quick-links"
      title="Shape Quick Links"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {links.map(([link, content]) => (
        <div key={link} className="wb-quick-links-row">
          <BlockLink link={link} showContent={content} env={env} hideOnBoard />
        </div>
      ))}
    </div>
  )
}

const LinkRow = ({
  link,
  showContent,
  env,
  onBoard,
  open,
  onRemove,
}: {
  readonly link: string
  readonly showContent: boolean
  readonly env: LinkEnv
  readonly onBoard: boolean
  readonly open: (sidebar: boolean) => void
  readonly onRemove: (() => void) | null
}) => (
  <div className="wb-link-item">
    <span className="wb-link-item-target">
      <BlockLink link={link} showContent={showContent} env={env} hideOnBoard={false} />
    </span>
    <span className="wb-link-item-gap" />
    {onBoard ? null : (
      <button
        type="button"
        className="wb-button"
        aria-label="Open page"
        data-tooltip="Open page"
        onClick={() => open(false)}
      >
        <IconOpenAsPage size={16} />
      </button>
    )}
    <button
      type="button"
      className="wb-button"
      aria-label="Open page in sidebar"
      data-tooltip="Open page in sidebar"
      onClick={() => open(true)}
    >
      <IconMoveToSidebarRight size={16} />
    </button>
    {onRemove === null ? null : (
      <button
        type="button"
        className="wb-button wb-link-remove"
        aria-label="Remove link"
        data-tooltip="Remove link"
        onClick={onRemove}
      >
        <IconX size={14} />
      </button>
    )}
  </div>
)

interface LinkItemProps {
  readonly link: string
  readonly showContent: boolean
  readonly env: LinkEnv
  readonly onRemove: (() => void) | null
}

const BlockLinkItem = (props: LinkItemProps) => {
  const block = AsyncResult.getOrElse(useAtomValue(blockRefAtom(props.link)), () => undefined)
  return (
    <LinkRow
      {...props}
      onBoard={block?.pageId === props.env.board.id}
      open={(sidebar) => {
        if (block !== undefined) go(props.env, block, sidebar)
      }}
    />
  )
}

const LinkItem = (props: LinkItemProps) =>
  isBlockLink(props.link) ? (
    <BlockLinkItem {...props} />
  ) : (
    <LinkRow
      {...props}
      onBoard={normalizePageName(props.link) === props.env.board.name}
      open={(sidebar) => props.env.openPage(props.link, sidebar)}
    />
  )

export const LinksAction = ({
  item,
  env,
  onLinks,
}: {
  readonly item: Item
  readonly env: LinkEnv
  readonly onLinks: (links: ReadonlyArray<string>) => void
}) => {
  const ids = usePopoverIds()
  const own = ownTarget(item)
  const links = linksOf(item)
  const count = links.length + (own === null ? 0 : 1)
  const [searching, setSearching] = useState(0)
  const pick = (choice: Pick) => {
    const value = (() => {
      switch (choice._tag) {
        case "Page":
          return choice.page.title
        case "Block":
          return choice.block.id
        case "NewPage":
          return choice.title
        case "NewWhiteboard":
          env.createWhiteboard(choice.title)
          return choice.title
        case "NewBlock":
          return null
      }
    })()
    if (value !== null && links.length === 0 && !links.includes(value)) onLinks([value])
    setSearching(searching + 1)
  }
  return (
    <>
      <button
        type="button"
        className="wb-button wb-links-button"
        aria-label="Link"
        data-tooltip="Link"
        popoverTarget={ids.id}
        style={ids.trigger}
      >
        {count > 0 ? (
          <>
            <IconLink size={18} />
            <span className="wb-links-count">{count}</span>
          </>
        ) : (
          <IconAddLink size={18} />
        )}
      </button>
      <div
        id={ids.id}
        popover="auto"
        className="wb-popover wb-links-popover"
        data-side="right"
        style={ids.popover}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {own === null ? null : (
          <div className="wb-links-panel" data-kind="references">
            <div className="wb-links-heading">
              <IconInternalLink size={16} />
              References
            </div>
            <LinkItem link={own} showContent={false} env={env} onRemove={null} />
          </div>
        )}
        <div className="wb-links-panel">
          <div className="wb-links-heading">
            <IconAddLink size={16} />
            Link to any page or block
          </div>
          {links.length === 0 ? (
            <QuickSearch key={searching} place={null} onPick={pick} onCancel={() => {}} />
          ) : null}
          {links.map((link, index) => (
            <LinkItem
              key={link}
              link={link}
              showContent
              env={env}
              onRemove={() => onLinks(links.filter((_, at) => at !== index))}
            />
          ))}
        </div>
      </div>
    </>
  )
}

export const useBackLinkCount = (blockId: BlockId) =>
  AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(blockRefCountsAtom), (counts) => counts[blockId] ?? 0),
    () => 0,
  )

const ReferencingBlocks = ({ uuid, env }: { readonly uuid: string; readonly env: LinkEnv }) => {
  const blocks = AsyncResult.getOrElse(useAtomValue(blockReferencesAtom(uuid)), () => [])
  return (
    <div className="wb-backlinks-list">
      {blocks.map((block) => (
        <Outliner key={block.id} {...env.outliner} pageId={block.pageId} zoom={block.id} embedded />
      ))}
    </div>
  )
}

export const BacklinksBadge = ({
  blockId,
  env,
  left,
  top,
  rounded,
}: {
  readonly blockId: BlockId
  readonly env: LinkEnv
  readonly left: number
  readonly top: number
  readonly rounded: boolean
}) => {
  const count = useBackLinkCount(blockId)
  const ids = usePopoverIds()
  if (count === 0) return null
  return (
    <div
      className="wb-backlinks"
      title="Shape Backlinks"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="wb-backlinks-count"
        data-rounded={rounded}
        aria-label={`${count} references`}
        popoverTarget={ids.id}
        style={ids.trigger}
      >
        <span className="wb-backlinks-number">{count}</span>
      </button>
      <div
        id={ids.id}
        popover="auto"
        className="wb-popover wb-backlinks-popover"
        data-side="below"
        style={ids.popover}
      >
        <ReferencingBlocks uuid={blockId} env={env} />
      </div>
    </div>
  )
}

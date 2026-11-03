import { useAtomValue } from "@effect/atom-react"
import { Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { BlockId, portalTarget, type Block, type Page, type PageId } from "@seqno/domain"
import { blockAtom, Outliner, pageNamedAtom, type OutlinerProps } from "@seqno/outliner"
import type { Item } from "./model.ts"

export type OutlinerEnv = Pick<
  OutlinerProps,
  "onNavigate" | "editor" | "resolveAsset" | "onBlockMenu" | "vim"
>

export interface PortalEnv {
  readonly outliner: OutlinerEnv
  readonly openPage: (name: string, sidebar: boolean) => void
}

const Outline = ({
  env,
  pageId,
  zoom,
}: {
  readonly env: PortalEnv
  readonly pageId: PageId
  readonly zoom: BlockId | null
}) => (
  <Outliner
    {...env.outliner}
    pageId={pageId}
    zoom={zoom}
    embedded
    takesEdits
    codeStyle="highlight.js"
  />
)

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

const Missing = () => <div className="wb-portal-missing">Target not found</div>

const colored = (fill: string | undefined) =>
  fill === undefined || fill === ""
    ? {}
    : {
        "--wb-portal-header": `var(--wb-background-${fill}, ${fill})`,
        "--wb-portal-body": `color-mix(in srgb, var(--wb-background-${fill}, ${fill}) 35%, var(--wb-canvas))`,
      }

const Card = ({
  item,
  scale,
  live,
  dim,
  binding,
  header,
  children,
}: {
  readonly item: Item
  readonly scale: number
  readonly live: boolean
  readonly dim: boolean
  readonly binding: boolean
  readonly header: ReactNode
  readonly children: ReactNode
}) => {
  const { shape } = item
  const portal = shape.type === "logseq-portal" ? shape : null
  const width = "size" in shape ? shape.size[0] : 400
  const auto = portal?.isAutoResizing !== false
  const fixed = !auto && "size" in shape && portal?.collapsed !== true
  return (
    <div
      className="wb-portal"
      data-live={live}
      data-dim={dim}
      data-binding={binding}
      data-compact={portal?.compact === true}
      data-auto={auto}
      style={{
        position: "relative",
        width: width / scale,
        ...(fixed ? { height: shape.size[1] / scale } : {}),
        zoom: scale,
        ...colored("fill" in shape ? shape.fill : undefined),
      }}
    >
      {header}
      {portal?.collapsed === true && portal.blockType !== "B" ? null : children}
    </div>
  )
}

const PagePortal = ({
  name,
  env,
  ...card
}: {
  readonly name: string
  readonly env: PortalEnv
  readonly item: Item
  readonly scale: number
  readonly live: boolean
  readonly dim: boolean
  readonly binding: boolean
}) => {
  const page = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(pageNamedAtom(name)), Option.fromNullishOr),
    Option.none<Page>,
  )
  const header = (
    <div className="wb-portal-header">
      <a
        role="link"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => env.openPage(name, event.shiftKey)}
      >
        {Option.match(page, { onNone: () => name, onSome: (found) => found.title })}
      </a>
    </div>
  )
  return (
    <Card {...card} header={header}>
      {Option.isSome(page) ? (
        <div className="wb-portal-body">
          <Outline env={env} pageId={page.value.id} zoom={null} />
        </div>
      ) : (
        <Missing />
      )}
    </Card>
  )
}

const BlockBody = ({
  block,
  env,
  ...card
}: {
  readonly block: Block
  readonly env: PortalEnv
  readonly item: Item
  readonly scale: number
  readonly live: boolean
  readonly dim: boolean
  readonly binding: boolean
}) => {
  const compact = card.item.shape.type === "logseq-portal" && card.item.shape.compact === true
  return (
    <Card
      {...card}
      header={
        compact ? null : <div className="wb-portal-header">{block.text.split("\n")[0] ?? ""}</div>
      }
    >
      <div className="wb-portal-body">
        <Outline env={env} pageId={block.pageId} zoom={block.id} />
      </div>
    </Card>
  )
}

const BlockPortal = ({
  blockId,
  env,
  ...card
}: {
  readonly blockId: BlockId
  readonly env: PortalEnv
  readonly item: Item
  readonly scale: number
  readonly live: boolean
  readonly dim: boolean
  readonly binding: boolean
}) =>
  AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => (
      <Card {...card} header={null}>
        {null}
      </Card>
    ),
    onFailure: () => (
      <Card {...card} header={null}>
        <Missing />
      </Card>
    ),
    onSuccess: ({ value }) => <BlockBody block={value} env={env} {...card} />,
  })

export const PortalView = (props: {
  readonly item: Item
  readonly scale: number
  readonly live: boolean
  readonly dim: boolean
  readonly binding: boolean
  readonly env: PortalEnv
}) =>
  Option.match(portalTarget(props.item.block.text), {
    onNone: () => (
      <Card {...props} header={null}>
        <Missing />
      </Card>
    ),
    onSome: (target) => {
      if (target._tag === "PagePortal") return <PagePortal name={target.name} {...props} />
      return Option.match(decodeBlockId(target.uuid), {
        onNone: () => (
          <Card {...props} header={null}>
            <Missing />
          </Card>
        ),
        onSome: (blockId) => <BlockPortal blockId={blockId} {...props} />,
      })
    },
  })

export const PortalPreview = ({ item, scale }: { readonly item: Item; readonly scale: number }) => (
  <Card item={item} scale={scale} live={false} dim={false} binding={false} header={null}>
    <div className="wb-portal-header">
      {Option.match(portalTarget(item.block.text), {
        onNone: () => "",
        onSome: (target) => (target._tag === "PagePortal" ? target.name : "Block"),
      })}
    </div>
  </Card>
)

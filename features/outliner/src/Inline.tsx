import { use, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import { Match, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { IconPhoto } from "@tabler/icons-react"
import { BlockId, type Block } from "@seqno/domain"
import { parseInline, plainText, type Inline, type LinkTarget } from "@seqno/syntax"
import { blockAtom, pageTreeAtom } from "./core.ts"
import { usePreview } from "./Preview.tsx"
import { clickOnEnter, contentOf, follow, maxDepth, RenderContext, toPage } from "./render.ts"

const isBlockId = Schema.is(BlockId)
const safeUrl = /^(?:https?|mailto|ftp):/i
const absoluteUrl = /^(?:https?:|data:image\/|blob:)/i

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const Inlines = ({ nodes }: { readonly nodes: ReadonlyArray<Inline> }): ReactNode =>
  nodes.map((node) => <InlineNode key={node.span.from} node={node} />)

const RefBody = ({ block, children }: { readonly block: Block; readonly children?: ReactNode }) => {
  const renderer = use(RenderContext)
  const preview = usePreview({ _tag: "Block", blockId: block.id })
  const title = contentOf(block.text).title ?? []
  return (
    <span
      className="seqno-blockref"
      {...preview.trigger}
      onClick={follow(
        renderer.navigate,
        { _tag: "Zoom", pageId: block.pageId, blockId: block.id },
        { _tag: "SidebarBlock", blockId: block.id },
      )}
    >
      {children ??
        (renderer.depth >= maxDepth ? (
          plainText(title)
        ) : (
          <RenderContext value={{ ...renderer, depth: renderer.depth + 1 }}>
            <Inlines nodes={title} />
          </RenderContext>
        ))}
      {preview.popup}
    </span>
  )
}

const LiveRef = ({ block, children }: { readonly block: Block; readonly children?: ReactNode }) => {
  const latest = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(pageTreeAtom(block.pageId)), (tree) =>
      tree.blocks.find((candidate) => candidate.id === block.id),
    ),
    () => undefined,
  )
  return <RefBody block={latest ?? block}>{children}</RefBody>
}

const RemoteRef = ({
  blockId,
  children,
}: {
  readonly blockId: BlockId
  readonly children?: ReactNode
}) =>
  AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => <span className="seqno-blockref is-pending">{children}</span>,
    onFailure: () => <span className="seqno-blockref is-missing">(({blockId}))</span>,
    onSuccess: ({ value }) => <LiveRef block={value}>{children}</LiveRef>,
  })

const BlockRef = ({ uuid, children }: { readonly uuid: string; readonly children?: ReactNode }) => {
  const renderer = use(RenderContext)
  if (!isBlockId(uuid)) return <span className="seqno-blockref is-missing">(({uuid}))</span>
  const local = renderer.localBlock(uuid)
  return local === undefined ? (
    <RemoteRef blockId={uuid}>{children}</RemoteRef>
  ) : (
    <RefBody block={local}>{children}</RefBody>
  )
}

const PageLink = ({
  name,
  brackets,
  from,
  children,
}: {
  readonly name: string
  readonly brackets: boolean
  readonly from?: number
  readonly children: ReactNode
}) => {
  const renderer = use(RenderContext)
  const preview = usePreview({ _tag: "Page", name })
  return (
    <span className={brackets ? "seqno-pageref has-brackets" : "seqno-pageref"}>
      <a
        role="link"
        tabIndex={0}
        className="seqno-pageref-link"
        data-from={from}
        onClick={toPage(renderer.navigate, name)}
        onKeyDown={clickOnEnter}
        {...preview.trigger}
      >
        {children}
      </a>
      {preview.popup}
    </span>
  )
}

const Link = ({
  target,
  label,
}: {
  readonly target: LinkTarget
  readonly label: ReadonlyArray<Inline>
}) =>
  Match.valueTags(target, {
    Url: ({ url }) =>
      safeUrl.test(url) ? (
        <a href={url} target="_blank" rel="noreferrer" className="seqno-link" onClick={stop}>
          <Inlines nodes={label} />
        </a>
      ) : (
        <span className="seqno-link">
          <Inlines nodes={label} />
        </span>
      ),
    Page: ({ name }) => (
      <PageLink name={name} brackets={false}>
        <Inlines nodes={label} />
      </PageLink>
    ),
    Block: ({ uuid }) => (
      <BlockRef uuid={uuid}>
        <Inlines nodes={label} />
      </BlockRef>
    ),
  })

const Image = ({ url, alt }: { readonly url: string; readonly alt: string }) => {
  const renderer = use(RenderContext)
  const source = renderer.resolveAsset(url) ?? (absoluteUrl.test(url) ? url : undefined)
  return source === undefined ? (
    <span className="seqno-image is-missing" title={url}>
      <IconPhoto size={16} stroke={1.5} aria-hidden />
      {alt === "" ? url : alt}
    </span>
  ) : (
    <img className="seqno-image" src={source} alt={alt} loading="lazy" draggable={false} />
  )
}

const Macro = ({
  name,
  args,
  raw,
}: {
  readonly name: string
  readonly args: string
  readonly raw: string
}) => {
  const renderer = use(RenderContext)
  const [target] = name === "embed" ? parseInline(args.trim()) : []
  const Embed = renderer.Embed
  const Query = renderer.Query
  if (renderer.depth < maxDepth && name === "query") return <Query query={args.trim()} />
  if (renderer.depth < maxDepth && target?._tag === "BlockRef" && isBlockId(target.uuid)) {
    return <Embed target={{ _tag: "Block", blockId: target.uuid }} />
  }
  if (renderer.depth < maxDepth && target?._tag === "PageRef") {
    return <Embed target={{ _tag: "Page", name: target.name }} />
  }
  return <span className="seqno-macro">{raw}</span>
}

const TagLink = ({ name }: { readonly name: string }) => {
  const renderer = use(RenderContext)
  const preview = usePreview({ _tag: "Page", name })
  return (
    <>
      <a
        role="link"
        tabIndex={0}
        className="seqno-tag"
        onClick={toPage(renderer.navigate, name)}
        onKeyDown={clickOnEnter}
        {...preview.trigger}
      >
        #{name}
      </a>
      {preview.popup}
    </>
  )
}

const InlineNode = ({ node }: { readonly node: Inline }): ReactNode => {
  const renderer = use(RenderContext)
  return Match.valueTags(node, {
    Text: ({ text, span }) => <span data-from={span.from}>{text}</span>,
    Code: ({ code, span }) => (
      <code className="seqno-code" data-from={span.from + 1}>
        {code}
      </code>
    ),
    PageRef: ({ name, brackets, span }) => (
      <PageLink name={name} brackets={brackets} from={span.from + (brackets ? 2 : 0)}>
        {name}
      </PageLink>
    ),
    Tag: ({ name }) => <TagLink name={name} />,
    BlockRef: ({ uuid }) => <BlockRef uuid={uuid} />,
    Macro: ({ name, args }) => (
      <Macro name={name} args={args} raw={`{{${args === "" ? name : `${name} ${args}`}}}`} />
    ),
    Priority: ({ priority }) => (
      <a
        role="link"
        tabIndex={0}
        className="seqno-priority"
        onClick={toPage(renderer.navigate, priority)}
        onKeyDown={clickOnEnter}
      >
        [#{priority}]
      </a>
    ),
    Bold: ({ children }) => (
      <strong>
        <Inlines nodes={children} />
      </strong>
    ),
    Italic: ({ children }) => (
      <em>
        <Inlines nodes={children} />
      </em>
    ),
    Strike: ({ children }) => (
      <del>
        <Inlines nodes={children} />
      </del>
    ),
    Highlight: ({ children }) => (
      <mark className="seqno-mark">
        <Inlines nodes={children} />
      </mark>
    ),
    Link: ({ target, label }) => <Link target={target} label={label} />,
    Image: ({ url, alt }) => <Image url={url} alt={alt} />,
  })
}

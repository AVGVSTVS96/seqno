import { use, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "@effect/atom-react"
import { Match, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { IconCopy, IconMaximize, IconPhoto, IconTrash } from "@tabler/icons-react"
import { BlockId, type Block } from "@seqno/domain"
import { parseInline, plainText, type Inline, type LinkTarget } from "@seqno/syntax"
import { blockAtom, pageTreeAtom } from "./core.ts"
import { usePreview } from "./Preview.tsx"
import {
  BlockSource,
  clickOnEnter,
  contentOf,
  follow,
  maxDepth,
  RenderContext,
  toPage,
} from "./render.ts"

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

const copyImage = async (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (png !== null) await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
}

const ImageViewer = ({
  source,
  alt,
  onClose,
}: {
  readonly source: string
  readonly alt: string
  readonly onClose: () => void
}) =>
  createPortal(
    <dialog
      className="seqno-image-viewer"
      aria-label={alt === "" ? "Image" : alt}
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) dialog.showModal()
      }}
      onClose={onClose}
      onClick={(event) => event.currentTarget.close()}
    >
      <img src={source} alt={alt} />
    </dialog>,
    document.body,
  )

const Image = ({ node }: { readonly node: Extract<Inline, { readonly _tag: "Image" }> }) => {
  const renderer = use(RenderContext)
  const edit = use(BlockSource)
  const [full, setFull] = useState(false)
  const picture = useRef<HTMLImageElement>(null)
  const { url, alt, span, size, width } = node
  const source = renderer.resolveAsset(url) ?? (absoluteUrl.test(url) ? url : undefined)
  if (source === undefined) {
    return (
      <span className="seqno-image is-missing" title={url}>
        <IconPhoto size={16} stroke={1.5} aria-hidden />
        {alt === "" ? url : alt}
      </span>
    )
  }
  const keepWidth = (frame: HTMLElement) => {
    const before = frame.offsetWidth
    window.addEventListener(
      "pointerup",
      () => {
        const after = Math.round(frame.offsetWidth)
        if (edit === null || after === before) return
        const suffix = `{:width ${after}}`
        if (size === null) edit(span.to, span.to, suffix)
        else edit(size.from, size.to, suffix)
      },
      { once: true },
    )
  }
  return (
    <span
      className="seqno-image-frame"
      style={width === null ? undefined : { width }}
      onPointerDown={(event) => keepWidth(event.currentTarget)}
    >
      <img
        ref={picture}
        className="seqno-image"
        src={source}
        alt={alt}
        loading="lazy"
        draggable={false}
      />
      <span className="seqno-image-overlay" aria-hidden />
      <span className="seqno-image-actions" onClick={stop} onPointerDown={stop}>
        {edit === null ? null : (
          <button
            type="button"
            title="Delete image"
            aria-label="Delete image"
            onClick={() => edit(span.from, span.to, "")}
          >
            <IconTrash size={18} stroke={2} aria-hidden />
          </button>
        )}
        <button
          type="button"
          title="Copy image"
          aria-label="Copy image"
          onClick={() => {
            if (picture.current !== null) void copyImage(picture.current).catch(() => undefined)
          }}
        >
          <IconCopy size={18} stroke={2} aria-hidden />
        </button>
        <button
          type="button"
          title="Maximize image"
          aria-label="Maximize image"
          onClick={() => setFull(true)}
        >
          <IconMaximize size={18} stroke={2} aria-hidden />
        </button>
      </span>
      {full ? <ImageViewer source={source} alt={alt} onClose={() => setFull(false)} /> : null}
    </span>
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
    Image: (image) => <Image node={image} />,
  })
}

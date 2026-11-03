import { use, useRef, useState, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import { Match, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { IconCopy, IconMaximize, IconPhoto, IconTrash } from "@tabler/icons-react"
import { logseq } from "@seqno/dom"
import { BlockId, type Block } from "@seqno/domain"
import {
  assetPageName,
  hlsPagePrefix,
  parseInline,
  parseTimestamp,
  parseVideo,
  isLocalAsset,
  plainText,
  type Inline,
  type LinkTarget,
  type Span,
} from "@seqno/syntax"
import { AnnotationPrefix, annotationMarks, isAnnotation, isAreaAnnotation } from "./Annotation.tsx"
import { AssetFileLink, AssetMedia } from "./Asset.tsx"
import { copyImage, ImageViewer } from "./ImageViewer.tsx"
import { blockRefAtom, pageTreeAtom } from "./core.ts"
import { Latex } from "./Math.tsx"
import { usePreview } from "./Preview.tsx"
import {
  AssetActions,
  HostBlock,
  MacroSlot,
  BlockSource,
  clickOnEnter,
  contentOf,
  follow,
  maxDepth,
  PageDialects,
  RenderContext,
  ShowBrackets,
  toPage,
} from "./render.ts"
import { Timestamp, VideoEmbed } from "./Video.tsx"

const isBlockId = Schema.is(BlockId)
const safeUrl = /^(?:https?|mailto|ftp):/i
const absoluteUrl = /^(?:https?:|data:image\/|blob:)/i

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const Inlines = ({ nodes }: { readonly nodes: ReadonlyArray<Inline> }): ReactNode =>
  nodes.map((node) => <InlineNode key={node.span.from} node={node} />)

const AnnotationRef = ({
  block,
  children,
}: {
  readonly block: Block
  readonly children?: ReactNode
}) => {
  const renderer = use(RenderContext)
  const { openAnnotation } = use(AssetActions)
  const dialect = use(PageDialects)(block.pageId)
  const area = isAreaAnnotation(block.props)
  const blank = area && (block.text.split("\n")[0] ?? "").trim() === "[:span]"
  const title = blank ? [] : (contentOf(block.text, dialect).title ?? [])
  const prefix = <AnnotationPrefix block={block} />
  return (
    <span {...logseq("seqno-annotation-ref", { area })} {...annotationMarks(block.props)}>
      <span
        className="seqno-blockref"
        onMouseDown={(event) => {
          if (event.button !== 0) return
          if (
            event.target instanceof Element &&
            event.target.closest(".seqno-annotation-blank") !== null
          )
            return
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) renderer.navigate({ _tag: "SidebarBlock", blockId: block.id })
          else openAnnotation(block)
        }}
        onClick={stop}
      >
        {children ?? (
          <>
            {area ? null : prefix}
            {renderer.depth >= maxDepth ? (
              plainText(title)
            ) : (
              <RenderContext value={{ ...renderer, depth: renderer.depth + 1 }}>
                <Inlines nodes={title} />
              </RenderContext>
            )}
            {area ? prefix : null}
          </>
        )}
      </span>
    </span>
  )
}

const RefBody = ({ block, children }: { readonly block: Block; readonly children?: ReactNode }) =>
  isAnnotation(block.props) ? (
    <AnnotationRef block={block}>{children}</AnnotationRef>
  ) : (
    <PlainRef block={block}>{children}</PlainRef>
  )

const PlainRef = ({
  block,
  children,
}: {
  readonly block: Block
  readonly children?: ReactNode
}) => {
  const renderer = use(RenderContext)
  const preview = usePreview({ _tag: "Block", blockId: block.id })
  const title = contentOf(block.text, use(PageDialects)(block.pageId)).title ?? []
  return (
    <span
      {...logseq("seqno-blockref")}
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

const RemoteRef = ({ uuid, children }: { readonly uuid: string; readonly children?: ReactNode }) =>
  AsyncResult.match(useAtomValue(blockRefAtom(uuid)), {
    onInitial: () => <span className="seqno-blockref is-pending">{children}</span>,
    onFailure: () => <span className="seqno-blockref is-missing">(({uuid}))</span>,
    onSuccess: ({ value }) => <LiveRef block={value}>{children}</LiveRef>,
  })

const BlockRefEmbed = ({ uuid, raw }: { readonly uuid: string; readonly raw: string }) => {
  const { Embed } = use(RenderContext)
  return AsyncResult.match(useAtomValue(blockRefAtom(uuid)), {
    onInitial: () => null,
    onFailure: () => <span className="seqno-macro">{raw}</span>,
    onSuccess: ({ value }) => <Embed target={{ _tag: "Block", blockId: value.id }} />,
  })
}

const BlockRef = ({ uuid, children }: { readonly uuid: string; readonly children?: ReactNode }) => {
  const renderer = use(RenderContext)
  const local = renderer.localBlock(uuid)
  return local === undefined ? (
    <RemoteRef uuid={uuid}>{children}</RemoteRef>
  ) : (
    <RefBody block={local}>{children}</RefBody>
  )
}

const PageLink = ({
  name,
  brackets,
  span,
  children,
}: {
  readonly name: string
  readonly brackets: boolean
  readonly span?: Span
  readonly children: ReactNode
}) => {
  const renderer = use(RenderContext)
  const shown = use(ShowBrackets)
  const preview = usePreview({ _tag: "Page", name })
  return (
    <span {...logseq("seqno-pageref", name)}>
      {brackets && shown ? (
        <span {...logseq("seqno-bracket")} data-side="open" data-from={span?.from} />
      ) : null}
      <a
        role="link"
        tabIndex={0}
        {...logseq("seqno-pageref-link", name)}
        data-from={span === undefined ? undefined : span.from + (brackets ? 2 : 0)}
        data-start={span?.from}
        data-end={span?.to}
        onClick={toPage(renderer.navigate, name)}
        onKeyDown={clickOnEnter}
        {...preview.trigger}
      >
        {children}
      </a>
      {brackets && shown ? (
        <span
          {...logseq("seqno-bracket")}
          data-side="close"
          data-from={span === undefined ? undefined : span.to - 2}
        />
      ) : null}
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
      isLocalAsset(url) ? (
        <AssetFileLink url={url}>
          <Inlines nodes={label} />
        </AssetFileLink>
      ) : safeUrl.test(url) ? (
        <a href={url} target="_blank" rel="noreferrer" {...logseq("seqno-link")} onClick={stop}>
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
      {...logseq("seqno-image-frame")}
      style={width === null ? undefined : { width }}
      onPointerDown={(event) => keepWidth(event.currentTarget)}
    >
      <img
        ref={picture}
        {...logseq("seqno-image")}
        src={source}
        alt={alt}
        loading="lazy"
        draggable={false}
      />
      <span {...logseq("seqno-image-overlay")} aria-hidden />
      <span {...logseq("seqno-image-actions")} onClick={stop} onPointerDown={stop}>
        {edit === null ? null : (
          <button
            {...logseq("seqno-image-action")}
            type="button"
            title="Delete image"
            aria-label="Delete image"
            onClick={() => edit(span.from, span.to, "")}
          >
            <IconTrash size={18} stroke={2} aria-hidden />
          </button>
        )}
        <button
          {...logseq("seqno-image-action")}
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
          {...logseq("seqno-image-action")}
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

const videoMacros = new Set(["video", "youtube", "vimeo"])

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
  const macros = use(MacroSlot)
  const host = use(HostBlock)
  const Slot = macros?.Slot
  if (Slot !== undefined && name === "renderer") {
    return <Slot name={name} args={args} blockId={host} />
  }
  const [target] = name === "embed" ? parseInline(args.trim()) : []
  const Embed = renderer.Embed
  const Query = renderer.Query
  if (renderer.depth < maxDepth && name === "query") return <Query query={args.trim()} />
  const video = videoMacros.has(name) ? parseVideo(args) : null
  if (video !== null) return <VideoEmbed video={video} />
  const seconds = name === "youtube-timestamp" ? parseTimestamp(args) : null
  if (seconds !== null) return <Timestamp seconds={seconds} />
  if (renderer.depth < maxDepth && target?._tag === "BlockRef") {
    return isBlockId(target.uuid) ? (
      <Embed target={{ _tag: "Block", blockId: target.uuid }} />
    ) : (
      <BlockRefEmbed uuid={target.uuid} raw={raw} />
    )
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
        {...logseq("seqno-tag", name)}
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
    Math: ({ tex, span }) => <Latex tex={tex} block={false} caret={span.to} />,
    PageRef: ({ name, brackets, span }) => (
      <PageLink name={name} brackets={brackets} span={span}>
        {name.startsWith(hlsPagePrefix) ? assetPageName(name) : name}
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
        {...logseq("seqno-priority")}
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
    Underline: ({ children }) => (
      <ins>
        <Inlines nodes={children} />
      </ins>
    ),
    Highlight: ({ children }) => (
      <mark className="seqno-mark">
        <Inlines nodes={children} />
      </mark>
    ),
    Link: ({ target, label }) => <Link target={target} label={label} />,
    Image: (image) => (
      <AssetMedia url={image.url} label={image.alt} image={<Image node={image} />} />
    ),
  })
}

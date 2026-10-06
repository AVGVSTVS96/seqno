import type { MouseEvent, ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { BlockId, PageId } from "@seqno/domain"
import { blockAtom } from "./core.ts"
import { parseBlock, parseInline, type Inline, type Line } from "./markdown.ts"

export type NavigationTarget =
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "Zoom"; readonly pageId: PageId; readonly blockId: BlockId | null }
  | { readonly _tag: "SidebarPage"; readonly name: string }
  | { readonly _tag: "SidebarBlock"; readonly blockId: BlockId }

export type Navigate = (target: NavigationTarget) => void

const maxRefDepth = 2

const follow =
  (navigate: Navigate, target: NavigationTarget, inSidebar: NavigationTarget) =>
  (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    navigate(event.shiftKey ? inSidebar : target)
  }

const toPage = (navigate: Navigate, name: string) =>
  follow(navigate, { _tag: "Page", name }, { _tag: "SidebarPage", name })

const BlockRef = (props: { blockId: BlockId; navigate: Navigate; depth: number }) => {
  const result = useAtomValue(blockAtom(props.blockId))
  return AsyncResult.match(result, {
    onInitial: () => <span className="seqno-block-ref seqno-pending">(({props.blockId}))</span>,
    onFailure: () => <span className="seqno-block-ref seqno-missing">(({props.blockId}))</span>,
    onSuccess: ({ value }) => (
      <span
        className="seqno-block-ref"
        onClick={follow(
          props.navigate,
          { _tag: "Zoom", pageId: value.pageId, blockId: value.id },
          { _tag: "SidebarBlock", blockId: value.id },
        )}
      >
        {props.depth < maxRefDepth
          ? renderInlines(
              parseInline(value.text.split("\n")[0] ?? ""),
              props.navigate,
              props.depth + 1,
            )
          : value.text}
      </span>
    ),
  })
}

const renderInlines = (
  nodes: ReadonlyArray<Inline>,
  navigate: Navigate,
  depth: number,
): ReactNode =>
  nodes.map((node, index) => (
    <InlineNode key={index} node={node} navigate={navigate} depth={depth} />
  ))

const InlineNode = ({
  node,
  navigate,
  depth,
}: {
  node: Inline
  navigate: Navigate
  depth: number
}): ReactNode =>
  Match.valueTags(node, {
    Text: ({ text }) => text,
    Code: ({ code }) => <code>{code}</code>,
    PageRef: ({ name }) => (
      <a href="#" className="seqno-page-ref" onClick={toPage(navigate, name)}>
        {name}
      </a>
    ),
    Tag: ({ name }) => (
      <a href="#" className="seqno-tag" onClick={toPage(navigate, name)}>
        #{name}
      </a>
    ),
    BlockRef: ({ blockId }) => <BlockRef blockId={blockId} navigate={navigate} depth={depth} />,
    Bold: ({ children }) => <strong>{renderInlines(children, navigate, depth)}</strong>,
    Italic: ({ children }) => <em>{renderInlines(children, navigate, depth)}</em>,
    Strike: ({ children }) => <del>{renderInlines(children, navigate, depth)}</del>,
    Highlight: ({ children }) => <mark>{renderInlines(children, navigate, depth)}</mark>,
    Link: ({ label, href }) => (
      <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        {renderInlines(label, navigate, depth)}
      </a>
    ),
  })

const LineView = ({ line, navigate }: { line: Line; navigate: Navigate }): ReactNode =>
  Match.valueTags(line, {
    Paragraph: ({ heading, marker, inline }) => (
      <div className={heading > 0 ? `seqno-line seqno-h${heading}` : "seqno-line"}>
        {marker === null ? null : (
          <span className={`seqno-marker seqno-marker-${marker.toLowerCase()}`}>{marker}</span>
        )}
        {renderInlines(inline, navigate, 0)}
      </div>
    ),
    Property: ({ key, value }) => (
      <div className="seqno-property">
        <span className="seqno-property-key">{key}</span>
        {renderInlines(value, navigate, 0)}
      </div>
    ),
    Planning: ({ kind, date }) => (
      <div className="seqno-planning">
        <span className="seqno-planning-kind">{kind}</span>
        <time>{date}</time>
      </div>
    ),
    CodeBlock: ({ language, code }) => (
      <pre className="seqno-code-block" data-language={language}>
        <code>{code}</code>
      </pre>
    ),
  })

export const StaticBlock = ({ text, navigate }: { text: string; navigate: Navigate }) => (
  <div className="seqno-static">
    {parseBlock(text).map((line, index) => (
      <LineView key={index} line={line} navigate={navigate} />
    ))}
  </div>
)
